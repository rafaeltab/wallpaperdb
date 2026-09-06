"""Exercise the real alternative renderers on DP-2 and temporary virtual outputs."""

import argparse, hashlib, json, math, os, select, signal, socket, struct, subprocess, time, wave
from pathlib import Path
from stress import termination_cleanup
from lab_common import (
    ROOT,
    RUNTIME,
    ENV,
    api,
    assign as lab_assign,
    ready,
    hypr,
    capture,
    saved_assignments,
)

OUT = ROOT / "verification" / f"lab-{int(time.time())}"
OUT.mkdir(parents=True)
checks = []
parser = argparse.ArgumentParser()
parser.add_argument("--lifecycle-only", action="store_true")
parser.add_argument("--debug-stacks", action="store_true")
parser.add_argument("--engines", default="gpu,chromium,gpu-paced")
parser.add_argument("--fps", type=int, default=30, choices=range(1, 361))
parser.add_argument("--stress-scenes", action="store_true")
args = parser.parse_args()
engines = args.engines.split(",")
if not set(engines) <= {"gpu", "gpu-paced", "gpu-independent", "gpu-independent-drop", "chromium"}:
    parser.error("Only visible, working experimental renderers can be verified")


def assign(*positional, **kwargs):
    kwargs.setdefault("fps", args.fps)
    return lab_assign(*positional, **kwargs)


def stats(output="DP-2"):
    return next(s["telemetry"] for s in api("status")["surfaces"] if s["output"] == output)


def wait(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.15)
    state = api("status")
    evidence = {
        "status": state,
        "monitors": hypr("-j", "monitors"),
        "workspaces": hypr("-j", "workspaces"),
        "library_windows": [w for w in hypr("-j", "clients") if w["class"] == "wallpaperdb-native"],
    }
    (OUT / "failure-state.json").write_text(json.dumps(evidence, indent=2))
    if args.debug_stacks:
        pid = next(
            (s["telemetry"].get("pid") for s in state["surfaces"] if s["output"] == "DP-2"), None
        )
        if pid:
            trace = subprocess.run(
                [
                    "gdb",
                    "-batch",
                    "-nx",
                    "-ex",
                    "set debuginfod enabled off",
                    "-ex",
                    "thread apply all bt",
                    "-p",
                    str(pid),
                ],
                capture_output=True,
                text=True,
                timeout=12,
            )
            (OUT / "failure-stack.txt").write_text(trace.stdout + trace.stderr)
    print(
        "FAILURE STATE",
        json.dumps(
            {
                "warning": state.get("warning"),
                "surfaces": [
                    {
                        "output": s["output"],
                        "paused": s["telemetry"].get("paused"),
                        "state": s["telemetry"].get("state"),
                        "error": s["telemetry"].get("error"),
                    }
                    for s in state["surfaces"]
                ],
                "library_windows": [
                    {k: w.get(k) for k in ["monitor", "workspace", "fullscreen"]}
                    for w in evidence["library_windows"]
                ],
            }
        ),
        flush=True,
    )
    raise AssertionError(f"Timed out waiting for live behavior; see {OUT / 'failure-state.json'}")


def shot(name):
    path = OUT / f"{name}.png"
    capture(path)
    # Ignore desktop clock/CPU widgets and cursor; compare the wallpaper interior.
    data = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-vf",
            "crop=iw-200:ih-180:100:100,scale=96:54",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ]
    )
    return hashlib.sha256(data).hexdigest()


def passed(name):
    checks.append(name)
    (OUT / "report.json").write_text(json.dumps({"checks": checks}, indent=2))
    print("PASS", name, flush=True)


