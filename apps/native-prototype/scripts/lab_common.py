"""Shared local experiment controls. No monitor power operations."""

from pathlib import Path
import contextlib, json, os, socket, subprocess, time

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
CONTROL = RUNTIME / "wallpaperdb-native-prototype/control.sock"
ENV = os.environ.copy()
_hypr_socket = next((RUNTIME / "hypr").glob("*/.socket.sock"), None)
if _hypr_socket:
    ENV["HYPRLAND_INSTANCE_SIGNATURE"] = _hypr_socket.parent.name
_wayland_socket = next(
    (p for p in RUNTIME.glob("wayland-*") if p.is_socket() and "swww" not in p.name), None
)
if _wayland_socket:
    ENV["WAYLAND_DISPLAY"] = _wayland_socket.name


def api(op, **kwargs):
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(15)
        s.connect(str(CONTROL))
        s.sendall(json.dumps({"op": op, **kwargs}).encode() + b"\n")
        value = json.loads(s.makefile("rb").readline())
    if value.get("error"):
        raise RuntimeError(value["error"])
    return value


def ensure():
    try:
        return api("status")
    except (OSError, RuntimeError):
        subprocess.run(
            [str(ROOT / "target/release/wallpaperdb-native"), "add", str(ROOT / "examples/prism")],
            env=ENV,
            check=True,
            stdout=subprocess.DEVNULL,
        )
        return api("status")


def hypr(*args):
    r = subprocess.run(
        ["hyprctl", *args], env=ENV, check=True, capture_output=True, text=True, timeout=10
    )
    return json.loads(r.stdout) if "-j" in args else r.stdout.strip()


def ready(output="DP-2", seconds=20):
    deadline = time.monotonic() + seconds
    last = {}
    while time.monotonic() < deadline:
        state = api("status")
        last = next((s["telemetry"] for s in state["surfaces"] if s["output"] == output), {})
        if last.get("error"):
            raise RuntimeError(last["error"])
        if (
            last.get("state") in (None, "ready")
            and last.get("frames", 0) > 35
            and (last.get("renderer") != "Chromium DMA-BUF" or last.get("received", 0) > 10)
        ):
            return last
        if last.get("renderer") in ["native image", "mpv"] and last.get("state") == "ready":
            return last
        time.sleep(0.2)
    raise RuntimeError(f"Renderer readiness timeout: {last}")


def assign(source="prism", experiment="gpu", outputs=None, **kwargs):
    return api(
        "set",
        source=str(ROOT / "examples" / source),
        experiment=experiment,
        outputs=outputs or ["DP-2"],
        fps=kwargs.pop("fps", 30),
        **kwargs,
    )


def restore(state):
    connected = {m["name"] for m in hypr("-j", "monitors")}
    current = api("status")
    owned = sorted({o for g in current["groups"] for o in g["outputs"]})
    if owned:
        api("clear", outputs=owned)
    for g in state["groups"]:
        outputs = [o for o in g["outputs"] if o in connected]
        if not outputs:
            continue
        api(
            "set",
            source=g["item"],
            outputs=outputs,
            span=g["span"],
            fps=g["fps"],
            audio=g["audio"],
            experiment=g.get("experiment", "baseline"),
            hdr=g.get("hdr", False),
            keep_playing=g.get("keep_playing", False),
            trace=g.get("trace", False),
        )
        if g.get("paused"):
            api("pause", outputs=outputs, paused=True)


@contextlib.contextmanager
def saved_assignments():
    before = ensure()
    try:
        yield before
    finally:
        restore(before)


def capture(path, output="DP-2", empty=False):
    """DP-5 may briefly change workspace; always restore before returning."""
    monitor = next(m for m in hypr("-j", "monitors") if m["name"] == output)
    original_focus = hypr("-j", "activewindow").get("address")
    previous = monitor["activeWorkspace"]["id"]
    temporary = f"wallpaperdb-capture-{os.getpid()}"
    try:
        if empty:
            hypr("dispatch", "focusmonitor", output)
            hypr("dispatch", "workspace", f"name:{temporary}")
            time.sleep(0.25)
        subprocess.run(["grim", "-o", output, str(path)], env=ENV, check=True, timeout=5)
    finally:
        if empty:
            hypr("dispatch", "workspace", str(previous))
            if original_focus:
                hypr("dispatch", "focuswindow", f"address:{original_focus}")
