// Disposable laboratory renderer. One process, simulation and media decoder per
// group. C keeps the experimental EGL/libmpv/Lua boundary small; the Rust
// daemon owns it.
#define _GNU_SOURCE
#include "color.h"
#include "layer.h"
#include "presentation.h"
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <errno.h>
#include <fcntl.h>
#include <json-c/json.h>
#include <lauxlib.h>
#include <lua.h>
#include <lualib.h>
#include <math.h>
#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>
#include <wayland-egl.h>

#ifndef LUA_OK
#define LUA_OK 0
#endif
#define MAX_OUTPUTS 16
#define QUERIES 32
#define FOURCC(a, b, c, d)                                                     \
  ((uint32_t)(a) | ((uint32_t)(b) << 8) | ((uint32_t)(c) << 16) |              \
   ((uint32_t)(d) << 24))
typedef struct {
  struct wl_output *object;
  char name[128];
  int scale;
} Output;
typedef struct {
  struct wl_surface *surface;
  struct zwlr_layer_surface_v1 *layer;
  struct wp_color_management_surface_v1 *color;
  struct wl_egl_window *window;
  EGLSurface egl;
  Output *output;
  char name[128];
  int w, h, pw, ph, ready, hidden;
  float crop[4];
  uint64_t presented, discarded;
  double last_present, max_interval;
} View;
static struct wl_display *display;
static struct wl_compositor *compositor;
static struct zwlr_layer_shell_v1 *shell;
static struct wp_color_manager_v1 *color_manager;
static struct wp_image_description_v1 *description;
static struct wp_presentation *presentation;
static Output outputs[MAX_OUTPUTS];
static int output_count, view_count, color_ready, color_failed;
static View views[MAX_OUTPUTS];
static EGLDisplay ed;
static EGLContext ec;
static EGLConfig egl_config;
static int egl_red, egl_component, can_scrgb, presentation_clock = -1;
static volatile sig_atomic_t running = 1;
static json_object *config;
static int hdr, chromium, paused, fps, cw, ch, has_media,
    media_dirty = 1, scene_dirty = 0, stress;
static double start_time, last_frame, last_report, play_time, signal_energy,
    pointer_x = .5, pointer_y = .5, audio_rms;
static float bands[16];
static uint64_t frame_id, received_frames;
static double last_cpu_ms, last_gpu_ms;
static GLuint scene_program, copy_program, scene_tex, scene_fbo, media_tex,
    media_fbo, vao;
static GLuint queries[QUERIES];
static uint64_t query_frame[QUERIES];
static int query_pending[QUERIES];
static mpv_handle *mpv;
static mpv_render_context *mpv_render;
static lua_State *lua;
static FILE *frames;
static int listener = -1, peer = -1;
static char last_error[512], source_format[64] = "none",
                             source_color[512] = "none";
static int media_loaded, media_rendered;
static GLuint imported_tex;
static EGLImageKHR imported_image = EGL_NO_IMAGE_KHR;
static GLsync import_fence;
static int imported_id;
static int pending_ack;
static double probe_max = -1;
static int probe_done;

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}
static json_object *get(json_object *o, const char *k) {
  json_object *v = NULL;
  if (o)
    json_object_object_get_ex(o, k, &v);
  return v;
}
static const char *str(json_object *o, const char *k, const char *d) {
  json_object *v = get(o, k);
  return v ? json_object_get_string(v) : d;
}
static double val(json_object *o, const char *k, double d) {
  json_object *v = get(o, k);
  return v ? json_object_get_double(v) : d;
}
static void fatal(const char *s) {
  fprintf(stderr, "presenter: %s (EGL 0x%x GL 0x%x)\n", s, eglGetError(),
          ec ? glGetError() : 0);
  exit(1);
}
static void stop(int sig) { running = 0; }
static void log_event(const char *kind, uint64_t id, const char *out, double a,
                      double b, uint64_t seq, unsigned flags) {
  if (frames)
    fprintf(frames, "%.9f,%s,%llu,%s,%.9f,%.9f,%llu,%u\n", now(), kind,
            (unsigned long long)id, out ? out : "", a, b,
            (unsigned long long)seq, flags);
}
static void output_geometry(void *d, struct wl_output *o, int32_t x, int32_t y,
                            int32_t pw, int32_t ph, int32_t sub,
                            const char *make, const char *model, int32_t tr) {}
static void output_mode(void *d, struct wl_output *o, uint32_t flags, int32_t w,
                        int32_t h, int32_t hz) {}
static void output_done(void *d, struct wl_output *o) {}
static void output_scale(void *d, struct wl_output *o, int32_t s) {
  ((Output *)d)->scale = s;
}
static void output_name(void *d, struct wl_output *o, const char *s) {
  snprintf(((Output *)d)->name, 128, "%s", s);
}
static void output_description(void *d, struct wl_output *o, const char *s) {}
static const struct wl_output_listener output_listener = {
    output_geometry, output_mode, output_done,
    output_scale,    output_name, output_description};
static void color_intent(void *d, struct wp_color_manager_v1 *c, uint32_t v) {}
static void color_feature(void *d, struct wp_color_manager_v1 *c, uint32_t v) {
  if (v == WP_COLOR_MANAGER_V1_FEATURE_WINDOWS_SCRGB)
    can_scrgb = 1;
}
static void color_tf(void *d, struct wp_color_manager_v1 *c, uint32_t v) {}
static void color_primaries(void *d, struct wp_color_manager_v1 *c,
                            uint32_t v) {}
static void color_done(void *d, struct wp_color_manager_v1 *c) {}
static const struct wp_color_manager_v1_listener color_listener = {
    color_intent, color_feature, color_tf, color_primaries, color_done};
static void desc_failed(void *d, struct wp_image_description_v1 *o,
                        uint32_t reason, const char *message) {
  color_failed = 1;
  snprintf(last_error, sizeof last_error, "Color description failed: %s",
           message);
}
static void desc_ready(void *d, struct wp_image_description_v1 *o,
                       uint32_t identity) {
  color_ready = 1;
}
static void desc_ready2(void *d, struct wp_image_description_v1 *o, uint32_t hi,
                        uint32_t lo) {
  color_ready = 1;
}
static const struct wp_image_description_v1_listener desc_listener = {
    desc_failed, desc_ready, desc_ready2};
