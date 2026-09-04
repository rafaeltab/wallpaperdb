use crate::platform;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    os::{
        fd::AsRawFd,
        unix::{
            fs::PermissionsExt,
            net::{UnixListener, UnixStream},
        },
    },
    path::PathBuf,
    sync::mpsc,
    thread,
    time::Duration,
};
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub type Request = (Value, mpsc::Sender<Value>);
pub type Sender = mpsc::Sender<Request>;
pub struct Servers {
    pub url: String,
    _lock: File,
}

fn ask(sender: &Sender, value: Value) -> Value {
    let (tx, rx) = mpsc::channel();
    if sender.send((value, tx)).is_err() {
        return json!({"error":"Daemon stopped"});
    }
    rx.recv_timeout(Duration::from_secs(10))
        .unwrap_or_else(|_| json!({"error":"Desktop operation timed out"}))
}

pub fn client(value: Value) -> Result<Value> {
    let mut socket = UnixStream::connect(platform::runtime_dir().join("control.sock"))
        .context("Native daemon is not running; start with make native ARGS='ui'")?;
    socket.set_read_timeout(Some(Duration::from_secs(12)))?;
    serde_json::to_writer(&mut socket, &value)?;
    socket.write_all(b"\n")?;
    let mut line = String::new();
    BufReader::new(socket)
        .take(4 * 1024 * 1024)
        .read_line(&mut line)?;
    let value: Value = serde_json::from_str(&line)?;
    if let Some(error) = value["error"].as_str() {
        bail!("{error}");
    }
    Ok(value)
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).unwrap()
}

pub fn start(sender: Sender, port: u16) -> Result<Servers> {
    let runtime = platform::runtime_dir();
    fs::create_dir_all(&runtime)?;
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700))?;
    let lock = File::create(runtime.join("daemon.lock"))?;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        bail!("Native daemon is already running");
    }
    let path = runtime.join("control.sock");
    if path.exists() {
        fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    let server = Server::http(("127.0.0.1", port))
        .map_err(|e| anyhow::anyhow!("Cannot start local UI: {e}"))?;
    let address = server.server_addr().to_ip().unwrap();
    let url = format!("http://{address}");
    let mut bytes = [0_u8; 24];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    fs::write(runtime.join("url"), &url)?;
    let ipc = sender.clone();
    thread::spawn(move || {
        for mut socket in listener.incoming().flatten() {
            let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
            let mut line = String::new();
            if BufReader::new(&mut socket)
                .take(65537)
                .read_line(&mut line)
                .is_ok()
                && line.len() <= 65536
            {
                let reply = serde_json::from_str(&line)
                    .map(|v| ask(&ipc, v))
                    .unwrap_or_else(|e| json!({"error":e.to_string()}));
                let _ = serde_json::to_writer(&mut socket, &reply);
                let _ = socket.write_all(b"\n");
            }
        }
    });
    let origin = url.clone();
    // Four bounded workers keep streamed media from blocking control requests.
    let server = std::sync::Arc::new(server);
    for _ in 0..4 {
        let (server, sender, origin, token) = (
            server.clone(),
            sender.clone(),
            origin.clone(),
            token.clone(),
        );
        thread::spawn(move || {
            for mut req in server.incoming_requests() {
                let get_header = |name: &'static str| {
                    req.headers()
                        .iter()
                        .find(|h| h.field.equiv(name))
                        .map(|h| h.value.as_str())
                };
                let host = origin.strip_prefix("http://").unwrap();
                if get_header("Host") != Some(host)
                    || get_header("Origin").is_some_and(|o| o != origin)
                    || get_header("Sec-Fetch-Site") == Some("cross-site")
                {
                    let _ = req
                        .respond(Response::from_string("Forbidden origin").with_status_code(403));
                    continue;
                }
                let path = req.url().split('?').next().unwrap_or("/").to_string();
                let mut status = 200;
                let (body, mime) = if req.method() == &Method::Get && path == "/" {
                    (
                        include_str!("../ui/index.html").replace("__TOKEN__", &token),
                        "text/html; charset=utf-8",
                    )
                } else if req.method() == &Method::Get && path == "/ui.css" {
                    (include_str!("../ui/style.css").into(), "text/css")
                } else if req.method() == &Method::Get && path == "/ui.js" {
                    (include_str!("../ui/app.js").into(), "text/javascript")
                } else if path == "/api" && req.method() == &Method::Post {
                    if get_header("X-WallpaperDB-Token") != Some(token.as_str()) {
                        let _ =
                            req.respond(Response::from_string("Forbidden").with_status_code(403));
                        continue;
                    }
                    let mut bytes = Vec::new();
                    let _ = req.as_reader().take(65537).read_to_end(&mut bytes);
                    let result = if bytes.len() > 65536 {
                        json!({"error":"Request too large"})
                    } else {
                        serde_json::from_slice(&bytes)
                            .map(|v| ask(&sender, v))
                            .unwrap_or_else(|e| json!({"error":e.to_string()}))
                    };
                    if !result["error"].is_null() {
                        status = 400;
                    }
                    (result.to_string(), "application/json")
                } else if req.method() == &Method::Get && path.starts_with("/preview/") {
                    let id = path.trim_start_matches("/preview/");
                    let state = ask(&sender, json!({"op":"status"}));
                    let file = state["items"]
                        .as_array()
                        .and_then(|items| items.iter().find(|i| i["id"] == id))
                        .and_then(|item| item["preview"].as_str())
                        .map(PathBuf::from);
                    if let Some(file) = file.filter(|p| p.is_file()) {
                        let mime = match file.extension().and_then(|x| x.to_str()).unwrap_or("") {
                            "svg" => "image/svg+xml",
                            "png" => "image/png",
                            "webp" => "image/webp",
                            _ => "image/jpeg",
                        };
                        if let Ok(mut input) = File::open(file) {
                            // File-backed responses avoid buffering full-resolution images in memory.
                            let _ = input.seek(SeekFrom::Start(0));
                            let _ = req.respond(
                                Response::from_file(input)
                                    .with_header(header("Content-Type", mime))
                                    .with_header(header(
                                        "Content-Security-Policy",
                                        "default-src 'none'; sandbox",
                                    ))
                                    .with_header(header("X-Content-Type-Options", "nosniff")),
                            );
                            continue;
                        }
                    }
                    status = 404;
                    ("No preview".into(), "text/plain")
                } else {
                    status = 404;
                    ("Not found".into(), "text/plain")
                };
                let response=Response::from_string(body).with_status_code(StatusCode(status)).with_header(header("Content-Type",mime)).with_header(header("Cache-Control","no-store")).with_header(header("X-Content-Type-Options","nosniff")).with_header(header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"));
                let _ = req.respond(response);
            }
        });
    }
    Ok(Servers { url, _lock: lock })
}
