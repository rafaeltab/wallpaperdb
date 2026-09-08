mod audio;
mod benchmark;
mod experiment;
mod model;
mod platform;
mod render;
mod server;
mod video;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use gtk::prelude::*;
use model::{Group, Library, Monitor};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    rc::Rc,
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use webkit2gtk::WebViewExt;

#[derive(Parser)]
#[command(version, about = "WallpaperDB native prototype for Hyprland")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}
#[derive(Subcommand)]
enum Commands {
    /// Start background surfaces and local control service; Ctrl+C stops all owned surfaces.
    Daemon {
        #[arg(long, default_value_t = 0)]
        port: u16,
    },
    /// Open the native wallpaper library (starts the daemon if necessary).
    Ui,
    /// Import a local file or a directory containing wallpaper.json.
    Add {
        path: PathBuf,
    },
    /// Apply a file, live bundle, or imported item ID to selected outputs.
    Set {
        source: String,
        #[arg(long, value_delimiter = ',', required = true)]
        outputs: Vec<String>,
        #[arg(long)]
        span: bool,
        /// Requested frame budget, 1–360. Chromium SDR copy caps at 240.
        #[arg(long, default_value_t = 30)]
        fps: u32,
        #[arg(long)]
        audio: bool,
        /// baseline, chromium, chromium-dmabuf, gpu, gpu-paced, gpu-independent, or gpu-independent-drop.
        #[arg(long, default_value = "baseline")]
        experiment: String,
        /// Request real floating-point HDR presentation (experimental renderers only).
        #[arg(long)]
        hdr: bool,
        /// Keep rendering behind fullscreen windows for controlled profiling.
        #[arg(long)]
        keep_playing: bool,
        /// Write detailed frame CSV for profiling (can grow while running).
        #[arg(long)]
        trace: bool,
    },
    /// Remove only this app's wallpaper from selected outputs, revealing the previous background.
    Clear {
        #[arg(long, value_delimiter = ',', required = true)]
        outputs: Vec<String>,
    },
    /// Pause selected outputs (all owned outputs if omitted).
    Pause {
        #[arg(long, value_delimiter = ',')]
        outputs: Vec<String>,
    },
    Resume {
        #[arg(long, value_delimiter = ',')]
        outputs: Vec<String>,
    },
    /// Enable desktop click/key interaction; click the exposed wallpaper to focus it.
    Interact {
        #[arg(long)]
        output: String,
        #[arg(long)]
        off: bool,
    },
    /// Send a semantic event; suitable for an explicit Hyprland keyboard binding.
    Signal {
        name: String,
        #[arg(default_value = "Space")]
        value: String,
        #[arg(long, value_delimiter = ',')]
        outputs: Vec<String>,
    },
    Status,
    Monitors,
    Stop,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let command = Cli::parse().command.unwrap_or(Commands::Ui);
    match command {
        Commands::Daemon { port } => daemon(port),
        Commands::Monitors => {
            platform::session()?;
            println!("{}", serde_json::to_string_pretty(&platform::monitors()?)?);
            Ok(())
        }
        other => {
            let request = match other {
                Commands::Ui => json!({"op":"ui"}),
                Commands::Add { path } => json!({"op":"import","path":path.canonicalize()?}),
                Commands::Set {
                    source,
                    outputs,
                    span,
                    fps,
                    audio,
                    experiment,
                    hdr,
                    keep_playing,
                    trace,
                } => {
                    let source = PathBuf::from(&source)
                        .canonicalize()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or(source);
                    json!({"op":"set","source":source,"outputs":outputs,"span":span,"fps":fps,"audio":audio,"experiment":experiment,"hdr":hdr,"keep_playing":keep_playing,"trace":trace})
                }
                Commands::Clear { outputs } => json!({"op":"clear","outputs":outputs}),
                Commands::Pause { outputs } => {
                    json!({"op":"pause","outputs":outputs,"paused":true})
                }
                Commands::Resume { outputs } => {
                    json!({"op":"pause","outputs":outputs,"paused":false})
                }
                Commands::Interact { output, off } => {
                    json!({"op":"interact","output":output,"enabled":!off})
                }
                Commands::Signal {
                    name,
                    value,
                    outputs,
                } => json!({"op":"signal","name":name,"value":value,"outputs":outputs}),
                Commands::Status => json!({"op":"status"}),
                Commands::Stop => json!({"op":"stop"}),
                _ => unreachable!(),
            };
            if !matches!(request["op"].as_str(), Some("stop" | "status")) {
                ensure_daemon()?;
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&server::client(request)?)?
            );
            Ok(())
        }
    }
}

