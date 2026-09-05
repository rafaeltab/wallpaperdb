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
    pub experiment: Option<Rc<RefCell<crate::experiment::Player>>>,
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
    let local = json!([group, item.path, monitor.name, monitor.scale, canvas, crop]);
    if !group.span || group.experiment == "baseline" {
        return local.to_string();
    }

    // Every surface must be replaced together when its shared player's outputs change.
    let mut members: Vec<_> = monitors
        .iter()
        .filter(|m| group.outputs.contains(&m.name) && !m.disabled)
        .collect();
    members.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    let presentation: Vec<_> = members
        .into_iter()
        .map(|m| json!([m.name, m.x, m.y, m.width, m.height, m.scale, m.transform]))
        .collect();
    json!([local, presentation]).to_string()
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
        experiment: Option<Rc<RefCell<crate::experiment::Player>>>,
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
        if experiment.is_some() {
            let (canvas, crop) = viewport(group, monitor, monitors);
            return Ok(Self {
                experiment,
                window,
                web: None,
                video: None,
                output: monitor.name.clone(),
                group: group.clone(),
                canvas,
                crop,
                monitor: monitor.rect(),
                signature: signature(group, item, monitor, monitors),
                telemetry: Rc::new(RefCell::new(json!({"state":"loading"}))),
                paused: false,
                interactive: false,
            });
        }
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
            experiment: None,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> (Group, Item, Vec<Monitor>) {
        let monitors = ["left", "middle", "right"]
            .into_iter()
            .enumerate()
            .map(|(i, name)| Monitor {
                name: name.into(),
                x: i as i32 * 100,
                width: 100,
                height: 100,
                scale: 1.,
                powered: true,
                ..Default::default()
            })
            .collect::<Vec<_>>();
        let group = Group {
            id: "group".into(),
            item: "scene".into(),
            outputs: monitors.iter().map(|m| m.name.clone()).collect(),
            span: true,
            fps: 30,
            audio: false,
            paused: false,
            experiment: "gpu".into(),
            hdr: false,
            keep_playing: false,
            trace: false,
        };
        let item = Item {
            id: "scene".into(),
            title: "Scene".into(),
            kind: Kind::Live,
            path: "/scene/index.html".into(),
            preview: None,
            description: String::new(),
            tags: vec![],
        };
        (group, item, monitors)
    }

    #[test]
    fn shared_experiments_rebuild_after_middle_member_removal_without_changing_bounds() {
        let (mut group, item, monitors) = layout();
        let remaining = [monitors[0].clone(), monitors[2].clone()];
        let mut disabled = monitors.clone();
        disabled[1].disabled = true;

        for experiment in ["gpu", "chromium", "chromium-dmabuf"] {
            group.experiment = experiment.into();
            for member in &remaining {
                assert_eq!(
                    viewport(&group, member, &monitors),
                    viewport(&group, member, &remaining)
                );
                let before = signature(&group, &item, member, &monitors);
                let after = signature(&group, &item, member, &remaining);
                assert_ne!(before, after, "{experiment}: {}", member.name);
                assert_eq!(after, signature(&group, &item, member, &disabled));
            }
        }
    }

    #[test]
    fn every_shared_signature_changes_when_one_members_presentation_changes() {
        let (mut group, item, monitors) = layout();
        let mut moved = monitors.clone();
        moved[1].x += 10;
        let mut resized = monitors.clone();
        resized[1].width = 80;
        let mut scaled = monitors.clone();
        scaled[1].width = 200;
        scaled[1].height = 200;
        scaled[1].scale = 2.;
        let mut rotated = monitors.clone();
        rotated[1].transform = 2;

        for experiment in ["gpu", "chromium", "chromium-dmabuf"] {
            group.experiment = experiment.into();
            for (change, updated) in [
                ("position", &moved),
                ("resolution", &resized),
                ("scale", &scaled),
                ("rotation", &rotated),
            ] {
                for (before, after) in monitors.iter().zip(updated) {
                    assert_eq!(
                        viewport(&group, before, &monitors).0,
                        viewport(&group, after, updated).0
                    );
                    assert_ne!(
                        signature(&group, &item, before, &monitors),
                        signature(&group, &item, after, updated),
                        "{experiment}, {change}: {}",
                        before.name
                    );
                }
            }
        }
    }

    #[test]
    fn shared_signatures_ignore_output_order_power_and_unassigned_outputs() {
        let (group, item, monitors) = layout();
        let mut reordered = monitors.clone();
        reordered.reverse();
        reordered[1].powered = false;
        reordered.push(Monitor {
            name: "unassigned".into(),
            x: 500,
            ..monitors[0].clone()
        });

        for member in &monitors {
            assert_eq!(
                signature(&group, &item, member, &monitors),
                signature(&group, &item, member, &reordered)
            );
        }
    }

    #[test]
    fn baseline_and_independent_signatures_keep_other_members_local() {
        let (mut group, item, monitors) = layout();
        let remaining = [monitors[0].clone(), monitors[2].clone()];
        let mut scaled = monitors.clone();
        scaled[1].width = 200;
        scaled[1].height = 200;
        scaled[1].scale = 2.;

        for (experiment, span) in [
            ("baseline", true),
            ("baseline", false),
            ("gpu", false),
            ("chromium", false),
            ("chromium-dmabuf", false),
        ] {
            group.experiment = experiment.into();
            group.span = span;
            for member in &remaining {
                let before = signature(&group, &item, member, &monitors);
                assert_eq!(before, signature(&group, &item, member, &remaining));
                assert_eq!(before, signature(&group, &item, member, &scaled));
            }
        }
    }
}
