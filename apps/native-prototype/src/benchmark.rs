//! Disposable real-game jobs. The desktop owns restoration; the worker owns game processes.
use crate::{model::Library, platform};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
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

fn base_directory() -> PathBuf {
    platform::data_file().parent().unwrap().join("benchmarks")
}

fn job_path(base: &Path, id: &str) -> Result<PathBuf> {
    if !id.strip_prefix("game-").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        bail!("Invalid benchmark identifier");
    }
    Ok(base.join(id))
}

fn read_json(path: impl AsRef<Path>) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

pub fn graphics_fault() -> Option<Value> {
    let receipt = read_json(platform::runtime_dir().join("graphics-fault.json"))?;
    let session = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
    (receipt["session"] == session && receipt["boot_id"] == boot.trim()).then_some(receipt)
}

fn visible_request(mut request: Value) -> Value {
    if let Some(object) = request.as_object_mut() {
        for key in ["bench_token", "control", "directory", "op"] {
            object.remove(key);
        }
    }
    request
}

fn history_entry(directory: &Path, active: Option<Value>) -> Option<Value> {
    let id = directory.file_name()?.to_str()?;
    job_path(directory.parent()?, id).ok()?;
    let metadata = read_json(directory.join("metadata.json"));
    let request = visible_request(
        metadata
            .as_ref()
            .and_then(|m| m.get("request"))
            .cloned()
            .or_else(|| read_json(directory.join("job.json")))?,
    );
    let wallpaper = metadata
        .as_ref()
        .and_then(|m| m.get("wallpaper"))
        .cloned()
        .or_else(|| {
            read_json(directory.join("library-before.json"))?["items"]
                .as_array()?
                .iter()
                .find(|item| item["id"] == request["source"])
                .map(|item| json!({"id":item["id"],"title":item["title"],"kind":item["kind"]}))
        })
        .unwrap_or_else(
            || json!({"id":request["source"],"title":"Wallpaper no longer in library"}),
        );
    let is_active = active.is_some();
    let mut status = active
        .or_else(|| read_json(directory.join("desktop-status.json")))
        .or_else(|| read_json(directory.join("status.json")))
        .unwrap_or_else(|| json!({"state":"interrupted","phase":"No final status was saved"}));
    if !is_active
        && !matches!(
            status["state"].as_str(),
            Some("complete" | "stopped" | "cancelled" | "failed")
        )
    {
        status["state"] = json!("interrupted");
        status["phase"] = json!("The worker ended without a final desktop status");
    }
    status["active"] = json!(is_active);
    status["id"] = json!(id);
    // Process/control paths belong in private receipts, not in the history cards.
    status.as_object_mut()?.remove("directory");
    Some(json!({
        "id":id,
        "created_ms":id.strip_prefix("game-")?.parse::<u128>().ok()? / 1_000_000,
        "request":request,"wallpaper":wallpaper,"status":status,
        "has_result":directory.join("result.json").is_file(),
    }))
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
        let base = base_directory();
        if let Ok(entries) = fs::read_dir(base) {
            let latest = entries
                .flatten()
                .filter_map(|entry| {
                    let directory = entry.path();
                    let state: Value = serde_json::from_slice(
                        &fs::read(directory.join("desktop-status.json")).ok()?,
                    )
                    .ok()?;
                    (matches!(state["state"].as_str(), Some("complete" | "stopped"))
                        && directory.join("result.json").is_file())
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
        if graphics_fault().is_some() {
            bail!("Bench is paused for this graphics session after a kernel GPU fault");
        }
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
        let item = library.items.iter().find(|item| item.id == source).unwrap();
        fs::write(
            directory.join("metadata.json"),
            serde_json::to_vec_pretty(&json!({
                "request":visible_request(job.clone()),
                "wallpaper":{"id":item.id,"title":item.title,"kind":item.kind},
            }))?,
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

    pub fn finish(&mut self) -> Result<()> {
        if self.active() {
            fs::write(self.directory.as_ref().unwrap().join("finish"), b"finish\n")?;
            self.state["state"] = json!("stopping");
            self.state["phase"] = json!("Saving captured data and restoring your desktop");
        }
        Ok(())
    }

    pub fn next_phase(&mut self) -> Result<()> {
        if !self.active() || self.state["can_next"] != true {
            bail!("The benchmark is not ready for its next recording phase");
        }
        let next = if self.state["recording"] == "control" {
            "wallpaper"
        } else {
            "control"
        };
        fs::write(self.directory.as_ref().unwrap().join("next-phase"), next)?;
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
            self.state["state"] = json!(if self.state["stopped"] == true {
                "stopped"
            } else {
                "complete"
            });
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

    fn directory_for(&self, id: Option<&str>) -> Result<PathBuf> {
        match id {
            Some(id) => job_path(&base_directory(), id),
            None => self.directory.clone().context("No benchmark selected"),
        }
    }

    fn entry(&self, directory: &Path) -> Result<Value> {
        let active = (self.active() && self.directory.as_deref() == Some(directory))
            .then(|| self.snapshot());
        history_entry(directory, active)
            .context("Benchmark is missing or its metadata is unreadable")
    }

    pub fn history(&self) -> Result<Value> {
        let base = base_directory();
        fs::create_dir_all(&base)?;
        let mut entries: Vec<Value> = fs::read_dir(base)?
            .flatten()
            .filter_map(|entry| self.entry(&entry.path()).ok())
            .collect();
        entries.sort_by(|a, b| b["id"].as_str().cmp(&a["id"].as_str()));
        Ok(json!({"benchmarks":entries}))
    }

    pub fn record(&self, id: Option<&str>) -> Result<Value> {
        let directory = self.directory_for(id)?;
        let mut entry = self.entry(&directory)?;
        entry["result"] = read_json(directory.join("result.json")).unwrap_or(Value::Null);
        entry["live"] = read_json(directory.join("live.json")).unwrap_or(Value::Null);
        Ok(entry)
    }

    pub fn live(&self, id: Option<&str>) -> Result<Value> {
        let directory = self.directory_for(id)?;
        let mut entry = self.entry(&directory)?;
        entry["live"] = read_json(directory.join("live.json")).unwrap_or(Value::Null);
        Ok(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_ids_cannot_escape_the_job_directory() {
        let root = PathBuf::from("/tmp/bench-history");
        assert_eq!(job_path(&root, "game-123").unwrap(), root.join("game-123"));
        for id in [
            "../secret",
            "game-../secret",
            "game-",
            "game-12/34",
            "/game-12",
        ] {
            assert!(job_path(&root, id).is_err(), "{id}");
        }
    }

    #[test]
    fn history_keeps_options_without_worker_credentials() {
        let request = visible_request(
            json!({"source":"prism","cpu_temperature_check":false,"mode":"manual","bench_token":"secret","control":"socket","directory":"private","op":"bench_start"}),
        );
        assert_eq!(request["cpu_temperature_check"], false);
        assert_eq!(request["mode"], "manual");
        for key in ["bench_token", "control", "directory", "op"] {
            assert!(request.get(key).is_none());
        }
    }

    #[test]
    fn old_jobs_get_a_readable_history_entry_without_loading_frame_data() {
        let root = std::env::temp_dir().join(format!(
            "wallpaperdb-history-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let directory = root.join("game-123000000");
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("job.json"),
            r#"{"source":"image","game":"cs2","cap":120,"bench_token":"secret"}"#,
        )
        .unwrap();
        fs::write(
            directory.join("library-before.json"),
            r#"{"items":[{"id":"image","title":"My wallpaper","kind":"image"}]}"#,
        )
        .unwrap();
        fs::write(directory.join("status.json"), r#"{"state":"running"}"#).unwrap();
        fs::write(
            directory.join("result.json"),
            "deliberately not read for the history list",
        )
        .unwrap();
        let row = history_entry(&directory, None).unwrap();
        assert_eq!(row["wallpaper"]["title"], "My wallpaper");
        assert_eq!(row["request"]["cap"], 120);
        assert_eq!(row["status"]["state"], "interrupted");
        assert_eq!(row["has_result"], true);
        assert!(row["request"].get("bench_token").is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
