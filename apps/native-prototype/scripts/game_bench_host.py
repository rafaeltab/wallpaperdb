"""Temporary desktop/process leases for the disposable real-game benchmark."""

import json
import os
from pathlib import Path
import signal
import socket
import stat
import time


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False))
    temporary.replace(path)


def cleanup_all(actions):
    errors = []
    for label, action in actions:
        try:
            action()
        except Exception as error:
            errors.append(f"{label}: {error}")
    return errors


def validate_request(request, connected):
    if request.get("mode", "comparison") not in ("comparison", "manual"):
        raise ValueError("Unsupported benchmark mode")
    for key, allowed in {
        "experiment": {
            "baseline",
            "gpu",
            "gpu-paced",
            "gpu-independent",
            "gpu-independent-drop",
            "chromium",
        },
        "preset": {"current", "low", "high"},
        "resolution": {"display", "current"},
        "policy": {"active", "normal"},
        "seconds": {20, 40},
        "repeats": {1, 3},
        "cap": {0, 120, 240, 360},
    }.items():
        if isinstance(request.get(key), bool) or request.get(key) not in allowed:
            raise ValueError(f"Unsupported benchmark {key}: {request.get(key)}")
    fps = request.get("fps")
    if type(fps) is not int or not 1 <= fps <= 360:
        raise ValueError("Wallpaper fps must be an integer from 1 to 360")
    outputs = request.get("outputs")
    if not isinstance(outputs, list) or not outputs or any(type(o) is not str for o in outputs):
        raise ValueError("Select at least one wallpaper display")
    if len(set(outputs)) != len(outputs) or not set(outputs) <= connected:
        raise ValueError("Wallpaper displays must be distinct, connected and powered on")
    if request.get("game_output") not in connected:
        raise ValueError("Game display is not connected and powered on")
    if not isinstance(request.get("source"), str) or not request["source"]:
        raise ValueError("Select an installed wallpaper")
    demo = request.get("demo", "")
    if not isinstance(demo, str) or any(c in demo for c in '\r\n";'):
        raise ValueError("Demo path contains unsupported console characters")
    for key in ["span", "audio", "hdr", "cpu_temperature_check"]:
        if key in request and type(request[key]) is not bool:
            raise ValueError(f"{key} must be a boolean")


