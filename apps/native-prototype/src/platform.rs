use crate::model::Monitor;
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    env, fs,
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    time::Duration,
};

pub fn session() -> Result<()> {
    let runtime = env::var("XDG_RUNTIME_DIR")
        .unwrap_or_else(|_| format!("/run/user/{}", unsafe { libc::getuid() }));
    env::set_var("XDG_RUNTIME_DIR", &runtime);
    if env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_none() {
        let instances: Vec<_> = fs::read_dir(PathBuf::from(&runtime).join("hypr"))?
            .flatten()
            .filter(|p| p.path().join(".socket.sock").exists())
            .collect();
        if instances.len() != 1 {
            bail!(
                "Run inside the intended Hyprland session (HYPRLAND_INSTANCE_SIGNATURE is missing)"
            );
        }
        env::set_var("HYPRLAND_INSTANCE_SIGNATURE", instances[0].file_name());
    }
    if env::var_os("WAYLAND_DISPLAY").is_none() {
        let displays: Vec<_> = fs::read_dir(&runtime)?
            .flatten()
            .filter(|p| {
                use std::os::unix::fs::FileTypeExt;
                p.file_name().to_string_lossy().starts_with("wayland-")
                    && p.file_type().map(|f| f.is_socket()).unwrap_or(false)
                    && !p.file_name().to_string_lossy().contains("swww")
            })
            .collect();
        if displays.len() != 1 {
            bail!("WAYLAND_DISPLAY is missing; run from your desktop terminal");
        }
        env::set_var("WAYLAND_DISPLAY", displays[0].file_name());
    }
    env::set_var("GDK_BACKEND", "wayland");
    // WebKitGTK + NVIDIA can commit without an acquire timeline (bug 280210).
    // Disabling explicit sync alone fixed image scenes but stalled video scenes
    // on the tested driver. This path passed both. Respect explicit overrides.
    if PathBuf::from("/sys/module/nvidia").exists()
        && env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if PathBuf::from("/sys/module/nvidia").exists()
        && !PathBuf::from("/usr/lib/libnvrtc.so").exists()
        && env::var_os("GST_PLUGIN_FEATURE_RANK").is_none()
    {
        // The CUDA conversion stage cannot negotiate video on this installation.
        // Only WebKit scene media uses this fallback; ordinary video uses libmpv.
        env::set_var(
            "GST_PLUGIN_FEATURE_RANK",
            "nvh264dec:0,nvh265dec:0,nvvp9dec:0,nvav1dec:0",
        );
    }
    Ok(())
}

pub fn hypr(command: &str) -> Result<Value> {
    let path = PathBuf::from(env::var("XDG_RUNTIME_DIR")?)
        .join("hypr")
        .join(env::var("HYPRLAND_INSTANCE_SIGNATURE")?)
        .join(".socket.sock");
    let mut socket = UnixStream::connect(path).context("Cannot connect to Hyprland")?;
    socket.set_read_timeout(Some(Duration::from_millis(500)))?;
    socket.set_write_timeout(Some(Duration::from_millis(500)))?;
    socket.write_all(command.as_bytes())?;
    let mut out = String::new();
    socket.read_to_string(&mut out)?;
    Ok(serde_json::from_str(&out)?)
}

pub fn monitors() -> Result<Vec<Monitor>> {
    Ok(serde_json::from_value(hypr("j/monitors")?)?)
}

pub fn fullscreen_outputs(monitors: &[Monitor]) -> Vec<String> {
    let workspaces = hypr("j/workspaces").unwrap_or(Value::Null);
    let active = hypr("j/monitors").unwrap_or(Value::Null);
    monitors
        .iter()
        .filter(|m| {
            if !m.powered {
                return true;
            }
            let workspace = active
                .as_array()
                .and_then(|arr| arr.iter().find(|v| v["name"] == m.name))
                .and_then(|v| v["activeWorkspace"]["id"].as_i64());
            workspaces.as_array().is_some_and(|arr| {
                arr.iter().any(|w| {
                    w["id"].as_i64() == workspace && w["hasfullscreen"].as_bool() == Some(true)
                })
            })
        })
        .map(|m| m.name.clone())
        .collect()
}

pub fn data_file() -> PathBuf {
    let base = env::var_os("WALLPAPERDB_NATIVE_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env::var_os("HOME").unwrap()).join(".local/share"))
                .join("wallpaperdb-native-prototype")
        });
    base.join("library.json")
}

pub fn runtime_dir() -> PathBuf {
    PathBuf::from(
        env::var("XDG_RUNTIME_DIR")
            .unwrap_or_else(|_| format!("/run/user/{}", unsafe { libc::getuid() })),
    )
    .join("wallpaperdb-native-prototype")
}
