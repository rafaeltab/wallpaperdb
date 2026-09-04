use crate::model::{viewport, Group, Item, Kind, Monitor, Rect};
use anyhow::{Context, Result};
use gdk::prelude::*;
use gtk::prelude::*;
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use serde_json::{json, Value};
use std::{cell::RefCell, fs, rc::Rc};
use webkit2gtk::{
    HardwareAccelerationPolicy, PermissionRequestExt, SettingsExt, UserContentInjectedFrames,
    UserContentManagerExt, UserScript, UserScriptInjectionTime, WebContext, WebView, WebViewExt,
};

pub struct Surface {
    pub window: gtk::Window,
    pub web: Option<WebView>,
    pub video: Option<crate::video::Video>,
    pub output: String,
    pub group: Group,
    pub canvas: Rect,
    pub crop: Rect,
    pub monitor: Rect,
    pub signature: String,
    pub telemetry: Rc<RefCell<Value>>,
    pub paused: bool,
    pub interactive: bool,
}

pub fn signature(group: &Group, item: &Item, monitor: &Monitor, monitors: &[Monitor]) -> String {
    let (canvas, crop) = viewport(group, monitor, monitors);
    json!([group, item.path, monitor.name, monitor.scale, canvas, crop]).to_string()
}

pub fn webview(context: &WebContext) -> WebView {
    let view = WebView::with_context(context);
    if let Some(settings) = WebViewExt::settings(&view) {
        settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Always);
        settings.set_media_playback_requires_user_gesture(false);
        settings.set_enable_developer_extras(true);
        settings.set_enable_write_console_messages_to_stdout(true);
        settings.set_enable_media_stream(false);
        settings.set_enable_page_cache(false);
        settings.set_allow_file_access_from_file_urls(true);
        settings.set_allow_universal_access_from_file_urls(false);
        settings.set_javascript_can_open_windows_automatically(false);
    }
    view.connect_permission_request(|_, request| {
        request.deny();
        true
    });
    view
}

pub fn evaluate(web: &WebView, script: &str) {
    web.evaluate_javascript(script, None, None, gio::Cancellable::NONE, |result| {
        if let Err(error) = result {
            eprintln!("Wallpaper script: {error}");
        }
    });
}