class FileSnapshot:
    """Durable backup before launching a game; absent files are also meaningful."""

    def __init__(self, directory, trees, files):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.trees = [Path(p) for p in trees]
        paths = set(Path(p) for p in files)
        for tree in self.trees:
            paths.update(p for p in tree.rglob("*") if p.is_file())
        self.saved = {}
        for index, path in enumerate(sorted(paths)):
            if path.is_symlink():
                raise RuntimeError(f"Refusing to replace a symlinked game setting: {path.name}")
            if path.exists():
                backup = directory / str(index)
                backup.write_bytes(path.read_bytes())
                self.saved[str(path)] = {
                    "backup": str(backup),
                    "mode": stat.S_IMODE(path.stat().st_mode),
                }
            else:
                self.saved[str(path)] = None
        atomic_json(
            directory / "manifest.json",
            {"trees": [str(p) for p in self.trees], "files": self.saved},
        )

    def restore(self):
        actions = []
        for tree in self.trees:
            for path in tree.rglob("*"):
                if path.is_file() and str(path) not in self.saved:
                    actions.append((path.name, path.unlink))
        for name, entry in self.saved.items():
            path = Path(name)

            def restore_one(path=path, entry=entry):
                if path.is_symlink():
                    raise RuntimeError("Path became a symlink during the benchmark")
                if entry is None:
                    path.unlink(missing_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(Path(entry["backup"]).read_bytes())
                    path.chmod(entry["mode"])

            actions.append((path.name, restore_one))
        errors = cleanup_all(actions)
        if errors:
            raise RuntimeError("; ".join(errors))


def control(path, token, op, **kwargs):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(20)
        client.connect(str(path))
        client.sendall(json.dumps({"op": op, "bench_token": token, **kwargs}).encode() + b"\n")
        response = json.loads(client.makefile("rb").readline())
    if response.get("error"):
        raise RuntimeError(response["error"])
    return response


class FrozenBackgrounds:
    """Freeze only discovered mpvpaper processes; retain textures in both conditions."""

    def __init__(self, directory):
        self.handles = []
        self.evidence = []
        self.directory = directory

    def freeze(self):
        for proc in Path("/proc").glob("[0-9]*"):
            try:
                if (proc / "comm").read_text().strip() != "mpvpaper":
                    continue
                fd = os.pidfd_open(int(proc.name))
                try:
                    # Recheck after opening the identity handle. Exit/reuse cannot target another process.
                    if (proc / "comm").read_text().strip() != "mpvpaper":
                        os.close(fd)
                        continue
                    fields = (proc / "stat").read_text().rsplit(")", 1)[1].split()
                    paused = fields[0] in ("T", "t")
                    evidence = {
                        "pid": int(proc.name),
                        "start_ticks": fields[19],
                        "argv": (proc / "cmdline").read_bytes().decode().split("\0")[:-1],
                        "already_stopped": paused,
                    }
                    self.evidence.append(evidence)
                    atomic_json(self.directory / "external-backgrounds.json", self.evidence)
                    if paused:
                        os.close(fd)
                    else:
                        self.handles.append(fd)
                        signal.pidfd_send_signal(fd, signal.SIGSTOP)
                except Exception:
                    if fd not in self.handles:
                        os.close(fd)
                    raise
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
        return self.evidence

    def restore(self):
        errors = []
        for fd in self.handles:
            try:
                signal.pidfd_send_signal(fd, signal.SIGCONT)
            except ProcessLookupError:
                pass
            except OSError as error:
                errors.append(str(error))
            finally:
                os.close(fd)
        self.handles.clear()
        if errors:
            raise RuntimeError("; ".join(errors))


class DesktopLease:
    def __init__(self, output, marker, directory):
        from lab_common import hypr

        self.hypr = hypr
        self.output = output
        self.monitors = hypr("-j", "monitors")
        self.monitor = next(m for m in self.monitors if m["name"] == output)
        self.focus = hypr("-j", "activewindow").get("address")
        self.cursor = hypr("-j", "cursorpos")
        self.follow_mouse = hypr("-j", "getoption", "input:follow_mouse")["int"]
        self.workspace = self.monitor["activeWorkspace"]["id"]
        self.temporary = f"wallpaperdb-{marker}"
        atomic_json(
            directory / "desktop-before.json",
            {
                "monitors": self.monitors,
                "focus": self.focus,
                "cursor": self.cursor,
                "follow_mouse": self.follow_mouse,
                "output": output,
                "workspace": self.workspace,
                "temporary": self.temporary,
            },
        )
        self.entered = False

    def enter(self):
        self.entered = True
        self.hypr("keyword", "input:follow_mouse", "0")
        self.hypr("dispatch", "focusmonitor", self.output)
        self.hypr("dispatch", "workspace", f"name:{self.temporary}")

    def focus_game(self, client):
        self.hypr("dispatch", "setprop", f"address:{client['address']} sync_fullscreen 0")
        self.hypr(
            "dispatch",
            "movetoworkspacesilent",
            f"name:{self.temporary},address:{client['address']}",
        )
        self.hypr("dispatch", "focuswindow", f"address:{client['address']}")
        self.hypr(
            "dispatch",
            "movecursor",
            f"{int(self.monitor['x'] + self.monitor['width'] / self.monitor.get('scale',1) / 2)} "
            f"{int(self.monitor['y'] + self.monitor['height'] / self.monitor.get('scale',1) / 2)}",
        )
        self.hypr("dispatch", "fullscreenstate", "2 0")

    def restore(self):
        if not self.entered:
            return

        def restore_focus_policy():
            if self.hypr("-j", "getoption", "input:follow_mouse")["int"] == 0:
                self.hypr("keyword", "input:follow_mouse", str(self.follow_mouse))

        errors = cleanup_all(
            [
                ("mouse focus policy", restore_focus_policy),
                ("output focus", lambda: self.hypr("dispatch", "focusmonitor", self.output)),
                ("workspace", lambda: self.hypr("dispatch", "workspace", str(self.workspace))),
                (
                    "cursor",
                    lambda: self.hypr(
                        "dispatch", "movecursor", f"{self.cursor['x']} {self.cursor['y']}"
                    ),
                ),
                (
                    "window focus",
                    lambda: (
                        self.hypr("dispatch", "focuswindow", f"address:{self.focus}")
                        if self.focus
                        else None
                    ),
                ),
            ]
        )
        if errors:
            raise RuntimeError("; ".join(errors))


def send_game_command(address, line):
    """Deliver bounded console input to the owned game, never the focused editor."""
    from lab_common import hypr

    # Execute generated cfg files for complex commands. Shifted underscore keys
    # were not delivered reliably by this Hyprland/Proton combination.
    if len(line) > 512 or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789; .-" for c in line):
        raise ValueError("Unsupported console command characters")
    hypr("dispatch", "sendshortcut", f",grave,address:{address}")
    time.sleep(0.25)
    keys = {" ": "space", ";": "semicolon", ".": "period", "-": "minus"}
    hypr(
        "--batch",
        "; ".join(f"dispatch sendshortcut ,{keys.get(c,c)},address:{address}" for c in line),
    )
    hypr("dispatch", "sendshortcut", f",Return,address:{address}")