fn ensure_daemon() -> Result<()> {
    if server::client(json!({"op":"status"})).is_ok() {
        return Ok(());
    }
    platform::session()?;
    fs::create_dir_all(platform::runtime_dir())?;
    let log = fs::File::create(platform::runtime_dir().join("daemon.log"))?;
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    // The CLI may be launched from a short-lived terminal or a Hyprland binding.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.spawn()?;
    for _ in 0..100 {
        std::thread::sleep(Duration::from_millis(50));
        if server::client(json!({"op":"status"})).is_ok() {
            return Ok(());
        }
    }
    bail!(
        "Daemon failed to start. See {}",
        platform::runtime_dir().join("daemon.log").display()
    )
}

struct Desktop {
    library: Library,
    monitors: Vec<Monitor>,
    surfaces: Vec<render::Surface>,
    audio: audio::Audio,
    ui: Option<gtk::Window>,
    url: String,
    epoch: u64,
    error: Option<String>,
    suspended: Vec<String>,
    reconcile_pending: bool,
    benchmark: benchmark::Benchmark,
    stop_requested: bool,
}

impl Desktop {
    fn ui_output(&self) -> Option<String> {
        let window = self.ui.as_ref()?.window()?;
        let geometry = window.display().monitor_at_window(&window)?.geometry();
        self.monitors
            .iter()
            .find(|monitor| monitor.x == geometry.x() && monitor.y == geometry.y())
            .map(|monitor| monitor.name.clone())
    }

    fn snapshot(&self) -> Value {
        json!({"items":self.library.items,"groups":self.library.groups,"monitors":self.monitors,"surfaces":self.surfaces.iter().map(|s|s.snapshot()).collect::<Vec<_>>(),"fullscreen_outputs":self.suspended,"audio":*self.audio.levels.lock().unwrap(),"url":self.url,"warning":self.error,"prototype":true,"benchmark":self.benchmark.snapshot(),"ui_output":self.ui_output(),"graphics_fault":benchmark::graphics_fault()})
    }

    fn apply(&mut self, next: Library, persist: bool) -> Result<()> {
        if !next.groups.is_empty() && benchmark::graphics_fault().is_some() {
            bail!("Prototype rendering is paused for this graphics session after a kernel GPU fault. Saved assignments are retained.");
        }
        let mut additions = Vec::new();
        let mut desired = Vec::new();
        for group in &next.groups {
            let mut player = None;
            let item = next
                .items
                .iter()
                .find(|i| i.id == group.item)
                .context("Assigned wallpaper is missing from library")?;
            for monitor in self
                .monitors
                .iter()
                .filter(|m| group.outputs.contains(&m.name) && !m.disabled)
            {
                let signature = render::signature(group, item, monitor, &self.monitors);
                desired.push(signature.clone());
                if !self.surfaces.iter().any(|s| s.signature == signature) {
                    let experiment = if group.experiment != "baseline" {
                        if !group.span || player.is_none() {
                            let mut assigned = group.clone();
                            if !group.span {
                                assigned.outputs = vec![monitor.name.clone()];
                            }
                            player = Some(Rc::new(RefCell::new(experiment::Player::new(
                                &assigned,
                                item,
                                &self.monitors,
                            )?)));
                        }
                        player.clone()
                    } else {
                        None
                    };
                    additions.push(render::Surface::new(
                        group,
                        item,
                        monitor,
                        &self.monitors,
                        self.epoch,
                        experiment,
                    )?);
                }
            }
        }
        if persist {
            next.save(&platform::data_file())?;
        }
        self.surfaces.retain(|s| desired.contains(&s.signature));
        self.surfaces.extend(additions);
        self.library = next;
        self.error = None;
        self.reconcile_pending = false;
        Ok(())
    }