impl Surface {
    pub fn new(
        group: &Group,
        item: &Item,
        monitor: &Monitor,
        monitors: &[Monitor],
        epoch: u64,
    ) -> Result<Self> {
        let display = gdk::Display::default().context("No Wayland display")?;
        let output = (0..display.n_monitors())
            .filter_map(|i| display.monitor(i))
            .find(|m| {
                let r = m.geometry();
                r.x() == monitor.x && r.y() == monitor.y
            })
            .with_context(|| {
                format!(
                    "GTK cannot find output {} at {},{}",
                    monitor.name, monitor.x, monitor.y
                )
            })?;
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_title("WallpaperDB background");
        window.init_layer_shell();
        window.set_namespace(&format!("wallpaperdb-{}", monitor.name));
        window.set_layer(Layer::Background);
        window.set_monitor(&output);
        window.set_exclusive_zone(-1);
        window.set_keyboard_mode(KeyboardMode::None);
        for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
            window.set_anchor(edge, true);
        }
        window.connect_realize(|window| {
            window.input_shape_combine_region(Some(&gtk::cairo::Region::create()))
        });
        let (canvas, crop) = viewport(group, monitor, monitors);
        let telemetry = Rc::new(RefCell::new(json!({"state":"loading"})));
        let mut video = None;
        let web = match item.kind {
            Kind::Image => {
                let original = gdk_pixbuf::Pixbuf::from_file(&item.path)
                    .with_context(|| format!("Cannot decode image {}", item.path.display()))?;
                let image = original.apply_embedded_orientation().unwrap_or(original);
                let drawing = gtk::DrawingArea::new();
                drawing.connect_draw(move |_, context| {
                    let factor = (canvas.width as f64 / image.width() as f64)
                        .max(canvas.height as f64 / image.height() as f64);
                    let x =
                        (canvas.width as f64 - image.width() as f64 * factor) / 2. - crop.x as f64;
                    let y = (canvas.height as f64 - image.height() as f64 * factor) / 2.
                        - crop.y as f64;
                    context.translate(x, y);
                    context.scale(factor, factor);
                    context.set_source_pixbuf(&image, 0., 0.);
                    if let Err(error) = context.paint() {
                        eprintln!("Image paint failed: {error}");
                    }
                    glib::Propagation::Proceed
                });
                window.add(&drawing);
                *telemetry.borrow_mut() =
                    json!({"state":"ready","renderer":"native image","fps":0});
                None
            }
            Kind::Video => {
                video = Some(crate::video::Video::new(
                    &item.path,
                    &monitor.name,
                    canvas,
                    crop,
                    group.span,
                    epoch,
                )?);
                None
            }
            Kind::Live => {
                // Each scene uses an ephemeral context with no privileged UI bridge or cookies.
                let context = WebContext::new_ephemeral();
                let web = webview(&context);
                let manager = web
                    .user_content_manager()
                    .context("Missing script manager")?;
                manager.register_script_message_handler("telemetry");
                let stats = telemetry.clone();
                manager.connect_script_message_received(Some("telemetry"), move |_, result| {
                    if let Some(js) = result.js_value() {
                        if let Ok(value) = serde_json::from_str::<Value>(&js.to_string()) {
                            *stats.borrow_mut() = value;
                        }
                    }
                });
                let config = json!({"canvas":{"width":canvas.width,"height":canvas.height},"viewport":crop,"fps":group.fps,"epoch":epoch,"synchronize":group.span});
                let runtime = format!(
                    "window.__WALLPAPER_CONFIG__={config};\n{}",
                    include_str!("../runtime/wallpaper.js")
                );
                manager.add_script(&UserScript::new(
                    &runtime,
                    UserContentInjectedFrames::TopFrame,
                    UserScriptInjectionTime::Start,
                    &[],
                    &[],
                ));
                let stats = telemetry.clone();
                web.connect_load_failed(move |_, _, _, error| {
                    *stats.borrow_mut() = json!({"error":error.to_string()});
                    false
                });
                let stats = telemetry.clone();
                web.connect_web_process_terminated(move |_, reason| {
                    *stats.borrow_mut() =
                        json!({"error":format!("Web process terminated: {reason:?}")});
                });
                let body =
                    fs::read_to_string(&item.path).context("Live wallpaper must be UTF-8 HTML")?;
                let base = url::Url::from_directory_path(item.path.parent().unwrap())
                    .map_err(|_| anyhow::anyhow!("Invalid bundle directory"))?;
                // Scenes are local programs: media and scripts can load locally, network is off.
                let policy="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' file:; style-src 'unsafe-inline' file:; img-src file: data:; media-src file:; font-src file:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'\">";
                let html = if body.contains("<head>") {
                    body.replacen("<head>", &format!("<head>{policy}"), 1)
                } else {
                    format!("{policy}{body}")
                };
                web.load_html(&html, Some(base.as_str()));
                window.add(&web);
                Some(web)
            }
        };
        if video.is_none() {
            window.show_all();
        }
        Ok(Self {
            window,
            web,
            video,
            output: monitor.name.clone(),
            group: group.clone(),
            canvas,
            crop,
            monitor: monitor.rect(),
            signature: signature(group, item, monitor, monitors),
            telemetry,
            paused: false,
            interactive: false,
        })
    }

    pub fn update(&mut self, paused: bool, input: Value) {
        self.paused = paused;
        if let Some(web) = &self.web {
            evaluate(web, &format!("window.__wallpaperHost?.update({input})"));
        }
    }

    pub fn interact(&mut self, enabled: bool) {
        self.interactive = enabled;
        self.window.set_keyboard_mode(if enabled {
            KeyboardMode::OnDemand
        } else {
            KeyboardMode::None
        });
        if enabled {
            self.window.input_shape_combine_region(None);
            if let Some(web) = &self.web {
                web.grab_focus();
            }
        } else {
            self.window
                .input_shape_combine_region(Some(&gtk::cairo::Region::create()));
        }
    }

    pub fn snapshot(&self) -> Value {
        json!({"output":self.output,"group":self.group.id,"paused":self.paused,"interactive":self.interactive,"canvas":self.canvas,"viewport":self.crop,"telemetry":*self.telemetry.borrow()})
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        self.window.close();
        if let Some(web) = &self.web {
            // Scene contexts are dedicated. A stuck third-party program should
            // not keep its web process alive after the wallpaper is replaced.
            web.terminate_web_process();
        }
    }
}