static void clock_id(void *d, struct wp_presentation *p, uint32_t id) {
  presentation_clock = id;
}
static const struct wp_presentation_listener presentation_listener = {clock_id};
static void registry_global(void *d, struct wl_registry *r, uint32_t name,
                            const char *interface, uint32_t version) {
  if (!strcmp(interface, "wl_compositor"))
    compositor = wl_registry_bind(r, name, &wl_compositor_interface, 4);
  else if (!strcmp(interface, "zwlr_layer_shell_v1"))
    shell = wl_registry_bind(r, name, &zwlr_layer_shell_v1_interface,
                             version < 4 ? version : 4);
  else if (!strcmp(interface, "wp_color_manager_v1")) {
    color_manager = wl_registry_bind(r, name, &wp_color_manager_v1_interface,
                                     version < 3 ? version : 3);
    wp_color_manager_v1_add_listener(color_manager, &color_listener, NULL);
  } else if (!strcmp(interface, "wp_presentation")) {
    presentation = wl_registry_bind(r, name, &wp_presentation_interface, 1);
    wp_presentation_add_listener(presentation, &presentation_listener, NULL);
  } else if (!strcmp(interface, "wl_output") && output_count < MAX_OUTPUTS) {
    Output *o = &outputs[output_count++];
    o->scale = 1;
    o->object = wl_registry_bind(r, name, &wl_output_interface,
                                 version < 4 ? version : 4);
    wl_output_add_listener(o->object, &output_listener, o);
  }
}
static void registry_remove(void *d, struct wl_registry *r, uint32_t name) {}
static const struct wl_registry_listener registry_listener = {registry_global,
                                                              registry_remove};
static void layer_configure(void *d, struct zwlr_layer_surface_v1 *l,
                            uint32_t serial, uint32_t w, uint32_t h) {
  View *v = d;
  zwlr_layer_surface_v1_ack_configure(l, serial);
  v->ready = 1;
  if (w)
    v->w = w;
  if (h)
    v->h = h;
}
static void layer_closed(void *d, struct zwlr_layer_surface_v1 *l) {
  running = 0;
}
static const struct zwlr_layer_surface_v1_listener layer_listener = {
    layer_configure, layer_closed};
typedef struct {
  View *view;
  uint64_t id;
  double submit;
  char output[128];
} Feedback;
static void feedback_output(void *d, struct wp_presentation_feedback *f,
                            struct wl_output *o) {
  Feedback *b = d;
  for (int i = 0; i < output_count; i++)
    if (outputs[i].object == o)
      snprintf(b->output, sizeof b->output, "%s", outputs[i].name);
}
static void feedback_presented(void *d, struct wp_presentation_feedback *f,
                               uint32_t hi, uint32_t lo, uint32_t ns,
                               uint32_t refresh, uint32_t shi, uint32_t slo,
                               uint32_t flags) {
  Feedback *b = d;
  double stamp = ((uint64_t)hi << 32 | lo) + ns / 1e9;
  View *v = b->view;
  if (v->last_present > 0) {
    double interval = (stamp - v->last_present) * 1000;
    if (interval > v->max_interval)
      v->max_interval = interval;
  }
  v->last_present = stamp;
  v->presented++;
  log_event("presented", b->id, b->output, stamp, refresh / 1e9,
            (uint64_t)shi << 32 | slo, flags);
  free(b);
  wp_presentation_feedback_destroy(f);
}
static void feedback_discarded(void *d, struct wp_presentation_feedback *f) {
  Feedback *b = d;
  b->view->discarded++;
  log_event("discarded", b->id, b->view->name, 0, 0, 0, 0);
  free(b);
  wp_presentation_feedback_destroy(f);
}
static const struct wp_presentation_feedback_listener feedback_listener = {
    feedback_output, feedback_presented, feedback_discarded};