    fn execute(&mut self, request: Value, owner: &Rc<RefCell<Desktop>>) -> Result<Value> {
        let op = request["op"].as_str().context("Missing operation")?;
        let benchmark_owned = self.benchmark.owns(&request);
        if self.benchmark.active()
            && !matches!(
                op,
                "status"
                    | "ui"
                    | "bench_cancel"
                    | "bench_stop"
                    | "bench_next"
                    | "bench_result"
                    | "bench_history"
                    | "bench_record"
                    | "bench_live"
                    | "bench_rename"
                    | "bench_delete"
                    | "stop"
            )
            && !(benchmark_owned && matches!(op, "set" | "clear"))
        {
            bail!("A benchmark owns the temporary wallpaper setup. Cancel it before changing the library.");
        }
        let outputs: Vec<String> = request
            .get("outputs")
            .map(|v| serde_json::from_value(v.clone()))
            .transpose()?
            .unwrap_or_default();
        match op {
            "status" => {}
            "bench_start" => self.benchmark.start(&request, &self.library)?,
            "bench_cancel" => self.benchmark.cancel()?,
            "bench_stop" => self.benchmark.finish()?,
            "bench_next" => self.benchmark.next_phase()?,
            "bench_result" => return self.benchmark.result(),
            "bench_history" => return self.benchmark.history(),
            "bench_record" => return self.benchmark.record(request["id"].as_str()),
            "bench_live" => return self.benchmark.live(request["id"].as_str()),
            "bench_rename" => {
                return self.benchmark.rename(
                    request["id"].as_str().context("Choose a benchmark")?,
                    request["name"].as_str().context("Enter a benchmark name")?,
                )
            }
            "bench_delete" => self
                .benchmark
                .delete(request["id"].as_str().context("Choose a benchmark")?)?,
            "set" => {
                let source = request["source"].as_str().context("Choose a wallpaper")?;
                let mut next = self.library.clone();
                let item = if next.items.iter().any(|i| i.id == source) {
                    source.to_string()
                } else {
                    next.import(&PathBuf::from(source))?
                };
                let group = Group {
                    id: format!("group-{}", timestamp()),
                    item,
                    outputs,
                    span: request["span"].as_bool().unwrap_or(false),
                    fps: request["fps"].as_u64().unwrap_or(30).try_into()?,
                    audio: request["audio"].as_bool().unwrap_or(false),
                    paused: false,
                    experiment: request["experiment"].as_str().unwrap_or("baseline").into(),
                    hdr: request["hdr"].as_bool().unwrap_or(false),
                    keep_playing: request["keep_playing"].as_bool().unwrap_or(false),
                    trace: request["trace"].as_bool().unwrap_or(false),
                };
                next.assign(group, &self.monitors)?;
                self.apply(next, !benchmark_owned)?;
            }
            "import" => {
                let mut next = self.library.clone();
                next.import(&PathBuf::from(
                    request["path"].as_str().context("Missing file path")?,
                ))?;
                next.save(&platform::data_file())?;
                self.library = next;
            }
            "choose" => {
                let folder = request["folder"].as_bool().unwrap_or(false);
                let dialog = gtk::FileChooserDialog::new(
                    Some(if folder {
                        "Import live wallpaper folder"
                    } else {
                        "Import wallpapers"
                    }),
                    self.ui.as_ref(),
                    if folder {
                        gtk::FileChooserAction::SelectFolder
                    } else {
                        gtk::FileChooserAction::Open
                    },
                );
                dialog.add_buttons(&[
                    ("Cancel", gtk::ResponseType::Cancel),
                    ("Import", gtk::ResponseType::Accept),
                ]);
                dialog.set_select_multiple(true);
                let owner = Rc::downgrade(owner);
                dialog.connect_response(move |dialog, response| {
                    if response == gtk::ResponseType::Accept {
                        if let Some(owner) = owner.upgrade() {
                            let mut desktop = owner.borrow_mut();
                            if desktop.benchmark.active() {
                                desktop.error = Some(
                                    "Import deferred: cancel the active benchmark first".into(),
                                );
                                dialog.close();
                                return;
                            }
                            for path in dialog.filenames() {
                                let mut next = desktop.library.clone();
                                match next
                                    .import(&path)
                                    .and_then(|_| next.save(&platform::data_file()))
                                {
                                    Ok(()) => desktop.library = next,
                                    Err(error) => desktop.error = Some(error.to_string()),
                                }
                            }
                        }
                    }
                    dialog.close();
                });
                dialog.show_all();
            }
            "clear" => {
                let mut next = self.library.clone();
                next.clear(&outputs);
                self.apply(next, !benchmark_owned)?;
            }
            "pause" => {
                let paused = request["paused"].as_bool().context("Missing pause state")?;
                // Split a span group when only some outputs are paused? Keep its geometry and
                // pause the group together, so synchronized playback is preserved.
                let mut next = self.library.clone();
                for group in &mut next.groups {
                    if outputs.is_empty() || group.outputs.iter().any(|o| outputs.contains(o)) {
                        group.paused = paused;
                    }
                }
                next.save(&platform::data_file())?;
                self.library = next;
            }
            "signal" => {
                let name = request["name"].as_str().context("Missing signal name")?;
                let event = json!({"name":name,"value":request["value"]});
                let mut sent = std::collections::HashSet::new();
                for surface in &self.surfaces {
                    if outputs.is_empty() || outputs.contains(&surface.output) {
                        if let Some(web) = &surface.web {
                            render::evaluate(
                                web,
                                &format!("window.__wallpaperHost?.signal({event})"),
                            );
                        }
                        if let Some(player) = &surface.experiment {
                            if sent.insert(Rc::as_ptr(player)) {
                                player.borrow_mut().send(&json!({"signal":event}));
                            }
                        }
                    }
                }
            }
            "interact" => {
                let output = request["output"].as_str().context("Missing output")?;
                let surface = self
                    .surfaces
                    .iter_mut()
                    .find(|s| s.output == output)
                    .context("No wallpaper on that monitor")?;
                if surface.experiment.is_some() {
                    bail!("Experiments use pointer tracking and explicit signal commands; focused desktop interaction belongs to the baseline.");
                }
                surface.interact(request["enabled"].as_bool().unwrap_or(false));
            }
            "ui" => {
                if let Some(window) = &self.ui {
                    window.show_all();
                    window.present();
                } else {
                    let window = gtk::Window::new(gtk::WindowType::Toplevel);
                    window.set_title("WallpaperDB · Desktop");
                    window.set_default_size(1240, 840);
                    let web = render::webview(&webkit2gtk::WebContext::new_ephemeral());
                    web.load_uri(&self.url);
                    window.add(&web);
                    let owner = Rc::downgrade(owner);
                    let ui_web = web.clone();
                    window.connect_delete_event(move |_, _| {
                        if let Some(owner) = owner.upgrade() {
                            let mut desktop = owner.borrow_mut();
                            if desktop.benchmark.active() {
                                desktop.error = Some("A benchmark is running. Use Stop and save or Cancel before closing the library.".into());
                                return glib::Propagation::Stop;
                            }
                            desktop.ui = None;
                        }
                        ui_web.terminate_web_process();
                        glib::Propagation::Proceed
                    });
                    window.show_all();
                    self.ui = Some(window);
                }
                if let (Some(fullscreen), Some(window)) =
                    (request["fullscreen"].as_bool(), self.ui.as_ref())
                {
                    if fullscreen {
                        window.fullscreen();
                    } else {
                        window.unfullscreen();
                    }
                }
            }
            "stop" => {
                if self.benchmark.active() {
                    self.stop_requested = true;
                    self.benchmark.cancel()?;
                } else {
                    gtk::main_quit();
                }
            }
            _ => bail!("Unknown operation: {op}"),
        }
        Ok(self.snapshot())
    }

