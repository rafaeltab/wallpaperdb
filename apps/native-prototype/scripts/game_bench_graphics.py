"""Stop Bench on observed kernel GPU faults, including the compositor's other GPU."""

import json
import re
import subprocess
import threading
from pathlib import Path

from game_bench_host import atomic_json


class GraphicsFault(RuntimeError):
    pass


def graphics_fault(message):
    lower = message.lower()
    if "amdgpu" in lower and any(term in lower for term in ("page fault", "ring gfx", "gpu reset")):
        if "page fault" in lower or "timeout" in lower or "gpu reset" in lower:
            return True
    return bool(re.search(r"nvrm:.*xid\s*\(|(?:i915|xe).*gpu (?:hang|reset)", lower))


def session_identity(env):
    return {
        "session": env.get("HYPRLAND_INSTANCE_SIGNATURE", ""),
        "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
    }


def block_path(env):
    return Path(env["XDG_RUNTIME_DIR"]) / "wallpaperdb-native-prototype" / "graphics-fault.json"


def check_session(env):
    path = block_path(env)
    if path.exists():
        value = json.loads(path.read_text())
        if all(value.get(k) == v for k, v in session_identity(env).items()):
            raise GraphicsFault(
                "Bench is paused for this graphics session after a kernel GPU fault. "
                + value["message"]
            )


class GraphicsWatch:
    def __init__(self, directory, env):
        self.env = env
        self.directory = directory
        self.failure = None
        check_session(env)
        probe = subprocess.run(
            ["journalctl", "-b", "-k", "-n", "1", "-o", "json", "--no-pager"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        entries = [json.loads(line) for line in probe.stdout.splitlines() if line.startswith("{")]
        if probe.returncode or not entries:
            raise RuntimeError("Kernel GPU fault monitoring is unavailable; cannot start Bench")
        cursor = entries[-1]["__CURSOR"]
        with (directory / "graphics-watch.log").open("w") as log:
            self.child = subprocess.Popen(
                [
                    "journalctl",
                    "-b",
                    "-k",
                    "--after-cursor",
                    cursor,
                    "-f",
                    "-o",
                    "json",
                    "--no-pager",
                ],
                stdout=subprocess.PIPE,
                stderr=log,
                text=True,
            )
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def observe(self, entry):
        message = entry.get("MESSAGE", "")
        if isinstance(message, str) and graphics_fault(message) and self.failure is None:
            value = session_identity(self.env) | {
                "message": message,
                "timestamp": entry.get("__REALTIME_TIMESTAMP"),
                "job": self.directory.name,
            }
            atomic_json(self.directory / "graphics-fault.json", value)
            atomic_json(block_path(self.env), value)
            self.failure = message

    def run(self):
        try:
            for line in self.child.stdout:
                if line.startswith("{"):
                    self.observe(json.loads(line))
        except Exception as error:
            self.failure = "GPU fault monitor failed: " + str(error)

    def check(self):
        if self.failure:
            raise GraphicsFault("Kernel GPU fault during Bench: " + self.failure)
        if self.child.poll() is not None:
            raise RuntimeError("Kernel GPU fault monitor exited unexpectedly")

    def close(self):
        if self.child.poll() is None:
            self.child.terminate()
        self.child.wait(timeout=3)
        self.thread.join(timeout=2)
        self.child.stdout.close()
