#include "media_texture.h"
#include <assert.h>
#include <stdio.h>

static void video_cadence_does_not_gate_scene_frames(void) {
  // A due-frame producer supplies 60 updates per second. Scene ticks between
  // updates keep the last texture and never request another video render.
  const int scene_rates[] = {120, 240, 360};
  for (unsigned i = 0; i < sizeof scene_rates / sizeof scene_rates[0]; i++) {
    int scene_rate = scene_rates[i];
    MediaTexture texture = {0};
    int scene_frames = 0, media_renders = 0;
    for (int tick = 0; tick < scene_rate; tick++) {
      bool frame_queued = tick % (scene_rate / 60) == 0;
      if (media_texture_begin_frame(&texture, frame_queued)) {
        media_renders++;
        media_texture_rendered(&texture);
      }
      scene_frames++;
      bool report = media_texture_submitted(&texture, true);
      assert(report == frame_queued);
    }
    assert(scene_frames == scene_rate && media_renders == 60);
    assert(texture.updates == 60 && texture.submissions == 60);
    assert(texture.reuses == (uint64_t)(scene_rate - 60));
  }
}

static void redraw_wakeup_is_not_a_queued_frame(void) {
  MediaTexture texture = {0};
  // Startup notification may arrive before any video exists.
  assert(!media_texture_begin_frame(&texture, false));
  assert(!texture.ready && texture.reuses == 0);
  assert(!media_texture_submitted(&texture, true));
  assert(media_texture_begin_frame(&texture, true));
  media_texture_rendered(&texture);
  assert(media_texture_submitted(&texture, true));
  // A coalesced/spurious callback without UPDATE_FRAME retains the texture.
  assert(!media_texture_begin_frame(&texture, false));
  assert(texture.ready && texture.updates == 1 && texture.reuses == 1);
  assert(!media_texture_submitted(&texture, true));
}

static void output_group_reports_once_and_keeps_unsubmitted_updates(void) {
  MediaTexture texture = {0};
  assert(media_texture_begin_frame(&texture, true));
  media_texture_rendered(&texture);
  assert(!media_texture_submitted(&texture, false));
  assert(texture.submission_pending);
  // Cover/uncover or a temporarily suppressed group keeps its pending update.
  assert(!media_texture_begin_frame(&texture, false));
  assert(media_texture_submitted(&texture, true));
  assert(!media_texture_submitted(&texture, true));
  assert(texture.submissions == 1);
  // Two updates while no output is submitted collapse to the latest texture.
  media_texture_rendered(&texture);
  media_texture_rendered(&texture);
  assert(media_texture_submitted(&texture, true));
  assert(texture.updates == 3 && texture.submissions == 2);
}

static void failed_render_cannot_acknowledge_a_new_texture(void) {
  MediaTexture texture = {0};
  assert(media_texture_begin_frame(&texture, true));
  // Caller skips media_texture_rendered() when the renderer returns an error.
  assert(!texture.ready);
  assert(!media_texture_submitted(&texture, true));
  media_texture_rendered(&texture);
  assert(media_texture_submitted(&texture, true));
  assert(media_texture_begin_frame(&texture, true));
  assert(!media_texture_submitted(&texture, true));
  assert(texture.ready && texture.updates == 1);
}

int main(void) {
  video_cadence_does_not_gate_scene_frames();
  redraw_wakeup_is_not_a_queued_frame();
  output_group_reports_once_and_keeps_unsubmitted_updates();
  failed_render_cannot_acknowledge_a_new_texture();
  puts(
      "media retention: 60 Hz video with 120/240/360 scene ticks, "
      "startup notifications, group submission, and failure accounting passed");
  return 0;
}