static void init_wayland(void) {
  display = wl_display_connect(NULL);
  if (!display)
    fatal("Cannot connect Wayland");
  struct wl_registry *r = wl_display_get_registry(display);
  wl_registry_add_listener(r, &registry_listener, NULL);
  wl_display_roundtrip(display);
  wl_display_roundtrip(display);
  if (!compositor || !shell)
    fatal("Layer shell unavailable");
  if (hdr) {
    if (!color_manager || !can_scrgb)
      fatal("scRGB surface descriptions unavailable; HDR was not enabled");
    description = wp_color_manager_v1_create_windows_scrgb(color_manager);
    wp_image_description_v1_add_listener(description, &desc_listener, NULL);
    wl_display_roundtrip(display);
    if (!color_ready || color_failed)
      fatal("HDR image description not ready");
  }
  json_object *list = get(config, "outputs");
  view_count = json_object_array_length(list);
  if (view_count < 1 || view_count > MAX_OUTPUTS)
    fatal("Invalid output count");
  for (int i = 0; i < view_count; i++) {
    View *v = &views[i];
    json_object *o = json_object_array_get_idx(list, i);
    snprintf(v->name, sizeof v->name, "%s", str(o, "name", ""));
    for (int j = 0; j < output_count; j++)
      if (!strcmp(outputs[j].name, v->name))
        v->output = &outputs[j];
    if (!v->output)
      fatal("Selected output not found");
    v->w = val(o, "width", 1920);
    v->h = val(o, "height", 1080);
    v->pw = val(o, "pixel_width", v->w);
    v->ph = val(o, "pixel_height", v->h);
    v->crop[0] = val(o, "crop_x", 0) / (float)cw;
    v->crop[1] = val(o, "crop_y", 0) / (float)ch;
    v->crop[2] = v->w / (float)cw;
    v->crop[3] = v->h / (float)ch;
    v->surface = wl_compositor_create_surface(compositor);
    char name[160];
    snprintf(name, sizeof name, "wallpaperdb-lab-%s", v->name);
    v->layer = zwlr_layer_shell_v1_get_layer_surface(
        shell, v->surface, v->output->object,
        stress ? ZWLR_LAYER_SHELL_V1_LAYER_TOP
               : ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND,
        name);
    zwlr_layer_surface_v1_add_listener(v->layer, &layer_listener, v);
    if (stress) {
      zwlr_layer_surface_v1_set_size(v->layer, v->w < 1280 ? v->w : 1280,
                                     v->h < 720 ? v->h : 720);
      v->pw = v->w = 1280;
      v->ph = v->h = 720;
    } else {
      zwlr_layer_surface_v1_set_anchor(v->layer, 15);
      zwlr_layer_surface_v1_set_size(v->layer, 0, 0);
    }
    zwlr_layer_surface_v1_set_exclusive_zone(v->layer, -1);
    zwlr_layer_surface_v1_set_keyboard_interactivity(v->layer, 0);
    struct wl_region *empty = wl_compositor_create_region(compositor);
    wl_surface_set_input_region(v->surface, empty);
    wl_region_destroy(empty);
    if (hdr) {
      v->color = wp_color_manager_v1_get_surface(color_manager, v->surface);
      wp_color_management_surface_v1_set_image_description(
          v->color, description, WP_COLOR_MANAGER_V1_RENDER_INTENT_PERCEPTUAL);
    }
    wl_surface_commit(v->surface);
  }
  for (int n = 0; n < 20; n++) {
    int ready = 1;
    for (int i = 0; i < view_count; i++)
      ready &= views[i].ready;
    if (ready)
      break;
    wl_display_roundtrip(display);
  }
}
static void init_egl(void) {
  ed = eglGetDisplay((EGLNativeDisplayType)display);
  if (!eglInitialize(ed, NULL, NULL))
    fatal("eglInitialize");
  eglBindAPI(EGL_OPENGL_API);
  EGLint a[] = {EGL_SURFACE_TYPE,
                EGL_WINDOW_BIT,
                EGL_RENDERABLE_TYPE,
                EGL_OPENGL_BIT,
                EGL_RED_SIZE,
                hdr ? 16 : 8,
                EGL_GREEN_SIZE,
                hdr ? 16 : 8,
                EGL_BLUE_SIZE,
                hdr ? 16 : 8,
                EGL_ALPHA_SIZE,
                hdr ? 16 : 8,
                EGL_DEPTH_SIZE,
                0,
                EGL_STENCIL_SIZE,
                0,
                EGL_SAMPLE_BUFFERS,
                0,
                EGL_COLOR_COMPONENT_TYPE_EXT,
                hdr ? EGL_COLOR_COMPONENT_TYPE_FLOAT_EXT
                    : EGL_COLOR_COMPONENT_TYPE_FIXED_EXT,
                EGL_NONE};
  EGLint n;
  if (!eglChooseConfig(ed, a, &egl_config, 1, &n) || !n)
    fatal("Requested EGL precision unavailable (HDR requires float16)");
  eglGetConfigAttrib(ed, egl_config, EGL_RED_SIZE, &egl_red);
  eglGetConfigAttrib(ed, egl_config, EGL_COLOR_COMPONENT_TYPE_EXT,
                     &egl_component);
  EGLint ca[] = {EGL_CONTEXT_MAJOR_VERSION,
                 3,
                 EGL_CONTEXT_MINOR_VERSION,
                 3,
                 EGL_CONTEXT_OPENGL_PROFILE_MASK,
                 EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
                 EGL_NONE};
  ec = eglCreateContext(ed, egl_config, EGL_NO_CONTEXT, ca);
  if (ec == EGL_NO_CONTEXT)
    fatal("eglCreateContext");
  for (int i = 0; i < view_count; i++) {
    View *v = &views[i];
    if (!v->ready)
      fatal("Layer configure timed out");
    // Integer buffers preserve logical size; fractional output scale is
    // resampled by compositor.
    int scale = v->output->scale;
    v->pw = v->w * scale;
    v->ph = v->h * scale;
    wl_surface_set_buffer_scale(v->surface, scale);
    v->window = wl_egl_window_create(v->surface, v->pw, v->ph);
    EGLint sa[] = {EGL_GL_COLORSPACE_KHR, EGL_GL_COLORSPACE_LINEAR_KHR,
                   EGL_NONE};
    v->egl = eglCreateWindowSurface(ed, egl_config,
                                    (EGLNativeWindowType)v->window, sa);
    if (v->egl == EGL_NO_SURFACE)
      fatal("eglCreateWindowSurface");
  }
  if (!eglMakeCurrent(ed, views[0].egl, views[0].egl, ec))
    fatal("eglMakeCurrent");
  eglSwapInterval(ed, 0);
  fprintf(stderr, "renderer=%s EGL=%s float=%d bits=%d HDR=%d\n",
          glGetString(GL_RENDERER), eglQueryString(ed, EGL_VENDOR),
          egl_component == EGL_COLOR_COMPONENT_TYPE_FLOAT_EXT, egl_red, hdr);
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenQueries(QUERIES, queries);
}
static const char *vertex = "#version 330 core\nout vec2 uv;void main(){vec2 "
                            "p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_"
                            "Position=vec4(p*2.-1.,0,1);}";
static GLuint program(const char *fragment) {
  GLuint s[2] = {glCreateShader(GL_VERTEX_SHADER),
                 glCreateShader(GL_FRAGMENT_SHADER)};
  const char *src[2] = {vertex, fragment};
  for (int i = 0; i < 2; i++) {
    glShaderSource(s[i], 1, &src[i], NULL);
    glCompileShader(s[i]);
    GLint ok;
    glGetShaderiv(s[i], GL_COMPILE_STATUS, &ok);
    if (!ok) {
      char b[8192];
      glGetShaderInfoLog(s[i], sizeof b, NULL, b);
      fprintf(stderr, "%s\n", b);
      fatal("Shader compilation failed");
    }
  }
  GLuint p = glCreateProgram();
  glAttachShader(p, s[0]);
  glAttachShader(p, s[1]);
  glLinkProgram(p);
  GLint ok;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok)
    fatal("Shader linking failed");
  glDeleteShader(s[0]);
  glDeleteShader(s[1]);
  return p;
}
static void texture(GLuint *t, GLuint *f, int w, int h) {
  glGenTextures(1, t);
  glBindTexture(GL_TEXTURE_2D, *t);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, w, h, 0, GL_RGBA, GL_FLOAT, NULL);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glGenFramebuffers(1, f);
  glBindFramebuffer(GL_FRAMEBUFFER, *f);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                         *t, 0);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
    fatal("Float framebuffer unavailable");
}
static void uniform1(GLuint p, const char *n, float v) {
  glUniform1f(glGetUniformLocation(p, n), v);
}
static void copy(GLuint source, GLuint dest, int w, int h, const float *crop,
                 int transform) {
  glBindFramebuffer(GL_FRAMEBUFFER, dest);
  glViewport(0, 0, w, h);
  glDisable(GL_BLEND);
  glUseProgram(copy_program);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, source);
  glUniform1i(glGetUniformLocation(copy_program, "image"), 0);
  glUniform4fv(glGetUniformLocation(copy_program, "crop"), 1, crop);
  glUniform1i(glGetUniformLocation(copy_program, "transform"), transform);
  glBindVertexArray(vao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
}