def producer_disconnect():
    path = RUNTIME / f"wallpaperdb-disconnect-{os.getpid()}.sock"
    config = OUT / "disconnect.json"
    config.write_text(
        json.dumps(
            {
                "experiment": "chromium",
                "kind": "live",
                "width": 64,
                "height": 64,
                "fps": 30,
                "socket": str(path),
                "outputs": [
                    {
                        "name": "DP-2",
                        "width": 1920,
                        "height": 1080,
                        "pixel_width": 1920,
                        "pixel_height": 1080,
                        "crop_x": 0,
                        "crop_y": 0,
                    }
                ],
            }
        )
    )
    log_path = OUT / "disconnect.log"
    with log_path.open("w") as log:
        child = subprocess.Popen(
            [str(ROOT / "lab/build/presenter"), str(config)],
            env=ENV,
            stdin=subprocess.PIPE,
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 8
            while not path.exists() and child.poll() is None and time.monotonic() < deadline:
                time.sleep(0.05)
            with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as peer:
                peer.connect(str(path))
                time.sleep(0.1)
            assert child.wait(timeout=3) == 1
            assert "Chromium producer disconnected" in log_path.read_text()
            passed(
                "A disconnected producer exits explicitly instead of spinning on a closed socket"
            )
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)
            child.stdin.close()
            path.unlink(missing_ok=True)


