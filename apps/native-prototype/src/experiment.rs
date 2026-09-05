//! Disposable group players. Sidecars let experiments evolve without changing the baseline.
use crate::{
    model::{viewport, Group, Item, Kind, Monitor},
    platform,
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::fd::AsRawFd,
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

static NEXT_PLAYER: AtomicU64 = AtomicU64::new(0);

pub struct Player {
    child: Child,
    input: ChildStdin,
    pub telemetry: Arc<Mutex<Value>>,
}
impl Player {
    pub fn new(group: &Group, item: &Item, monitors: &[Monitor]) -> Result<Self> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let presenter = root.join("lab/build/presenter");
        if !presenter.is_file()
            || (group.experiment.starts_with("chromium")
                && !root.join("lab/build/dmabuf.node").is_file())
        {
            bail!("Build the renderer experiments with make native-lab-build first.");
        }
        let members: Vec<_> = monitors
            .iter()
            .filter(|m| group.outputs.contains(&m.name) && !m.disabled)
            .collect();
        let first = members.first().context("No connected group members")?;
        let (canvas, _) = viewport(group, first, monitors);
        let id = format!(
            "lab-{}-{}-{}",
            crate::timestamp(),
            std::process::id(),
            NEXT_PLAYER.fetch_add(1, Ordering::Relaxed)
        );
        let base = platform::runtime_dir().join(id);
        let path = base.with_extension("json");
        let script = item.path.parent().unwrap().join("scene.lua");
        if group.experiment == "gpu" && item.kind == Kind::Live && !script.is_file() {
            bail!("This live bundle has no scene.lua. Try Prism laboratory or an HDR reference scene with Lua / GPU.");
        }
        let outputs: Vec<_> = members
            .iter()
            .map(|m| {
                let (_, r) = viewport(group, m, monitors);
                json!({
                    "name": m.name,
                    "width": r.width,
                    "height": r.height,
                    "crop_x": r.x,
                    "crop_y": r.y,
                    "pixel_width": m.width,
                    "pixel_height": m.height,
                })
            })
            .collect();
        let frame_file = group.trace.then(|| base.with_extension("csv"));
        let config = json!({
            "experiment": group.experiment,
            "hdr": group.hdr,
            "fps": group.fps,
            "width": canvas.width,
            "height": canvas.height,
            "outputs": outputs,
            "script": if item.kind == Kind::Live { script.to_string_lossy().into_owned() } else { String::new() },
            "source": item.path,
            "kind": item.kind,
            "media": if item.kind != Kind::Live { item.path.to_string_lossy().into_owned() } else { String::new() },
            "socket": base.with_extension("sock"),
            "frames": frame_file.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
            "epoch": crate::timestamp(),
        });
        fs::write(&path, serde_json::to_vec_pretty(&config)?)?;
        let log = fs::File::create(base.with_extension("log"))?;
        let mut command = if group.experiment.starts_with("chromium") {
            let mut cmd = Command::new(
                std::env::var("WALLPAPERDB_ELECTRON").unwrap_or_else(|_| "electron42".into()),
            );
            cmd.arg("--ozone-platform=wayland")
                .arg(root.join("lab/electron.cjs"));
            cmd
        } else {
            Command::new(presenter)
        };
        command
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(log);
        command.env_remove("ELECTRON_RUN_AS_NODE");
        let mut child = command
            .spawn()
            .context("Build experiments with make native-lab-build (Chromium needs electron42)")?;
        let input = child.stdin.take().unwrap();
        // A stalled experiment must not block the desktop's GTK/control loop.
        unsafe {
            let fd = input.as_raw_fd();
            libc::fcntl(
                fd,
                libc::F_SETFL,
                libc::fcntl(fd, libc::F_GETFL) | libc::O_NONBLOCK,
            );
        }
        let output = child.stdout.take().unwrap();
        let telemetry = Arc::new(Mutex::new(
            json!({"state":"loading","renderer":group.experiment,"log":base.with_extension("log"),"frames_file":frame_file}),
        ));
        let stats = telemetry.clone();
        let log_file = base.with_extension("log");
        thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Ok(mut value) = serde_json::from_str::<Value>(&line) {
                    value["frames_file"] = json!(frame_file);
                    value["log"] = json!(log_file);
                    *stats.lock().unwrap() = value;
                }
            }
        });
        Ok(Self {
            child,
            input,
            telemetry,
        })
    }
    pub fn send(&mut self, value: &Value) {
        if let Ok(mut bytes) = serde_json::to_vec(value) {
            bytes.push(b'\n');
            // Messages are smaller than PIPE_BUF: either deliver the entire update or
            // drop it under backpressure. The next update contains the current state.
            if bytes.len() <= 4096 {
                let _ = self.input.write(&bytes);
            }
        }
    }
    pub fn snapshot(&mut self) -> Value {
        if let Ok(Some(status)) = self.child.try_wait() {
            let mut s = self.telemetry.lock().unwrap();
            s["state"] = json!("error");
            if s["error"].is_null() {
                s["error"] = json!(format!("Experiment exited: {status}"));
            }
            s["exit_status"] = json!(status.to_string());
        }
        self.telemetry.lock().unwrap().clone()
    }
}
impl Drop for Player {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return;
        }
        let _ = unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
