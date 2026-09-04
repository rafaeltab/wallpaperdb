use crate::{model::Rect, platform};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

pub struct Video {
    child: Child,
    socket: PathBuf,
    epoch: u64,
    last_poll: Instant,
    pub telemetry: Value,
}

/// Cover the entire group, then crop each output from that shared source rectangle.
pub fn source_crop(width: i32, height: i32, canvas: Rect, view: Rect) -> Rect {
    let factor = (canvas.width as f64 / width as f64).max(canvas.height as f64 / height as f64);
    let x = ((view.x as f64 - (canvas.width as f64 - width as f64 * factor) / 2.) / factor).round()
        as i32;
    let y = ((view.y as f64 - (canvas.height as f64 - height as f64 * factor) / 2.) / factor)
        .round() as i32;
    Rect {
        x,
        y,
        width: ((view.width as f64 / factor).round() as i32)
            .min(width - x)
            .max(1),
        height: ((view.height as f64 / factor).round() as i32)
            .min(height - y)
            .max(1),
    }
}

impl Video {
    pub fn new(
        path: &Path,
        output: &str,
        canvas: Rect,
        view: Rect,
        span: bool,
        epoch: u64,
    ) -> Result<Self> {
        let socket =
            platform::runtime_dir().join(format!("video-{}-{output}.sock", crate::timestamp()));
        let mut crop = String::new();
        if span {
            let result = Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height:stream_side_data=rotation",
                    "-of",
                    "json",
                ])
                .arg(path)
                .output()
                .context("Install ffmpeg for spanning videos")?;
            if !result.status.success() {
                bail!("Cannot read video dimensions");
            }
            let info: Value = serde_json::from_slice(&result.stdout)?;
            let stream = &info["streams"][0];
            let w = stream["width"].as_i64().context("Video has no width")? as i32;
            let h = stream["height"].as_i64().context("Video has no height")? as i32;
            let rotation = stream["side_data_list"]
                .as_array()
                .and_then(|a| a.iter().find_map(|v| v["rotation"].as_i64()))
                .unwrap_or(0)
                .rem_euclid(360);
            let mut r = source_crop(
                if rotation % 180 != 0 { h } else { w },
                if rotation % 180 != 0 { w } else { h },
                canvas,
                view,
            );
            // ffprobe's rotation is counterclockwise; mpv crops before applying it.
            r = match rotation {
                90 => Rect {
                    x: w - r.y - r.height,
                    y: r.x,
                    width: r.height,
                    height: r.width,
                },
                180 => Rect {
                    x: w - r.x - r.width,
                    y: h - r.y - r.height,
                    ..r
                },
                270 => Rect {
                    x: r.y,
                    y: h - r.x - r.width,
                    width: r.height,
                    height: r.width,
                },
                _ => r,
            };
            crop = format!(" video-crop={}x{}+{}+{}", r.width, r.height, r.x, r.y);
        }
        let options=format!("no-config no-audio loop-file=inf hwdec=auto-safe panscan=1 osd-level=0 input-default-bindings=no stop-screensaver=no input-ipc-server={}{}",socket.display(),crop);
        let log = fs::File::create(socket.with_extension("log"))?;
        let child = Command::new("mpvpaper")
            .arg("-o")
            .arg(options)
            .arg(output)
            .arg(path)
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .spawn()
            .context("Install mpvpaper to play video wallpapers")?;
        Ok(Self {
            child,
            socket,
            epoch,
            last_poll: Instant::now() - Duration::from_secs(2),
            telemetry: json!({"state":"loading","renderer":"mpv","fps":0}),
        })
    }

    fn command(&self, command: Value) -> Result<Value> {
        let mut socket = UnixStream::connect(&self.socket)?;
        socket.set_read_timeout(Some(Duration::from_millis(150)))?;
        socket.set_write_timeout(Some(Duration::from_millis(150)))?;
        serde_json::to_writer(&mut socket, &json!({"command":command,"request_id":1}))?;
        socket.write_all(b"\n")?;
        let mut reader = BufReader::new(socket).take(65536);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                bail!("mpv closed its control socket");
            }
            let reply: Value = serde_json::from_str(&line)?;
            if reply["request_id"] == 1 {
                if reply["error"] != "success" {
                    bail!("mpv: {}", reply["error"]);
                }
                return Ok(reply["data"].clone());
            }
        }
    }

    pub fn tick(&mut self, paused: bool, changed: bool) {
        if changed {
            let _ = self.command(json!(["set_property", "pause", paused]));
        }
        if self.last_poll.elapsed() < Duration::from_secs(1) {
            return;
        }
        self.last_poll = Instant::now();
        // Also enforce it after startup, when the IPC socket may not yet exist
        // at the first pause transition (e.g. a saved, paused layout).
        let _ = self.command(json!(["set_property", "pause", paused]));
        if let Ok(Some(status)) = self.child.try_wait() {
            self.telemetry = json!({"error":format!("mpvpaper exited ({status}); see {}",self.socket.with_extension("log").display())});
            return;
        }
        let Ok(time) = self.command(json!(["get_property", "time-pos"])) else {
            return;
        };
        let duration = self
            .command(json!(["get_property", "duration"]))
            .unwrap_or(Value::Null);
        if !paused {
            if let (Some(t), Some(d)) = (time.as_f64(), duration.as_f64().filter(|d| *d > 0.)) {
                let target = (crate::timestamp() - self.epoch) as f64 / 1000. % d;
                if (t - target).abs() > 0.25 {
                    let _ = self.command(json!(["seek", target, "absolute+exact"]));
                }
            }
        }
        let hwdec = self
            .command(json!(["get_property", "hwdec-current"]))
            .unwrap_or(Value::Null);
        let fps = self
            .command(json!(["get_property", "container-fps"]))
            .unwrap_or(Value::Null);
        self.telemetry = json!({"state":"ready","renderer":"mpv","pid":self.child.id(),"time":time,"duration":duration,"hwdec":hwdec,"fps":fps,"paused":paused});
    }
}
impl Drop for Video {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.socket);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spanning_video_crops_adjacent_source_regions() {
        let canvas = Rect {
            x: 0,
            y: 0,
            width: 3840,
            height: 1080,
        };
        let left = source_crop(
            1920,
            1080,
            canvas,
            Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        );
        let right = source_crop(
            1920,
            1080,
            canvas,
            Rect {
                x: 1920,
                y: 0,
                width: 1920,
                height: 1080,
            },
        );
        assert_eq!(
            left,
            Rect {
                x: 0,
                y: 270,
                width: 960,
                height: 540
            }
        );
        assert_eq!(
            right,
            Rect {
                x: 960,
                y: 270,
                width: 960,
                height: 540
            }
        );
        assert_eq!(left.x + left.width, right.x);
    }
}
