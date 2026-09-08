//! Disposable real-game jobs. The desktop owns restoration; the worker owns game processes.
use crate::{model::Library, platform};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

pub struct Benchmark {
    child: Option<Child>,
    saved: Option<Library>,
    directory: Option<PathBuf>,
    token: String,
    pub state: Value,
    exit_ok: bool,
}

impl Benchmark {
    pub fn new() -> Self {
        let mut benchmark = Self {
            child: None,
            saved: None,
            directory: None,
            token: String::new(),
            state: json!({"state":"idle"}),
            exit_ok: false,
        };
        // Keep the latest successful comparison inspectable after a prototype restart.
        let base = platform::data_file().parent().unwrap().join("benchmarks");
        if let Ok(entries) = fs::read_dir(base) {
            let latest = entries
                .flatten()
                .filter_map(|entry| {
                    let directory = entry.path();
                    let state: Value = serde_json::from_slice(
                        &fs::read(directory.join("desktop-status.json")).ok()?,
                    )
                    .ok()?;
                    (state["state"] == "complete" && directory.join("result.json").is_file())
                        .then_some((directory, state))
                })
                .max_by(|a, b| a.0.cmp(&b.0));
            if let Some((directory, state)) = latest {
                benchmark.directory = Some(directory);
                benchmark.state = state;
            }
        }
        benchmark
    }

    pub fn active(&self) -> bool {
        self.child.is_some() || self.saved.is_some()
    }

    pub fn snapshot(&self) -> Value {
        let mut state = self.state.clone();
        state["active"] = json!(self.active());
        state
    }

    pub fn owns(&self, request: &Value) -> bool {
        self.active()
            && !self.token.is_empty()
            && request["bench_token"].as_str() == Some(&self.token)
    }

    pub fn start(&mut self, request: &Value, library: &Library) -> Result<()> {
        if self.active() {
            bail!("A benchmark is already running");
        }
        let source = request["source"]
            .as_str()
            .context("Select a wallpaper first")?;
        if !library.items.iter().any(|item| item.id == source) {
            bail!("Select an installed wallpaper");
        }
        if request["experiment"] == "chromium-dmabuf" {
            bail!("DMA-BUF failed pixel validation and is unavailable for Bench");
        }
        let id = format!(
            "game-{}",
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
        );
        let directory = platform::data_file()
            .parent()
            .unwrap()
            .join("benchmarks")
            .join(&id);
        fs::create_dir_all(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        let mut random = [0_u8; 24];
        fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        self.token = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let mut job = request.clone();
        job["id"] = json!(id);
        job["bench_token"] = json!(self.token);
        job["directory"] = json!(directory);
        job["control"] = json!(platform::runtime_dir().join("control.sock"));
        fs::write(directory.join("job.json"), serde_json::to_vec_pretty(&job)?)?;
        fs::write(
            directory.join("library-before.json"),
            serde_json::to_vec_pretty(library)?,
        )?;
        let log = fs::File::create(directory.join("worker.log"))?;
        let child = Command::new("python3")
            .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/game_bench.py"))
            .arg("--job")
            .arg(directory.join("job.json"))
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .spawn()?;
        self.saved = Some(library.clone());
        self.child = Some(child);
        self.directory = Some(directory.clone());
        self.state = json!({"id":id,"state":"starting","phase":"Checking game and replay","directory":directory,"completed":0,"total":1});
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<()> {
        if self.active() {
            fs::write(self.directory.as_ref().unwrap().join("cancel"), b"cancel\n")?;
            self.state["state"] = json!("cancelling");
            self.state["phase"] = json!("Stopping the game and restoring your desktop");
        }
        Ok(())
    }

    /// Poll independently of renderer ticks: the control condition may have no surfaces.
    pub fn poll(&mut self) -> Option<Library> {
        let child = self.child.as_mut()?;
        let directory = self.directory.as_ref().unwrap();
        if let Ok(bytes) = fs::read(directory.join("status.json")) {
            if let Ok(mut state) = serde_json::from_slice::<Value>(&bytes) {
                if state["id"] == self.state["id"] {
                    // Worker success is provisional until the desktop restores its saved groups.
                    if state["state"] == "complete" {
                        state["state"] = json!("restoring");
                    }
                    self.state = state;
                }
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // The final write may race the earlier status read.
                if let Ok(bytes) = fs::read(directory.join("status.json")) {
                    if let Ok(mut state) = serde_json::from_slice::<Value>(&bytes) {
                        if state["id"] == self.state["id"] {
                            if state["state"] == "complete" {
                                state["state"] = json!("restoring");
                            }
                            self.state = state;
                        }
                    }
                }
                self.exit_ok = status.success();
                self.child = None;
                self.saved.take()
            }
            Err(error) => {
                self.state["error"] = json!(error.to_string());
                None
            }
            Ok(None) => None,
        }
    }

    pub fn restored(&mut self, error: Option<String>) {
        let restored = error.is_none();
        let cancelled = self
            .directory
            .as_ref()
            .is_some_and(|p| p.join("cancel").exists());
        if let Some(error) = error {
            self.state["state"] = json!("failed");
            self.state["error"] = json!(format!(
                "Wallpaper restoration failed: {error}. Saved library is preserved."
            ));
        } else if cancelled && self.state["state"] != "failed" {
            self.state["state"] = json!("cancelled");
        } else if self.exit_ok && self.state["state"] == "restoring" {
            self.state["state"] = json!("complete");
        } else {
            self.state["state"] = json!("failed");
            if self.state["error"].is_null() {
                self.state["error"] =
                    json!("Benchmark worker exited without a valid result; inspect worker.log");
            }
        }
        self.state["wallpapers_restored"] = json!(restored);
        if let Some(directory) = &self.directory {
            let _ = fs::write(
                directory.join("desktop-status.json"),
                self.state.to_string(),
            );
        }
        self.token.clear();
    }

    pub fn result(&self) -> Result<Value> {
        let directory = self
            .directory
            .as_ref()
            .context("No benchmark has run yet")?;
        let result: Value = serde_json::from_slice(&fs::read(directory.join("result.json"))?)?;
        Ok(result)
    }
}