def host_disconnect():
    """A stopped host must not leave a native helper or frozen layer behind."""
    config = OUT / "host-disconnect.json"
    config.write_text(
        json.dumps(
            {
                "experiment": "gpu-paced",
                "width": 64,
                "height": 64,
                "fps": 60,
                "script": str(ROOT / "examples/prism/scene.lua"),
                "outputs": [{"name": "DP-2", "width": 1920, "height": 1080}],
            }
        )
    )
    helper = str(ROOT / "lab/build/presenter")
    log_path = OUT / "host-eof.log"
    with log_path.open("w") as log:
        child = subprocess.Popen(
            [helper, str(config)], env=ENV, stdin=subprocess.PIPE, stdout=log, stderr=log
        )
        try:
            wait(lambda: '"frames":' in log_path.read_text(), 10)
            assert child.poll() is None
            child.stdin.close()
            assert child.wait(timeout=3) == 0
            passed("gpu-paced: closing the host input pipe exits the helper promptly")
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)
            child.stdin.close()

    log_path = OUT / "host-death.log"
    program = """
import subprocess, sys
with open(sys.argv[3], 'w') as log:
    child = subprocess.Popen(sys.argv[1:3], stdin=int(sys.argv[4]), stdout=log, stderr=log)
    print(child.pid, flush=True)
    sys.stdin.buffer.read(1)
"""
    input_reader, input_writer = os.pipe()
    parent = subprocess.Popen(
        ["python3", "-c", program, helper, str(config), str(log_path), str(input_reader)],
        env=ENV,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        pass_fds=(input_reader,),
    )
    os.close(input_reader)
    child_fd = None
    try:
        assert select.select([parent.stdout], [], [], 5)[0], "Test host did not start"
        child_pid = int(parent.stdout.readline())
        child_fd = os.pidfd_open(child_pid)
        wait(lambda: log_path.exists() and '"frames":' in log_path.read_text(), 10)
        poller = select.poll()
        poller.register(child_fd, select.POLLIN)
        assert not poller.poll(0), "Helper exited before its parent"
        # Keep a writer alive and stop the helper: EOF or a cooperative signal
        # handler cannot make this pass in place of the parent-death SIGKILL.
        signal.pidfd_send_signal(child_fd, signal.SIGSTOP)
        wait(
            lambda: (
                Path(f"/proc/{child_pid}/stat").read_text().rsplit(")", 1)[1].split()[0] == "T"
            )
        )
        parent.kill()
        parent.wait(timeout=3)
        assert poller.poll(3000), "Helper survived abrupt creator death"
        passed("gpu-paced: abrupt creator death cannot orphan the presenter")
    finally:
        os.close(input_writer)
        if parent.poll() is None:
            parent.kill()
        parent.wait(timeout=3)
        parent.stdin.close()
        parent.stdout.close()
        if child_fd is not None:
            try:
                signal.pidfd_send_signal(child_fd, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.close(child_fd)


def paced_coverage_checks(output):
    """Exercise real fullscreen coverage independently from keep-playing policy."""
    if "gpu-paced" not in engines:
        return
    assign("prism", "gpu-paced", ["DP-2", output], span=True, keep_playing=True)
    ready()
    api("ui", fullscreen=True)

    def view(name):
        return next(v for v in stats()["outputs"] if v["output"] == name)

    wait(lambda: view("DP-2").get("covered") and not view("DP-2").get("callback_eligible"))
    assert not view("DP-2")["hidden"]
    before = view(output)["presented"]
    wait(lambda: view(output)["presented"] > before + 10)
    passed("gpu-paced: a fullscreen-covered keep-playing member cannot stall its visible span")

    app_id = f"org.wallpaperdb.CoverageProbe.p{os.getpid()}"
    coverage_rule = f"wallpaperdb-coverage-{os.getpid()}"
    monitor = next(m for m in hypr("-j", "monitors") if m["name"] == output)
    child = None
    try:
        for key, value in [
            ("match:class", "^" + app_id.replace(".", "\\.") + "$"),
            ("monitor", output),
            ("workspace", f"{monitor['activeWorkspace']['id']} silent"),
            ("no_initial_focus", "on"),
            ("suppress_event", "activate activatefocus"),
        ]:
            hypr("keyword", f"windowrule[{coverage_rule}]:{key}", value)
        program = """
import gi, signal, sys
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
GLib.set_prgname(sys.argv[1])
app = Gtk.Application(application_id=sys.argv[1])
def activate(application):
    window = Gtk.ApplicationWindow(application=application)
    window.set_title('Temporary wallpaper coverage check')
    window.show_all()
app.connect('activate', activate)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (app.quit(), False)[1])
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, lambda: (app.get_windows()[0].fullscreen(), True)[1])
app.run([])
"""
        with (OUT / "coverage-window.log").open("w") as log:
            child = subprocess.Popen(
                ["python3", "-c", program, app_id],
                env=ENV | {"GDK_BACKEND": "wayland"},
                stdout=log,
                stderr=log,
            )

        def probe_window():
            return next((w for w in hypr("-j", "clients") if w["pid"] == child.pid), None)

        wait(lambda: probe_window() is not None)
        window = probe_window()
        hypr(
            "dispatch",
            "movetoworkspacesilent",
            f"{monitor['activeWorkspace']['id']},address:{window['address']}",
        )
        wait(lambda: probe_window()["monitor"] == monitor["id"])
        child.send_signal(signal.SIGUSR1)
        api("ui", fullscreen=True)
        wait(lambda: stats().get("pacing_mode") == "covered-timer")
        assert all(v["covered"] and not v["callback_eligible"] for v in stats()["outputs"])
        before = stats()["frames"]
        wait(lambda: stats()["frames"] > before + 10)
        api("pause", outputs=["DP-2", output], paused=True)
        wait(lambda: stats()["paused"])
        before = stats()["frames"]
        time.sleep(1.4)
        assert stats()["frames"] == before
        api("pause", outputs=["DP-2", output], paused=False)
        wait(lambda: not stats()["paused"] and stats()["frames"] > before)
        passed("gpu-paced: fully covered keep-playing uses its timer and still honors manual pause")
    finally:
        if child:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=3)
        hypr("keyword", f"windowrule[{coverage_rule}]:enable", "false")
        api("ui", fullscreen=False)
    wait(lambda: all(v.get("callback_eligible") for v in stats()["outputs"]))
    before = {v["output"]: v["callbacks_completed"] for v in stats()["outputs"]}
    wait(lambda: all(v["callbacks_completed"] > before[v["output"]] for v in stats()["outputs"]))
    passed("gpu-paced: revealing both span members restores fresh compositor callbacks")