    fn tick(&mut self) {
        let animated = self
            .surfaces
            .iter()
            .any(|s| s.web.is_some() || s.video.is_some() || s.experiment.is_some());
        if !animated {
            self.audio.set_active(false);
            return;
        }
        let cursor = platform::hypr("j/cursorpos").unwrap_or(Value::Null);
        let powered_off: Vec<_> = self
            .monitors
            .iter()
            .filter(|m| !m.powered)
            .map(|m| m.name.clone())
            .collect();
        let audio_active = self.surfaces.iter().any(|s| {
            (s.web.is_some() || s.experiment.is_some())
                && s.group.audio
                && (!self.suspended.contains(&s.output) || s.group.keep_playing)
                && !powered_off.contains(&s.output)
                && !self
                    .library
                    .groups
                    .iter()
                    .any(|g| g.id == s.group.id && g.paused)
        });
        self.audio.set_active(audio_active);
        let audio = self.audio.levels.lock().unwrap().clone();
        let mut sent = std::collections::HashSet::new();
        for surface in &mut self.surfaces {
            let paused = (self.suspended.contains(&surface.output) && !surface.group.keep_playing)
                || powered_off.contains(&surface.output)
                || self
                    .library
                    .groups
                    .iter()
                    .any(|g| g.id == surface.group.id && g.paused);
            if let Some(player) = &surface.experiment {
                if sent.insert(Rc::as_ptr(player)) {
                    let hidden = if surface.group.keep_playing {
                        &powered_off
                    } else {
                        &self.suspended
                    };
                    let all_hidden = if surface.group.span {
                        self.monitors
                            .iter()
                            .filter(|m| !m.disabled && surface.group.outputs.contains(&m.name))
                            .all(|m| hidden.contains(&m.name))
                    } else {
                        hidden.contains(&surface.output)
                    };
                    let manual = self
                        .library
                        .groups
                        .iter()
                        .any(|g| g.id == surface.group.id && g.paused);
                    let px = cursor["x"].as_f64().unwrap_or(0.);
                    let py = cursor["y"].as_f64().unwrap_or(0.);
                    let inside = self.monitors.iter().any(|monitor| {
                        let rect = monitor.rect();
                        (if surface.group.span {
                            surface.group.outputs.contains(&monitor.name)
                        } else {
                            surface.output == monitor.name
                        }) && px >= monitor.x as f64
                            && py >= monitor.y as f64
                            && px < (monitor.x + rect.width) as f64
                            && py < (monitor.y + rect.height) as f64
                    });
                    let pointer = json!({"x":(px-(surface.monitor.x-surface.crop.x) as f64)/surface.canvas.width as f64,"y":(py-(surface.monitor.y-surface.crop.y) as f64)/surface.canvas.height as f64,"inside":inside});
                    let mut input =
                        json!({"paused":manual||all_hidden,"pointer":pointer,"hidden":hidden});
                    // Covered outputs cannot promise compositor frame callbacks,
                    // even when the producer is allowed to keep playing behind them.
                    if surface.group.experiment == "gpu-paced" {
                        input["covered"] = json!(self.suspended);
                    }
                    if surface.group.audio {
                        input["audio"] = json!(audio);
                    }
                    let mut player = player.borrow_mut();
                    player.send(&input);
                    *surface.telemetry.borrow_mut() = player.snapshot();
                } else {
                    *surface.telemetry.borrow_mut() = player.borrow_mut().snapshot();
                }
                surface.paused = paused;
                continue;
            }
            if let Some(video) = &mut surface.video {
                video.tick(paused, paused != surface.paused);
                *surface.telemetry.borrow_mut() = video.telemetry.clone();
                surface.paused = paused;
                continue;
            }
            if surface.web.is_none() {
                continue;
            }
            if paused && surface.paused {
                continue;
            }
            let px = cursor["x"].as_f64().unwrap_or(0.);
            let py = cursor["y"].as_f64().unwrap_or(0.);
            let origin_x = surface.monitor.x - surface.crop.x;
            let origin_y = surface.monitor.y - surface.crop.y;
            let pointer = json!({"x":(px-origin_x as f64)/surface.canvas.width as f64,"y":(py-origin_y as f64)/surface.canvas.height as f64,"inside":px>=surface.monitor.x as f64 && px<(surface.monitor.x+surface.monitor.width) as f64 && py>=surface.monitor.y as f64 && py<(surface.monitor.y+surface.monitor.height) as f64});
            let input = if surface.group.audio {
                json!({"paused":paused,"pointer":pointer,"audio":audio})
            } else {
                json!({"paused":paused,"pointer":pointer})
            };
            surface.update(paused, input);
            if surface.interactive && surface.telemetry.borrow()["lastSignal"]["value"] == "Escape"
            {
                surface.interact(false);
            }
        }
    }
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn daemon(port: u16) -> Result<()> {
    platform::session()?;
    gtk::init().context("Cannot initialize GTK on Wayland")?;
    if !gtk_layer_shell::is_supported() {
        bail!("The compositor does not support wlr-layer-shell");
    }
    let monitors = platform::monitors()?;
    // Acquire the singleton lock before any library writes. A second daemon
    // must not race an active instance's atomic state-file replacement.
    let (tx, rx) = mpsc::channel();
    let servers = server::start(tx, port)?;
    let path = platform::data_file();
    let mut library = if path.exists() {
        serde_json::from_slice::<Library>(&fs::read(&path)?)
            .context("Cannot read saved library; the existing file was preserved")?
    } else {
        Library::default()
    };
    let examples = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("examples");
    for sample in [
        "Rose mountains.svg",
        "Blue hour.svg",
        "Drifting dusk.mp4",
        "rose-clock",
        "tide",
        "prism",
        "hdr-calibration",
        "HDR reference.avif",
        "HDR reference.mkv",
    ] {
        if examples.join(sample).exists() {
            let _ = library.import(&examples.join(sample));
        }
    }
    library.save(&path)?;
    eprintln!("WallpaperDB native · {}", servers.url);
    let desktop = Rc::new(RefCell::new(Desktop {
        library: library.clone(),
        monitors,
        surfaces: vec![],
        audio: audio::Audio::new(),
        ui: None,
        url: servers.url.clone(),
        epoch: timestamp(),
        error: None,
        suspended: vec![],
        reconcile_pending: false,
        benchmark: benchmark::Benchmark::new(),
        stop_requested: false,
    }));
    let initial = desktop.borrow_mut().apply(library, false);
    if let Err(error) = initial {
        desktop.borrow_mut().error = Some(error.to_string());
    }
    let owner = desktop.clone();
    glib::timeout_add_local(Duration::from_millis(500), move || {
        let mut desktop = owner.borrow_mut();
        if let Some(mut library) = desktop.benchmark.poll() {
            let graphics_fault = desktop.benchmark.state["graphics_fault"] == true
                || benchmark::graphics_fault().is_some();
            if graphics_fault {
                library.groups.clear();
            }
            let error = desktop.apply(library, false).err().map(|e| e.to_string())
                .or_else(|| graphics_fault.then(|| "GPU fault: prototype wallpapers remain stopped; the original assignments are in library-before.json".into()));
            desktop.benchmark.restored(error);
            if desktop.stop_requested {
                gtk::main_quit();
            }
        }
        glib::ControlFlow::Continue
    });
    let owner = desktop.clone();
    glib::timeout_add_local(Duration::from_millis(25), move || {
        // Bounded queue drain; a burst of clients cannot starve GTK rendering.
        for _ in 0..8 {
            let Ok((request, reply)) = rx.try_recv() else {
                break;
            };
            let result = owner
                .borrow_mut()
                .execute(request, &owner)
                .unwrap_or_else(|e| json!({"error":e.to_string()}));
            let _ = reply.send(result);
        }
        glib::ControlFlow::Continue
    });
    let owner = desktop.clone();
    glib::timeout_add_local(Duration::from_millis(50), move || {
        owner.borrow_mut().tick();
        glib::ControlFlow::Continue
    });
    let owner = desktop.clone();
    glib::timeout_add_seconds_local(2, move || {
        let mut desktop = owner.borrow_mut();
        if let Ok(monitors) = platform::monitors() {
            desktop.suspended = platform::fullscreen_outputs(&monitors);
            if monitors != desktop.monitors || desktop.reconcile_pending {
                desktop.monitors = monitors;
                let next = desktop.library.clone();
                if let Err(error) = desktop.apply(next, false) {
                    desktop.error = Some(error.to_string());
                    desktop.reconcile_pending = true;
                }
            }
        }
        glib::ControlFlow::Continue
    });
    for signal in [libc::SIGTERM, libc::SIGINT] {
        let owner = desktop.clone();
        glib::source::unix_signal_add_local(signal, move || {
            let mut desktop = owner.borrow_mut();
            if desktop.benchmark.active() {
                desktop.stop_requested = true;
                if let Err(error) = desktop.benchmark.cancel() {
                    desktop.error = Some(error.to_string());
                }
            } else {
                gtk::main_quit();
            }
            glib::ControlFlow::Continue
        });
    }
    gtk::main();
    desktop.borrow_mut().surfaces.clear();
    desktop.borrow_mut().audio.set_active(false);
    let _ = fs::remove_file(platform::runtime_dir().join("control.sock"));
    drop(servers);
    Ok(())
}