static void *get_proc(void *ctx, const char *name) {
  return (void *)eglGetProcAddress(name);
}
static void media_update(void *ctx) {
  __atomic_store_n(&media_dirty, 1, __ATOMIC_RELAXED);
}
static void init_media(const char *path) {
  if (!path || !*path)
    return;
  mpv = mpv_create();
  if (!mpv)
    fatal("mpv_create");
  const char *options[][2] = {{"config", "no"},
                              {"vo", "libmpv"},
                              {"audio", "no"},
                              {"loop-file", "inf"},
                              {"keep-open", "yes"},
                              {"image-display-duration", "inf"},
                              {"hwdec", "auto-safe"},
                              {"panscan", "1"},
                              {"osd-level", "0"},
                              {"target-trc", "pq"},
                              {"target-prim", "bt.2020"},
                              {"target-peak", "10000"},
                              {"tone-mapping", "clip"},
                              {"hdr-compute-peak", "no"},
                              {"fbo-format", "rgba16f"},
                              {"dither-depth", "no"}};
  for (unsigned i = 0; i < sizeof options / sizeof options[0]; i++)
    if (mpv_set_option_string(mpv, options[i][0], options[i][1]) < 0)
      fatal(options[i][0]);
  if (mpv_initialize(mpv) < 0)
    fatal("mpv_initialize");
  mpv_opengl_init_params gl = {get_proc, NULL};
  mpv_render_param p[] = {
      {MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_API_TYPE_OPENGL},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl},
      {MPV_RENDER_PARAM_WL_DISPLAY, display},
      {0, NULL}};
  if (mpv_render_context_create(&mpv_render, mpv, p) < 0)
    fatal("mpv render context");
  mpv_render_context_set_update_callback(mpv_render, media_update, NULL);
  const char *cmd[] = {"loadfile", path, NULL};
  if (mpv_command(mpv, cmd) < 0)
    fatal("mpv loadfile");
  has_media = 1;
}
static void init_scene(void) {
  const char *copy_fragment =
      "#version 330 core\nin vec2 uv;out vec4 color;uniform sampler2D "
      "image;uniform vec4 crop;uniform int transform;vec3 enc(vec3 x){return "
      "mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1./"
      "2.4))-.055,step(vec3(.0031308),x));}vec3 dec(vec3 x){return "
      "mix(x/12.92,pow((x+.055)/1.055,vec3(2.4)),step(vec3(.04045),x));}void "
      "main(){vec2 p=vec2(crop.x+uv.x*crop.z,1.-crop.y-(1.-uv.y)*crop.w);vec4 "
      "s=texture(image,p);if(transform==1)s.rgb=enc(clamp(s.rgb*80./"
      "203.,0.,1.));if(transform==2)s.rgb=dec(s.rgb)*203./"
      "80.;if(transform==3)s.rgb*=203./80.;color=vec4(s.rgb,1);}";
  copy_program = program(copy_fragment);
  texture(&scene_tex, &scene_fbo, cw, ch);
  texture(&media_tex, &media_fbo, cw, ch);
  if (chromium)
    return;
  const char *lua_path = str(config, "script", "");
  const char *media = str(config, "media", "");
  char *fragment = NULL;
  if (*lua_path) {
    lua = luaL_newstate();
    luaL_openlibs(lua);
    if (luaL_dofile(lua, lua_path) != LUA_OK) {
      fprintf(stderr, "Lua: %s\n", lua_tostring(lua, -1));
      fatal("Lua load");
    }
    lua_getglobal(lua, "fragment");
    if (lua_isstring(lua, -1))
      fragment = strdup(lua_tostring(lua, -1));
    lua_pop(lua, 1);
    lua_getglobal(lua, "media");
    if (lua_isstring(lua, -1)) {
      static char full[4096];
      snprintf(full, sizeof full, "%s", lua_path);
      char *slash = strrchr(full, '/');
      if (slash)
        slash[1] = 0;
      strncat(full, lua_tostring(lua, -1), sizeof(full) - strlen(full) - 1);
      media = full;
    }
    lua_pop(lua, 1);
  }
  const char *prefix =
      "#version 330 core\nin vec2 uv;out vec4 color;uniform sampler2D "
      "mediaTexture;uniform float time;uniform vec4 pointer;uniform float "
      "audio;uniform float bands[16];uniform float pulse;uniform vec4 "
      "date;uniform vec4 params;uniform int hasMedia;uniform int hdr;vec3 "
      "pq(vec3 x){vec3 p=pow(max(x,vec3(0)),vec3(1./78.84375));return "
      "pow(max(p-.8359375,0.)/max(18.8515625-18.6875*p,vec3(.000001)),vec3(1./"
      ".1593017578125))*10000.;}vec3 mediaColor(vec2 p){if(hasMedia==0)return "
      "vec3(0);vec3 c=pq(texture(mediaTexture,p).rgb)/80.;return "
      "mat3(1.660491,-.124550,-.018151,-.587641,1.132900,-.100579,-.072850,-."
      "008349,1.118730)*c;}\n";
  const char *plain = "void main(){color=vec4(mediaColor(uv),1);}";
  char *source = NULL;
  asprintf(&source, "%s%s", prefix, fragment ? fragment : plain);
  scene_program = program(source);
  free(source);
  free(fragment);
  init_media(media);
}
static void lua_input(void) {
  if (!lua)
    return;
  lua_getglobal(lua, "frame");
  if (!lua_isfunction(lua, -1)) {
    lua_pop(lua, 1);
    return;
  }
  lua_pushnumber(lua, play_time);
  lua_newtable(lua);
  lua_pushnumber(lua, audio_rms);
  lua_setfield(lua, -2, "audio");
  lua_pushnumber(lua, pointer_x);
  lua_setfield(lua, -2, "x");
  lua_pushnumber(lua, pointer_y);
  lua_setfield(lua, -2, "y");
  lua_pushnumber(lua, signal_energy);
  lua_setfield(lua, -2, "pulse");
  lua_pushboolean(lua, hdr);
  lua_setfield(lua, -2, "hdr");
  if (lua_pcall(lua, 2, 1, 0) != LUA_OK) {
    snprintf(last_error, sizeof last_error, "Lua frame: %s",
             lua_tostring(lua, -1));
    lua_pop(lua, 1);
    return;
  }
  float params[4] = {1, 0, 0, 0};
  if (lua_istable(lua, -1))
    for (int i = 0; i < 4; i++) {
      lua_rawgeti(lua, -1, i + 1);
      params[i] = lua_tonumber(lua, -1);
      lua_pop(lua, 1);
    }
  lua_pop(lua, 1);
  glUniform4fv(glGetUniformLocation(scene_program, "params"), 1, params);
}
static void commands(void) {
  static char buf[65536];
  static size_t used;
  ssize_t n = read(STDIN_FILENO, buf + used, sizeof buf - used - 1);
  if (n == 0) {
    running = 0;
    return;
  }
  if (n < 0)
    return;
  used += n;
  buf[used] = 0;
  char *line = buf, *end;
  while ((end = strchr(line, '\n'))) {
    *end = 0;
    json_object *o = json_tokener_parse(line);
    if (o) {
      if (get(o, "paused")) {
        int next = json_object_get_boolean(get(o, "paused"));
        if (next != paused) {
          paused = next;
          if (mpv)
            mpv_set_property(mpv, "pause", MPV_FORMAT_FLAG, &paused);
          log_event(paused ? "pause" : "resume", frame_id, NULL, 0, 0, 0, 0);
          last_frame = now();
        }
      }
      json_object *p = get(o, "pointer");
      if (p) {
        pointer_x = val(p, "x", pointer_x);
        pointer_y = val(p, "y", pointer_y);
      }
      json_object *a = get(o, "audio");
      if (a) {
        audio_rms = val(a, "rms", 0);
        json_object *b = get(a, "bands");
        for (int i = 0; i < 16; i++)
          bands[i] = json_object_get_double(json_object_array_get_idx(b, i));
      }
      if (get(o, "signal")) {
        signal_energy += 1;
        log_event("signal", frame_id, NULL, signal_energy, 0, 0, 0);
      }
      json_object *h = get(o, "hidden");
      if (h)
        for (int i = 0; i < view_count; i++) {
          int was_hidden = views[i].hidden;
          views[i].hidden = 0;
          for (size_t j = 0; j < json_object_array_length(h); j++)
            if (!strcmp(views[i].name, json_object_get_string(
                                           json_object_array_get_idx(h, j))))
              views[i].hidden = 1;
          if (was_hidden && !views[i].hidden)
            scene_dirty = 1;
        }
      json_object_put(o);
    }
    line = end + 1;
  }
  used -= line - buf;
  memmove(buf, line, used);
  if (used == sizeof buf - 1)
    used = 0;
}
static void setup_socket(void) {
  if (!chromium)
    return;
  const char *path = str(config, "socket", "");
  struct sockaddr_un addr = {.sun_family = AF_UNIX};
  snprintf(addr.sun_path, sizeof addr.sun_path, "%s", path);
  unlink(path);
  listener = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  if (listener < 0 || bind(listener, (void *)&addr, sizeof addr) ||
      listen(listener, 1))
    fatal("DMA-BUF socket");
}
static void acknowledge(void) {
  if (pending_ack && peer >= 0) {
    char ack[32];
    int n = snprintf(ack, sizeof ack, "%d", pending_ack);
    if (send(peer, ack, n, MSG_DONTWAIT | MSG_NOSIGNAL) == n)
      pending_ack = 0;
  }
}
static void release_import(void) {
  acknowledge();
  if (!import_fence)
    return;
  GLenum status = glClientWaitSync(import_fence, 0, 0);
  if (status != GL_ALREADY_SIGNALED && status != GL_CONDITION_SATISFIED)
    return;
  glDeleteSync(import_fence);
  import_fence = NULL;
  glDeleteTextures(1, &imported_tex);
  if (imported_image != EGL_NO_IMAGE_KHR)
    eglDestroyImageKHR(ed, imported_image);
  imported_image = EGL_NO_IMAGE_KHR;
  pending_ack = imported_id;
  acknowledge();
}
static void receive_frame(void) {
  if (peer < 0 || import_fence || pending_ack)
    return;
  char buf[32769], control[CMSG_SPACE(4 * sizeof(int))];
  struct iovec io = {buf, sizeof(buf) - 1};
  struct msghdr msg = {.msg_iov = &io,
                       .msg_iovlen = 1,
                       .msg_control = control,
                       .msg_controllen = sizeof control};
  ssize_t n = recvmsg(peer, &msg, MSG_DONTWAIT | MSG_CMSG_CLOEXEC);
  if (n == 0)
    fatal("Chromium producer disconnected");
  if (n < 0)
    return;
  buf[n] = 0;
  int fds[4], count = 0;
  for (struct cmsghdr *c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c))
    if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
      count = (c->cmsg_len - CMSG_LEN(0)) / sizeof(int);
      if (count > 4)
        count = 4;
      memcpy(fds, CMSG_DATA(c), count * sizeof(int));
    }
  json_object *o = json_tokener_parse(buf);
  if (!o || !count) {
    if (o)
      json_object_put(o);
    for (int i = 0; i < count; i++)
      close(fds[i]);
    return;
  }
  imported_id = val(o, "id", 0);
  int w = val(o, "width", cw), h = val(o, "height", ch);
  const char *format = str(o, "format", "bgra");
  snprintf(source_format, sizeof source_format, "%s", format);
  snprintf(source_color, sizeof source_color, "%s", str(o, "color", "unknown"));
  if (!strcmp(format, "bitmap")) {
    size_t size = (size_t)w * h * 4;
    void *data = mmap(NULL, size, PROT_READ, MAP_SHARED, fds[0], 0);
    if (data == MAP_FAILED)
      fatal("Bitmap mapping failed");
    glGenTextures(1, &imported_tex);
    glBindTexture(GL_TEXTURE_2D, imported_tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_BGRA, GL_UNSIGNED_BYTE,
                 data);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    munmap(data, size);
    for (int i = 0; i < count; i++)
      close(fds[i]);
    float flipped[4] = {0, 1, 1, -1};
    copy(imported_tex, scene_fbo, cw, ch, flipped, 2);
    import_fence = glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE, 0);
    glFlush();
    received_frames++;
    scene_dirty = 1;
    json_object_put(o);
    return;
  }
  uint32_t fourcc = !strcmp(format, "rgbaf16") ? FOURCC('A', 'B', '4', 'H')
                    : !strcmp(format, "rgba")  ? FOURCC('A', 'B', '2', '4')
                                               : FOURCC('A', 'R', '2', '4');
  uint64_t modifier = strtoull(str(o, "modifier", "0"), NULL, 10);
  EGLint at[80] = {EGL_WIDTH,     w, EGL_HEIGHT, h, EGL_LINUX_DRM_FOURCC_EXT,
                   (EGLint)fourcc};
  int k = 6;
  json_object *planes = get(o, "planes");
  if (count > 3)
    fatal("Four-plane import is not implemented by this RGBA prototype");
  for (int i = 0; i < count; i++) {
    json_object *p = json_object_array_get_idx(planes, i);
    at[k++] = EGL_DMA_BUF_PLANE0_FD_EXT + 3 * i;
    at[k++] = fds[i];
    at[k++] = EGL_DMA_BUF_PLANE0_OFFSET_EXT + 3 * i;
    at[k++] = val(p, "offset", 0);
    at[k++] = EGL_DMA_BUF_PLANE0_PITCH_EXT + 3 * i;
    at[k++] = val(p, "stride", 0);
    at[k++] = EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT + 2 * i;
    at[k++] = (uint32_t)modifier;
    at[k++] = EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT + 2 * i;
    at[k++] = modifier >> 32;
  }
  at[k++] = EGL_NONE;
  imported_image =
      eglCreateImageKHR(ed, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT, NULL, at);
  for (int i = 0; i < count; i++)
    close(fds[i]);
  if (imported_image == EGL_NO_IMAGE_KHR) {
    snprintf(last_error, sizeof last_error,
             "DMA-BUF import failed EGL 0x%x (%s)", eglGetError(), format);
    pending_ack = imported_id;
    acknowledge();
    json_object_put(o);
    return;
  }
  glGenTextures(1, &imported_tex);
  glBindTexture(GL_TEXTURE_2D, imported_tex);
  glEGLImageTargetTexture2DOES(GL_TEXTURE_2D, imported_image);
  if (glGetError() != GL_NO_ERROR)
    fatal("Imported buffer is not sampleable as GL_TEXTURE_2D");
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  int transform = 2;
  if (!strcmp(format, "rgbaf16")) {
    json_object *cs = json_tokener_parse(source_color);
    const char *tf = str(cs, "transfer", "");
    if (strcmp(str(cs, "primaries", ""), "bt709") ||
        strcmp(str(cs, "matrix", ""), "rgb") ||
        strcmp(str(cs, "range", ""), "full") ||
        (!strcmp(tf, "linear-hdr") ? 0 : strcmp(tf, "scrgb-linear-80-nits"))) {
      fatal("Unsupported FP16 source color description; frame rejected");
    }
    transform = !strcmp(tf, "linear-hdr") ? 3 : 0;
    if (cs)
      json_object_put(cs);
  }
  float full[4] = {0, 1, 1, -1};
  copy(imported_tex, scene_fbo, cw, ch, full, transform);
  import_fence = glFenceSync(GL_SYNC_GPU_COMMANDS_COMPLETE, 0);
  glFlush();
  received_frames++;
  scene_dirty = 1;
  json_object_put(o);
}
static void query_results(void) {
  for (int i = 0; i < QUERIES; i++)
    if (query_pending[i]) {
      GLint ready;
      glGetQueryObjectiv(queries[i], GL_QUERY_RESULT_AVAILABLE, &ready);
      if (ready) {
        GLuint64 ns;
        glGetQueryObjectui64v(queries[i], GL_QUERY_RESULT, &ns);
        last_gpu_ms = ns / 1e6;
        log_event("gpu", query_frame[i], NULL, last_gpu_ms, 0, 0, 0);
        query_pending[i] = 0;
      }
    }
}
static void render_frame(void) {
  double began = now();
  double dt = fmin(began - last_frame, .1);
  last_frame = began;
  play_time += dt;
  frame_id++;
  eglMakeCurrent(ed, views[0].egl, views[0].egl, ec);
  query_results();
  int q = frame_id % QUERIES;
  int timing = !query_pending[q];
  if (timing)
    glBeginQuery(GL_TIME_ELAPSED, queries[q]);
  if (!chromium) {
    if (mpv_render) {
      mpv_event *event;
      while ((event = mpv_wait_event(mpv, 0))->event_id != MPV_EVENT_NONE) {
        if (event->event_id == MPV_EVENT_FILE_LOADED)
          media_loaded = 1;
        if (event->event_id == MPV_EVENT_END_FILE) {
          mpv_event_end_file *e = event->data;
          if (e->error < 0)
            snprintf(last_error, sizeof last_error, "Media load: %s",
                     mpv_error_string(e->error));
        }
      }
      uint64_t flags = mpv_render_context_update(mpv_render);
      if ((flags & MPV_RENDER_UPDATE_FRAME) ||
          __atomic_exchange_n(&media_dirty, 0, __ATOMIC_RELAXED)) {
        mpv_opengl_fbo fbo = {(int)media_fbo, cw, ch, GL_RGBA16F};
        int flip = 1;
        mpv_render_param p[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
                                {MPV_RENDER_PARAM_FLIP_Y, &flip},
                                {0, NULL}};
        if (mpv_render_context_render(mpv_render, p) >= 0 && media_loaded)
          media_rendered = 1;
        log_event("media", frame_id, NULL, 0, 0, 0, 0);
      }
    }
    glBindFramebuffer(GL_FRAMEBUFFER, scene_fbo);
    glViewport(0, 0, cw, ch);
    glDisable(GL_BLEND);
    glUseProgram(scene_program);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, media_tex);
    glUniform1i(glGetUniformLocation(scene_program, "mediaTexture"), 0);
    glUniform1i(glGetUniformLocation(scene_program, "hasMedia"), has_media);
    glUniform1i(glGetUniformLocation(scene_program, "hdr"), hdr);
    uniform1(scene_program, "time", play_time);
    uniform1(scene_program, "audio", audio_rms);
    uniform1(scene_program, "pulse", signal_energy);
    glUniform4f(glGetUniformLocation(scene_program, "pointer"), pointer_x,
                pointer_y, 0, 0);
    glUniform1fv(glGetUniformLocation(scene_program, "bands"), 16, bands);
    time_t civil = time(NULL);
    struct tm date;
    localtime_r(&civil, &date);
    glUniform4f(glGetUniformLocation(scene_program, "date"),
                date.tm_year + 1900, date.tm_mon + 1, date.tm_mday,
                date.tm_hour * 3600 + date.tm_min * 60 + date.tm_sec);
    lua_input();
    glBindVertexArray(vao);
    for (int pass = 0; pass < (stress ? stress : 1); pass++)
      glDrawArrays(GL_TRIANGLES, 0, 3);
  }

  // One diagnostic readback, outside sustained profiling warmup. Samples real
  // renderer content.
  if (!probe_done && frame_id > 30 && (!has_media || media_rendered) &&
      (!chromium || received_frames > 5 ||
       (!strcmp(str(config, "kind", ""), "image") && received_frames > 0))) {
    glBindFramebuffer(GL_FRAMEBUFFER, scene_fbo);
    float pixel[4];
    probe_max = 0;
    json_object *patches = json_object_new_array();
    for (int p = 0; p < 8; p++) {
      glReadPixels((p + .5) * cw / 8, ch / 2, 1, 1, GL_RGBA, GL_FLOAT, pixel);
      json_object *a = json_object_new_array();
      for (int c = 0; c < 3; c++) {
        json_object_array_add(a, json_object_new_double(pixel[c]));
        if (pixel[c] > probe_max)
          probe_max = pixel[c];
      }
      json_object_array_add(patches, a);
    }
    json_object_object_add(config, "probe_patches_scrgb", patches);
    probe_done = 1;
    log_event("probe", frame_id, NULL, probe_max, 0, 0, 0);
  }
  for (int i = 0; i < view_count; i++) {
    View *v = &views[i];
    if (v->hidden)
      continue;
    eglMakeCurrent(ed, v->egl, v->egl, ec);
    copy(scene_tex, 0, v->pw, v->ph, v->crop, hdr ? 0 : 1);
    if (presentation) {
      Feedback *b = calloc(1, sizeof *b);
      b->view = v;
      b->id = frame_id;
      b->submit = now();
      snprintf(b->output, sizeof b->output, "%s", v->name);
      struct wp_presentation_feedback *f =
          wp_presentation_feedback(presentation, v->surface);
      wp_presentation_feedback_add_listener(f, &feedback_listener, b);
    }
    log_event("submit", frame_id, v->name, now(), 0, 0, 0);
    if (!eglSwapBuffers(ed, v->egl))
      fatal("eglSwapBuffers");
  }
  if (timing) {
    glEndQuery(GL_TIME_ELAPSED);
    query_pending[q] = 1;
    query_frame[q] = frame_id;
  }
  if (mpv_render)
    mpv_render_context_report_swap(mpv_render);
  scene_dirty = 0;
  last_cpu_ms = (now() - began) * 1000;
  log_event("cpu", frame_id, NULL, last_cpu_ms, 0, 0, 0);
}
static void report(void) {
  json_object *o = json_object_new_object();
  json_object_object_add(
      o, "state",
      json_object_new_string(*last_error ? "error"
                             : (chromium && received_frames < 1) ||
                                     (has_media && !media_rendered)
                                 ? "loading"
                                 : "ready"));
  json_object_object_add(
      o, "renderer",
      json_object_new_string(
          chromium ? (!strcmp(str(config, "experiment", ""), "chromium")
                          ? "Chromium SDR copy"
                          : "Chromium DMA-BUF")
                   : "Lua / OpenGL"));
  json_object_object_add(o, "pid", json_object_new_int(getpid()));
  json_object_object_add(
      o, "adapter", json_object_new_string((char *)glGetString(GL_RENDERER)));
  json_object_object_add(o, "frames", json_object_new_int64(frame_id));
  json_object_object_add(o, "received", json_object_new_int64(received_frames));
  json_object_object_add(o, "paused", json_object_new_boolean(paused));
  json_object_object_add(o, "cpu_frame_ms",
                         json_object_new_double(last_cpu_ms));
  json_object_object_add(o, "gpu_frame_ms",
                         json_object_new_double(last_gpu_ms));
  json_object_object_add(o, "hdr", json_object_new_boolean(hdr));
  json_object_object_add(o, "egl_bits", json_object_new_int(egl_red));
  json_object_object_add(
      o, "egl_float",
      json_object_new_boolean(egl_component ==
                              EGL_COLOR_COMPONENT_TYPE_FLOAT_EXT));
  json_object_object_add(
      o, "surface_color",
      json_object_new_string(hdr && color_ready ? "scRGB linear, 1 = 80 cd/m2"
                                                : "sRGB SDR"));
  json_object_object_add(o, "probe_max_scrgb",
                         json_object_new_double(probe_max));
  json_object_object_add(o, "source_format",
                         json_object_new_string(source_format));
  json_object_object_add(o, "source_color",
                         json_object_new_string(source_color));
  json_object_object_add(o, "presentation_clock",
                         json_object_new_int(presentation_clock));
  json_object_object_add(o, "time", json_object_new_double(play_time));
  json_object *p = get(config, "probe_patches_scrgb");
  if (p)
    json_object_object_add(o, "probe_patches_scrgb", json_object_get(p));
  if (*last_error)
    json_object_object_add(o, "error", json_object_new_string(last_error));
  if (chromium && probe_done && probe_max == 0)
    json_object_object_add(
        o, "warning",
        json_object_new_string(
            "Sampled source pixels are all black. Received buffers alone do "
            "not prove visible rendering."));
  json_object_object_add(
      o, "gpu_timing_scope",
      json_object_new_string(
          chromium ? "Presenter output only; excludes Chromium rendering, "
                     "readback, IPC, and texture import"
                   : "Lua scene, libmpv render submission, and all output "
                     "draws; excludes asynchronous video decoding"));
  json_object_object_add(o, "pointer_x", json_object_new_double(pointer_x));
  json_object_object_add(o, "pointer_y", json_object_new_double(pointer_y));
  json_object_object_add(o, "audio_rms", json_object_new_double(audio_rms));
  json_object_object_add(o, "signals", json_object_new_double(signal_energy));
  if (mpv) {
    char *hw = mpv_get_property_string(mpv, "hwdec-current");
    json_object_object_add(o, "hwdec",
                           json_object_new_string(hw ? hw : "none"));
    mpv_free(hw);
  }
  json_object *a = json_object_new_array();
  for (int i = 0; i < view_count; i++) {
    json_object *v = json_object_new_object();
    json_object_object_add(v, "output", json_object_new_string(views[i].name));
    json_object_object_add(v, "presented",
                           json_object_new_int64(views[i].presented));
    json_object_object_add(v, "discarded",
                           json_object_new_int64(views[i].discarded));
    json_object_object_add(v, "max_interval_ms",
                           json_object_new_double(views[i].max_interval));
    json_object_array_add(a, v);
  }
  json_object_object_add(o, "outputs", a);
  puts(json_object_to_json_string_ext(o, JSON_C_TO_STRING_PLAIN));
  fflush(stdout);
  json_object_put(o);
}
int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: presenter CONFIG.json\n");
    return 2;
  }
  prctl(PR_SET_PDEATHSIG, SIGTERM);
  signal(SIGTERM, stop);
  signal(SIGINT, stop);
  signal(SIGPIPE, SIG_IGN);
  config = json_object_from_file(argv[1]);
  if (!config)
    fatal("Invalid config");
  hdr = val(config, "hdr", 0);
  chromium = !strncmp(str(config, "experiment", "gpu"), "chromium", 8);
  fps = val(config, "fps", 30);
  cw = val(config, "width", 1920);
  ch = val(config, "height", 1080);
  stress = val(config, "stress", 0);
  if (cw < 1 || ch < 1 || cw > 16384 || ch > 16384 || fps < 1 || fps > 360)
    fatal("Invalid canvas/fps");
  const char *log = str(config, "frames", "");
  if (*log) {
    frames = fopen(log, "w");
    if (!frames)
      fatal("Cannot open frame log");
    setvbuf(frames, NULL, _IOFBF, 65536);
    fprintf(frames,
            "monotonic,event,frame,output,value,value2,sequence,flags\n");
  }
  init_wayland();
  init_egl();
  init_scene();
  setup_socket();
  fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK);
  start_time = last_frame = last_report = now();
  last_frame -= 1. / fps;
  double next_frame = now();
  while (running) {
    if (wl_display_dispatch_pending(display) < 0 || !running)
      break;
    release_import();
    query_results();
    double t = now();
    int due = !paused && t >= next_frame;
    int static_image = !lua && !strcmp(str(config, "kind", ""), "image");
    if (due) {
      if ((!chromium || received_frames > 0) &&
          (!chromium || scene_dirty ||
           (static_image && received_frames > 0 && frame_id < 40)) &&
          (!static_image || scene_dirty || frame_id < 40 ||
           __atomic_load_n(&media_dirty, __ATOMIC_RELAXED)))
        render_frame();
      next_frame += 1. / fps;
      if (next_frame < now())
        next_frame = now() + 1. / fps;
    }
    if (chromium && !received_frames && t - start_time > 12 && !paused)
      snprintf(
          last_error, sizeof last_error,
          "Chromium has not produced a frame in 12 seconds; inspect its log");
    if (t - last_report >= 1) {
      report();
      last_report = t;
    }
    struct pollfd fds[4] = {
        {wl_display_get_fd(display), POLLIN, 0},
        {STDIN_FILENO, POLLIN, 0},
        {listener, POLLIN, 0},
        {peer, import_fence || pending_ack ? 0 : POLLIN, 0}};
    double delay = paused ? .05 : fmax(.00005, fmin(.05, next_frame - now()));
    if (import_fence || pending_ack)
      delay = fmin(delay, .001);
    struct timespec wait = {0, (long)(delay * 1e9)};
    // EGL also reads this connection. Reserve the read before polling, then
    // read or cancel before any EGL work; dispatch() after poll can block if
    // EGL consumed the readable events on its own queue in the meantime.
    int prepared = 0;
    while (!(prepared = wl_display_prepare_read(display) == 0)) {
      if (wl_display_dispatch_pending(display) < 0 || !running) {
        running = 0;
        break;
      }
    }
    if (!running) {
      if (prepared)
        wl_display_cancel_read(display);
      break;
    }
    if (wl_display_flush(display) < 0) {
      if (errno == EAGAIN)
        fds[0].events |= POLLOUT;
      else {
        wl_display_cancel_read(display);
        break;
      }
    }
    int count = ppoll(fds, 4, &wait, NULL);
    int poll_error = errno;
    if (count > 0 && (fds[0].revents & POLLIN)) {
      if (wl_display_read_events(display) < 0)
        break;
    } else {
      wl_display_cancel_read(display);
    }
    if ((count < 0 && poll_error != EINTR) ||
        (fds[0].revents & (POLLERR | POLLHUP | POLLNVAL)) ||
        wl_display_dispatch_pending(display) < 0 || !running)
      break;
    if ((fds[0].revents & POLLOUT) && wl_display_flush(display) < 0 &&
        errno != EAGAIN)
      break;
    if (count > 0) {
      if (fds[1].revents & (POLLIN | POLLHUP))
        commands();
      if (!running)
        break;
      if (peer >= 0 && (fds[3].revents & (POLLERR | POLLHUP | POLLNVAL)))
        fatal("Chromium producer disconnected");
      if (fds[2].revents & POLLIN) {
        if (peer >= 0)
          close(peer);
        peer = accept4(listener, NULL, NULL, SOCK_NONBLOCK | SOCK_CLOEXEC);
      }
      if (fds[3].revents & POLLIN)
        receive_frame();
    }
  }
  glFinish();
  release_import();
  if (frames)
    fclose(frames);
  if (mpv_render)
    mpv_render_context_free(mpv_render);
  if (mpv)
    mpv_terminate_destroy(mpv);
  if (lua)
    lua_close(lua);
  for (int i = 0; i < view_count; i++) {
    eglDestroySurface(ed, views[i].egl);
    wl_egl_window_destroy(views[i].window);
    zwlr_layer_surface_v1_destroy(views[i].layer);
    wl_surface_destroy(views[i].surface);
  }
  eglDestroyContext(ed, ec);
  eglTerminate(ed);
  wl_display_disconnect(display);
  return 0;
}