virtual = []
rule = f"wallpaperdb-lab-verify-{os.getpid()}"
with termination_cleanup(), saved_assignments():
    try:
        producer_disconnect()
        host_disconnect()
        for window in hypr("-j", "clients"):
            if window["class"] == "wallpaperdb-native":
                hypr("dispatch", "closewindow", "address:" + window["address"])
        for engine in [] if args.lifecycle_only else engines:
            for asset in [
                "rose-clock/background.png",
                "Drifting dusk.mp4",
                "prism",
                "rose-clock",
                "tide",
            ] + (
                ["stress-studio", "stress-studio/shader-heavy", "stress-studio/media-heavy"]
                if args.stress_scenes
                else []
            ):
                assign(asset, engine, keep_playing=True)
                info = ready()
                assert info["state"] == "ready" and info["probe_max_scrgb"] > 0, info
                assert (
                    info["frames_file"] is None
                ), "Ordinary assignments must not write frame traces"
                first = shot(f'{engine}-{asset.replace("/","-")}')
                time.sleep(0.8)
                second = shot(f'{engine}-{asset.replace("/","-")}-next')
                assert (first == second) if asset.endswith(".png") else (first != second)
                passed(f"{engine}: {asset}, actual visible content and expected motion")
            api("signal", name="key", value="Space", outputs=["DP-2"])
            wait(lambda: stats().get("signals", 0) > 0)
            api("pause", outputs=["DP-2"], paused=True)
            time.sleep(1.3)
            before = stats()["frames"]
            time.sleep(1.3)
            assert stats()["frames"] == before
            api("pause", outputs=["DP-2"], paused=False)
            wait(lambda: stats()["frames"] > before + 10)
            passed(f"{engine}: semantic keyboard signal, pause, resume")

        assign("tide", "gpu", audio=True, keep_playing=True)
        ready()
        tone = OUT / "tone.wav"
        with wave.open(str(tone), "wb") as f:
            f.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
            f.writeframes(
                b"".join(
                    struct.pack("<h", int(800 * math.sin(i * 2 * math.pi * 440 / 48000)))
                    for i in range(96000)
                )
            )
        audio = subprocess.Popen(["paplay", str(tone)], env=ENV)
        try:
            wait(lambda: stats().get("audio_rms", 0) > 0.001)
        finally:
            audio.wait(timeout=5)
        # Reports arrive once a second; the user can keep moving their pointer.
        monitor = next(m for m in api("status")["monitors"] if m["name"] == "DP-2")
        positions = []
        first_frame = stats()["frames"]

        def pointer_received():
            cursor = hypr("-j", "cursorpos")
            positions.append(
                (
                    (cursor["x"] - monitor["x"]) / (monitor["width"] / monitor["scale"]),
                    (cursor["y"] - monitor["y"]) / (monitor["height"] / monitor["scale"]),
                )
            )
            info = stats()
            return info["frames"] > first_frame and any(
                abs(info["pointer_x"] - x) < 0.03 and abs(info["pointer_y"] - y) < 0.03
                for x, y in positions[-12:]
            )

        wait(pointer_received, 5)
        passed("Native composition receives playback audio and actual desktop pointer")

        for name, x in [("WDB-LAB-A", 2240), ("WDB-LAB-B", 4160)]:
            assert name not in [m["name"] for m in hypr("-j", "monitors")]
            hypr("output", "create", "headless", name)
            virtual.append(name)
            hypr("keyword", "monitor", f"{name},1920x1080@60,{x}x-1080,1")
        wait(lambda: len([m for m in api("status")["monitors"] if m["name"] in virtual]) == 2)
        for engine in engines:
            assign("tide", engine, ["DP-2", virtual[0]], span=True, keep_playing=True)
            ready()
            ready(virtual[0])
            assign("prism", "gpu", [virtual[1]], keep_playing=True)
            ready(virtual[1])
            left, right, independent = stats(), stats(virtual[0]), stats(virtual[1])
            assert left["pid"] == right["pid"] != independent["pid"]
            assert len(left["outputs"]) == 2
            state = api("status")
            surface = next(s for s in state["surfaces"] if s["output"] == virtual[0])
            assert surface["viewport"]["x"] == 1920 and surface["canvas"]["width"] == 3840
            passed(f"{engine}: one shared producer/decoder across a span plus an independent group")
        monitor = next(m for m in hypr("-j", "monitors") if m["name"] == "DP-2")
        for key, value in [
            ("match:class", "^wallpaperdb-native$"),
            ("monitor", "DP-2"),
            ("workspace", f"{monitor['activeWorkspace']['id']} silent"),
            ("no_initial_focus", "on"),
            ("suppress_event", "activate activatefocus"),
            ("float", "on"),
            ("size", "1240 840"),
            ("center", "on"),
        ]:
            hypr("keyword", f"windowrule[{rule}]:{key}", value)
        existing = next(
            (w for w in hypr("-j", "clients") if w["class"] == "wallpaperdb-native"), None
        )
        if existing:
            hypr("dispatch", "closewindow", "address:" + existing["address"])
        api("ui")
        time.sleep(2)
        paced_coverage_checks(virtual[0])
        for engine in engines:
            assign("prism", engine, ["DP-2", virtual[0]], span=False)
            ready()
            ready(virtual[0])
            left, right = stats(), stats(virtual[0])
            assert left["pid"] != right["pid"] and left["log"] != right["log"]
            api("ui", fullscreen=True)
            wait(lambda: stats().get("paused") and not stats(virtual[0]).get("paused"))
            before = stats()["frames"]
            other = stats(virtual[0])["frames"]
            time.sleep(1.3)
            assert stats()["frames"] == before and stats(virtual[0])["frames"] > other
            api("ui", fullscreen=False)
            wait(lambda: not stats().get("paused"))
            passed(f"{engine}: independent players have unique artifacts and suspend per output")

            api("ui", fullscreen=True)
            time.sleep(2.5)
            assign("rose-clock/background.png", engine, ["DP-2", virtual[0]], span=True)
            ready()
            time.sleep(2)

            def presents():
                return next(o["presented"] for o in stats()["outputs"] if o["output"] == "DP-2")

            before = presents()
            retained_frames = stats()["frames"]
            time.sleep(0.7)
            assert stats()["frames"] == retained_frames, "Static image did not become idle"
            api("ui", fullscreen=False)
            wait(lambda: presents() > before)
            assert stats()["probe_max_scrgb"] > 0
            passed(f"{engine}: a retained static span repaints its initially hidden member")

            assign("prism", engine, ["DP-2", virtual[0]], span=True)
            ready()
            ready(virtual[0])
            hypr("output", "remove", virtual[0])
            wait(lambda: virtual[0] not in [m["name"] for m in api("status")["monitors"]])
            ready()
            api("ui", fullscreen=True)
            wait(lambda: stats().get("paused"))
            api("ui", fullscreen=False)
            wait(lambda: not stats().get("paused"))
            hypr("output", "create", "headless", virtual[0])
            hypr("keyword", "monitor", f"{virtual[0]},1920x1080@60,2240x-1080,1")
            wait(lambda: virtual[0] in [m["name"] for m in api("status")["monitors"]])
            ready(virtual[0])
            passed(f"{engine}: a span suspends after a member disconnects and reconnects")
        api("clear", outputs=virtual)
        for name in virtual:
            hypr("output", "remove", name)
        virtual = []

        assign("prism", "gpu")
        ready()
        capture(OUT / "library-dp2.png")
        api("ui", fullscreen=True)
        wait(lambda: stats().get("paused"))
        api("ui", fullscreen=False)
        wait(lambda: not stats().get("paused"))
        passed("Native library opens on DP-2; fullscreen suspension and resumption work")
    finally:
        cleanup_errors = []
        try:
            if any(w["class"] == "wallpaperdb-native" for w in hypr("-j", "clients")):
                api("ui", fullscreen=False)
        except Exception as error:
            cleanup_errors.append(str(error))
        if virtual:
            try:
                api("clear", outputs=virtual)
            except Exception as error:
                cleanup_errors.append(str(error))
            for name in virtual:
                try:
                    if name in [m["name"] for m in hypr("-j", "monitors")]:
                        hypr("output", "remove", name)
                except Exception as error:
                    cleanup_errors.append(str(error))
        try:
            hypr("keyword", f"windowrule[{rule}]:enable", "false")
        except Exception as error:
            cleanup_errors.append(str(error))
        if cleanup_errors:
            raise RuntimeError(f"Desktop verification cleanup failed: {cleanup_errors}")
print(OUT / "report.json", flush=True)
