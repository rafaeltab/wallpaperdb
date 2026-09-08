"""CS2 adapter and bounded job runner. Deliberately disposable; raw evidence survives."""

import csv
import bisect
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import statistics
import subprocess
import time
import traceback

from game_bench_data import (
    parse_source2,
    segment,
    summarize,
    envelope,
    completed_comparison,
    Source2Stream,
)
from game_bench_live import WakeLease
from game_bench_graphics import GraphicsWatch, GraphicsFault, check_session
from game_bench_host import (
    atomic_json,
    cleanup_all,
    validate_request,
    FileSnapshot,
    FrozenBackgrounds,
    DesktopLease,
    control,
    send_game_command,
)


class Cancelled(RuntimeError):
    pass


class Finished(RuntimeError):
    pass


class Job:
    def __init__(self, path):
        self.request = json.loads(path.read_text())
        self.directory = path.parent
        self.marker = self.request["id"]
        self.parent = os.getppid()
        self.manual = self.request.get("mode") == "manual"
        self.deadline = None if self.manual else time.monotonic() + 900
        self.allow_finish = False
        self.stopped = False
        self.runs = []
        self.result = None
        self.live_sequence = 0
        self.wake = None
        self.graphics = None
        self.cancelled = False
        self.completed = 0
        self.total = 2 if self.manual else 1 + 2 * self.request["repeats"]
        self.guard = None
        self.child = None
        self.client = None
        self.status("starting", "Checking CS2 and the desktop")
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, self.cancel)

    def cancel(self, *_):
        self.cancelled = True

    def status(self, state, phase, **extra):
        self.latest_status = {"state": state, "phase": phase, **extra}
        atomic_json(
            self.directory / "status.json",
            {
                "id": self.marker,
                "state": state,
                "phase": phase,
                "completed": self.completed,
                "total": self.total,
                "directory": str(self.directory),
                **extra,
            },
        )

    def check(self):
        if self.cancelled or (self.directory / "cancel").exists():
            raise Cancelled("Cancelled by you")
        if os.getppid() != self.parent:
            raise Cancelled("The wallpaper host exited")
        if self.deadline and time.monotonic() >= self.deadline:
            raise RuntimeError("The 15-minute benchmark deadline expired")
        if self.wake:
            self.wake.check()
        if self.guard:
            self.guard.snapshot()
        if self.graphics:
            self.graphics.check()
        if not self.allow_finish and self.finish_requested():
            raise Finished("Stopped and saved by you")

    def finish_requested(self):
        return (self.directory / "finish").exists()

    def next_requested(self):
        path = self.directory / "next-phase"
        if path.exists():
            phase = path.read_text().strip()
            path.unlink()
            return phase
        return None

    def publish(self, current=None):
        if self.result is None:
            return
        self.live_sequence += 1
        runs = self.runs + ([current] if current else [])
        atomic_json(
            self.directory / "live.json",
            {
                **self.result,
                "runs": runs,
                "comparison": completed_comparison(self.runs),
                "sequence": self.live_sequence,
                "sampled_at": time.time(),
                "live": True,
                "status": self.latest_status,
            },
        )

    def wait(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.check()
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))

    def api(self, op, **kwargs):
        return control(self.request["control"], self.request["bench_token"], op, **kwargs)

    def stop_game(self):
        from game_bench import stop_owned_game, game_processes

        # The Windows game may outlive the Proton wrapper. Its environment marker,
        # executable name and pidfd identify our actual child, not an unrelated game.
        stop_owned_game(self.marker)
        if self.child and self.child.poll() is None:
            try:
                os.killpg(self.child.pid, signal.SIGTERM)
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=3)
        self.child = None
        self.client = None
        if game_processes(self.marker):
            raise RuntimeError("Owned CS2 process did not exit; settings backup retained")

    def launch(self, info, folder, commands, cap=None):
        from lab_common import ENV

        game = Path(info["game"])
        # These files are backed up by the job. A previous completion marker must
        # never terminate the next run before CS2 has opened its new trace.
        (game / "game/csgo/console.log").write_text("")
        (game / "game/csgo/Source2BenchV2.csv").unlink(missing_ok=True)
        env = dict(
            ENV,
            SteamAppId="730",
            SteamGameId="730",
            STEAM_COMPAT_APP_ID="730",
            STEAM_COMPAT_CLIENT_INSTALL_PATH=info["steam"],
            STEAM_COMPAT_DATA_PATH=info["compat_data"],
            STEAM_COMPAT_INSTALL_PATH=info["game"],
            WALLPAPERDB_BENCH_JOB=self.marker,
            MANGOHUD="0",
        )
        env.pop("GDK_BACKEND", None)
        env.pop("MANGOHUD_CONFIG", None)
        env.pop("MANGOHUD_CONFIGFILE", None)
        # Individual frame collection is owned by Source 2, with no overlay injection.
        if "VK_INSTANCE_LAYERS" in env:
            env["VK_INSTANCE_LAYERS"] = ":".join(
                layer
                for layer in env["VK_INSTANCE_LAYERS"].split(":")
                if "MANGOHUD" not in layer.upper()
            )
        if self.manual:
            env["MANGOHUD"] = "1"
            env.pop("DISABLE_MANGOHUD", None)
            env["MANGOHUD_CONFIGFILE"] = str(self.directory / "mangohud.conf")
        command = [
            info["binary"],
            "-steam",
            "-insecure",
            "-novid",
            "-condebug",
            "-vulkan",
            "-windowed",
            "-w",
            str(self.resolution[0]),
            "-h",
            str(self.resolution[1]),
            "+fps_max",
            str(self.request["cap"] if cap is None else cap),
            "+fps_max_ui",
            "120",
            "+engine_no_focus_sleep",
            "0",
            *([] if self.manual else ["+volume", "0"]),
            "+con_enable",
            "1",
            "+demo_ui_mode",
            "0",
            *commands,
        ]
        if info["platform"] == "proton":
            command = [info["proton"], "waitforexitandrun", *command]
        else:
            env["LD_LIBRARY_PATH"] = (
                str(game / "game/bin/linuxsteamrt64") + ":" + env.get("LD_LIBRARY_PATH", "")
            )
        atomic_json(folder / "launch.json", {"command": command, "monotonic": time.monotonic()})
        with (folder / "game.log").open("w") as log:
            self.child = subprocess.Popen(
                command,
                cwd=game / "game",
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.guard.child = self.child
        self.client = None

    def find_game(self):
        from game_bench import game_processes
        from lab_common import hypr

        owned = game_processes(self.marker)
        clients = [client for client in hypr("-j", "clients") if client.get("pid") in owned]
        if len(clients) > 1:
            raise RuntimeError("The benchmark opened multiple game windows")
        if clients and self.client is None:
            self.client = clients[0]
            self.desktop.focus_game(self.client)
        return owned

    def prepare_demo(self, info):
        custom = self.request.get("demo")
        cache = self.directory.parent / "cs2-scenes" / info["build_id"]
        if custom:
            demo = Path(custom).expanduser().resolve()
            if demo.suffix.lower() != ".dem" or not demo.is_file():
                raise ValueError("Select an existing .dem file compatible with this CS2 build")
            snapshot = self.directory / "scene.dem"
            snapshot.write_bytes(demo.read_bytes())
            return snapshot
        demo = cache / "dust2.dem"
        manifest = cache / "scene.json"
        if demo.is_file() and manifest.is_file():
            metadata = json.loads(manifest.read_text())
            if (
                metadata.get("validated")
                and metadata.get("sha256") == hashlib.sha256(demo.read_bytes()).hexdigest()
            ):
                return demo
        self.status(
            "running",
            "Recording a local Dust II scene for this CS2 build",
            message="First run only: creating a replay with local bots. About two minutes.",
        )
        folder = self.directory / "recording"
        folder.mkdir()
        name = f"wpdb-{self.marker}"
        created = Path(info["game"]) / "game/csgo" / (name + ".dem")
        self.owned_files.append(created)
        configure_video(info, self.resolution, "low", self.video_original)
        self.launch(
            info,
            folder,
            [
                "+sv_lan",
                "1",
                "+sv_cheats",
                "1",
                "+game_type",
                "0",
                "+game_mode",
                "1",
                "+map",
                "de_dust2",
            ],
            cap=60,
        )
        started = time.monotonic()
        stage = 0
        schedule = [
            (
                15,
                "jointeam 3; mp_give_player_c4 0; mp_warmup_end; mp_freezetime 0; bot_quota 10; mp_restartgame 1; hideconsole",
            ),
            (
                25,
                f"sv_cheats 1; god; noclip; setpos -1500 2000 400; setang 25 90; record {name}; hideconsole",
            ),
            (100, "stop; hideconsole"),
            (102, f"exec {self.restore_cfg.stem}; quit"),
        ]
        cfgs = []
        for index, (_, commands) in enumerate(schedule):
            cfg = (
                Path(info["game"])
                / "game/csgo/cfg"
                / f"wpdb{hashlib.sha256(self.marker.encode()).hexdigest()[:12]}stage{index}.cfg"
            )
            cfg.write_text(commands.replace("; ", "\n") + "\n")
            self.owned_files.append(cfg)
            cfgs.append(cfg)
        try:
            while self.child.poll() is None:
                self.check()
                self.find_game()
                if time.monotonic() - started > 120:
                    raise RuntimeError("Local replay recording exceeded its deadline")
                if (
                    self.client
                    and stage < len(schedule)
                    and time.monotonic() - started >= schedule[stage][0]
                ):
                    send_game_command(self.client["address"], f"exec {cfgs[stage].stem}")
                    stage += 1
                self.wait(0.2)
            self.check()  # Preserve a sampler failure that terminated the game.
        finally:
            atomic_json(
                folder / "recording-status.json",
                {
                    "stage": stage,
                    "wrapper_exit": self.child.poll() if self.child else None,
                    "duration_s": time.monotonic() - started,
                    "demo_bytes": created.stat().st_size if created.exists() else 0,
                    "guard_failure": self.guard.failure,
                },
            )
            atomic_json(folder / "resources.json", self.guard.rows)
            self.stop_game()
            self.copy_console(info, folder)
            if created.is_file():
                (folder / "recording.dem").write_bytes(created.read_bytes())
        if stage != len(schedule) or not created.is_file() or created.stat().st_size < 100_000:
            raise RuntimeError(
                f"CS2 did not finish a usable local scene; see {folder / 'recording-status.json'}"
            )
        cache.mkdir(parents=True, exist_ok=True)
        demo.write_bytes(created.read_bytes())
        atomic_json(
            manifest,
            {
                "build_id": info["build_id"],
                "sha256": hashlib.sha256(demo.read_bytes()).hexdigest(),
                "scene": "Dust II local bot recording; fixed camera; bomb spawning disabled",
                "source": str(folder),
                "validated": False,
            },
        )
        return demo

    def copy_console(self, info, folder):
        source = Path(info["game"]) / "game/csgo/console.log"
        if source.is_file():
            (folder / "console.log").write_bytes(source.read_bytes())

    def wallpaper(self, condition):
        existing = self.api("status")
        owned_outputs = sorted(
            {output for group in existing["groups"] for output in group["outputs"]}
        )
        if owned_outputs:
            self.api("clear", outputs=owned_outputs)
        if condition != "wallpaper":
            if self.api("status")["surfaces"]:
                raise RuntimeError("Control still has prototype wallpaper surfaces")
            return
        request = self.request
        self.api(
            "set",
            source=request["source"],
            outputs=request["outputs"],
            span=request.get("span", False),
            fps=request["fps"],
            audio=request.get("audio", False),
            experiment=request["experiment"],
            hdr=request.get("hdr", False),
            keep_playing=request["policy"] == "active",
        )
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            self.check()
            surfaces = self.api("status")["surfaces"]
            if {s["output"] for s in surfaces} != set(request["outputs"]):
                raise RuntimeError("Selected wallpaper surfaces are missing")
            telemetry = [s["telemetry"] for s in surfaces]
            if any(t.get("error") or t.get("state") == "error" for t in telemetry):
                raise RuntimeError(f"Wallpaper failed before game launch: {telemetry}")
            if all(
                t.get("state") in (None, "ready")
                and (t.get("frames", 0) > 30 or t.get("renderer") in ("native image", "mpv"))
                for t in telemetry
            ):
                self.wait(2)
                return
            self.wait(0.2)
        raise RuntimeError("Wallpaper never became ready")

    def run_scene(self, info, demo, repeat, condition, warmup=False):
        from lab_common import hypr, capture

        folder = self.directory / ("warmup" if warmup else f"{repeat}-{condition}")
        folder.mkdir()
        trace = folder / "frames.csv"
        game_path = lambda p: ("Z:" if info["platform"] == "proton" else "") + str(p)
        start_tick = 1024
        end_tick = start_tick + 64 * self.request["seconds"]
        self.wallpaper(condition)
        self.status(
            "running",
            "Warming up CS2" if warmup else f"Loading {condition} trial · pair {repeat}",
            message="Loading and setup frames are excluded. Keep the game visible and avoid other heavy work; Cancel stays available in the library.",
        )
        video_settings = configure_video(
            info, self.resolution, self.request["preset"], self.video_original
        )
        atomic_json(folder / "video-settings.json", video_settings)
        self.launch(
            info,
            folder,
            [
                "+timedemo_start",
                "0",
                "+timedemo_end",
                str(end_tick + 64),
                "+timedemo",
                game_path(demo),
                game_path(trace),
            ],
        )
        started = time.monotonic()
        resources = []
        renderer = []
        clock_offsets = []
        previous_size = 0
        stream = Source2Stream()
        next_live = started
        recording = False
        last_tick = 0
        screenshot = False
        ended = False
        next_probe = started
        startup_adjustments = 0
        console = Path(info["game"]) / "game/csgo/console.log"
        try:
            while self.child.poll() is None:
                self.check()
                now = time.monotonic()
                if now - started > 120:
                    raise RuntimeError("CS2 scene exceeded its two-minute deadline")
                if self.client is None:
                    self.find_game()
                if now >= next_probe:
                    next_probe = now + 1
                    if self.client:
                        active = hypr("-j", "activewindow")
                        wallpaper_state = self.api("status")
                        game_monitor = next(
                            (
                                m
                                for m in hypr("-j", "monitors")
                                if m["name"] == self.request["game_output"]
                            ),
                            None,
                        )
                        current = next(
                            (
                                c
                                for c in hypr("-j", "clients")
                                if c["address"] == self.client["address"]
                            ),
                            None,
                        )
                        startup_adjustment = False
                        if (
                            current
                            and current.get("fullscreen") != 2
                            and startup_adjustments < 3
                            and last_tick < start_tick
                        ):
                            # The first CSV flush can jump past the entire setup
                            # interval. Observe the actual startup WM transition.
                            self.desktop.focus_game(self.client)
                            startup_adjustments += 1
                            startup_adjustment = True
                            current = next(
                                (
                                    c
                                    for c in hypr("-j", "clients")
                                    if c["address"] == self.client["address"]
                                ),
                                None,
                            )
                        renderer.append(
                            {
                                "monotonic": now,
                                "surfaces": wallpaper_state["surfaces"],
                                "covered_outputs": wallpaper_state["fullscreen_outputs"],
                                "game_focused": active.get("address") == self.client["address"],
                                "game_window": current,
                                "game_monitor": game_monitor,
                                "startup_adjustment": startup_adjustment,
                            }
                        )
                        if start_tick < last_tick <= end_tick and (
                            not current
                            or current.get("fullscreen") != 2
                            or current.get("visible") is not True
                            or current.get("monitor") != self.desktop.monitor["id"]
                            or not game_monitor
                            or current.get("workspace", {}).get("id")
                            != game_monitor["activeWorkspace"]["id"]
                            or not game_monitor.get("dpmsStatus", True)
                        ):
                            raise RuntimeError(
                                "CS2 did not remain fullscreen on the selected display; capture discarded"
                            )
                    else:
                        renderer.append(
                            {
                                "monotonic": now,
                                "surfaces": self.api("status")["surfaces"],
                                "foreground": hypr("-j", "activewindow"),
                                "game_window": self.client,
                            }
                        )
                if trace.exists() and trace.stat().st_size != previous_size:
                    previous_size = trace.stat().st_size
                    with trace.open() as reader:
                        reader.seek(getattr(stream, "offset", 0))
                        stream.feed(reader.read())
                        stream.offset = reader.tell()
                    last_tick = stream.last_tick or 0
                    if stream.previous:
                        clock_offsets.append(time.monotonic() - stream.previous["engine_swap_s"])
                if not warmup and last_tick >= start_tick and not recording:
                    recording = True
                    self.status(
                        "running",
                        f"Recording {condition} benchmark",
                        recording=condition,
                        message=f"Pair {repeat} · live data updates as the game flushes frames.",
                    )
                if now >= next_live and not warmup:
                    next_live = now + 1
                    selected_live = stream.partial(start_tick, end_tick)
                    if selected_live:
                        origin_live = (
                            selected_live[0]["engine_swap_s"] - selected_live[0]["frame_ms"] / 1000
                        )
                        bridge_live = min(clock_offsets)
                        live_resources = [
                            row | {"time_s": row["monotonic"] - bridge_live - origin_live}
                            for row in resources
                            if 0
                            <= row["monotonic"] - bridge_live - origin_live
                            <= selected_live[-1]["time_s"]
                        ]
                        self.publish(
                            {
                                "repeat": repeat,
                                "condition": condition,
                                "valid": False,
                                "provisional": True,
                                "summary": summarize(selected_live),
                                "plot": envelope(selected_live),
                                "resources": live_resources,
                                "wall_seconds": selected_live[-1]["time_s"],
                            }
                        )
                if warmup and not screenshot and last_tick >= start_tick + 128:
                    capture(folder / "scene.png", self.request["game_output"])
                    screenshot = True
                resource = self.guard.snapshot()
                if not resources or resources[-1]["monotonic"] != resource["monotonic"]:
                    resources.append(
                        resource
                        | {
                            "game_cpu": (
                                process_usage(self.client.get("pid")) if self.client else None
                            ),
                            "cpu_monotonic": time.monotonic(),
                        }
                    )
                text = console.read_text(errors="replace") if console.exists() else ""
                if "FATAL ERROR:" in text:
                    raise RuntimeError(
                        "CS2 replay failed: " + text.split("FATAL ERROR:", 1)[1].splitlines()[0]
                    )
                if (
                    "NETWORK_DISCONNECT_REPLAY_INCOMPATIBLE" in text
                    or "Unable to open demo file" in text
                ):
                    raise RuntimeError("The replay is incompatible with the installed CS2 build")
                if trace.exists() and str(trace) in text and "Closed demo frame stats file" in text:
                    ended = True
                    break
                self.wait(0.2)
            self.check()
            if not ended:
                text = console.read_text(errors="replace") if console.exists() else ""
                ended = (
                    trace.exists() and str(trace) in text and "Closed demo frame stats file" in text
                )
            if not ended:
                raise RuntimeError("CS2 exited without completing the requested scene")
            if self.client:
                # Restore archived console preferences before the game's Steam Cloud write on exit.
                send_game_command(self.client["address"], f"exec {self.restore_cfg.stem}; quit")
                deadline = time.monotonic() + 8
                while self.child.poll() is None and time.monotonic() < deadline:
                    self.wait(0.2)
        finally:
            errors = cleanup_all(
                [
                    ("game process", self.stop_game),
                    ("console evidence", lambda: self.copy_console(info, folder)),
                    (
                        "resource evidence",
                        lambda: atomic_json(folder / "resources.json", resources),
                    ),
                    (
                        "wallpaper evidence",
                        lambda: atomic_json(folder / "wallpaper.json", renderer),
                    ),
                ]
            )
            if errors:
                raise RuntimeError("; ".join(errors))
        frames = parse_source2(io.StringIO(trace.read_text()))
        selected = segment(frames, start_tick, end_tick)
        summary = summarize(selected)
        aggregate = source2_summary(Path(info["game"]) / "game/csgo/Source2BenchV2.csv")
        actual = [int(aggregate["width"]), int(aggregate["height"])]
        if actual != self.resolution:
            raise RuntimeError(
                f"CS2 rendered at {actual}, requested {self.resolution}; try Current game resolution"
            )
        msaa = observed_msaa((folder / "console.log").read_text(errors="replace"), actual)
        expected_msaa = max(1, int(video_settings["setting.msaa_samples"]))
        if msaa != expected_msaa:
            raise RuntimeError(
                f"Engine render targets used {msaa} samples, requested {expected_msaa}"
            )
        if not clock_offsets:
            raise RuntimeError("No game/resource clock anchors observed")
        # Buffered-write observation gives a coarse clock bridge, never a per-spike causal attribution.
        bridge = min(clock_offsets)
        origin = selected[0]["engine_swap_s"] - selected[0]["frame_ms"] / 1000
        synchronized = []
        times = [frame["time_s"] for frame in selected]
        previous_cpu = None
        for row in resources:
            t = row["monotonic"] - bridge - origin
            if 0 <= t <= selected[-1]["time_s"]:
                value = row | {"time_s": t}
                cpu_time = row["cpu_monotonic"] - bridge - origin
                value["cpu_time_s"] = cpu_time
                value["cpu_scene_s"] = selected[
                    min(len(selected) - 1, bisect.bisect_left(times, cpu_time))
                ]["scene_s"]
                value["scene_s"] = selected[min(len(selected) - 1, bisect.bisect_left(times, t))][
                    "scene_s"
                ]
                cpu = row.get("game_cpu")
                if cpu and previous_cpu and 0 <= cpu_time <= selected[-1]["time_s"]:
                    elapsed = row["cpu_monotonic"] - previous_cpu[0]
                    value["game_cpu_one_core_percent"] = (
                        100 * (cpu["cpu_s"] - previous_cpu[1]["cpu_s"]) / elapsed
                    )
                if cpu:
                    previous_cpu = (row["cpu_monotonic"], cpu)
                synchronized.append(value)
        if len(synchronized) < 3:
            raise RuntimeError("The measured scene is too short for resource telemetry")
        verify_game(renderer, self.request["game_output"], bridge + origin, selected[-1]["time_s"])
        verify_wallpaper(
            renderer,
            condition,
            self.request | {"kind": self.item["kind"]},
            bridge + origin,
            selected[-1]["time_s"],
        )
        identity = {
            "build_id": info["build_id"],
            "demo_sha256": hashlib.sha256(demo.read_bytes()).hexdigest(),
            "ticks": [start_tick, end_tick],
            "resolution": actual,
            "preset": self.request["preset"],
            "cap": self.request["cap"],
            "vsync": False,
            "display": self.request["game_output"],
            "collector": "Source2 frame swap delta, schema 1",
            "platform": info["platform"],
            "proton": info["proton_name"],
            "driver": aggregate.get("driver"),
            "wallpaper_outputs": self.request["outputs"],
            "policy": self.request["policy"],
            "game_focus_policy": "engine_no_focus_sleep=0; visible fullscreen replay",
            "submitted_video_settings": video_settings,
            "engine_settings": {
                key: aggregate.get(key)
                for key in ("gpu_level", "cpu_level", "backbuffer", "rendersystemdll", "dxlevel")
            },
            "observed_msaa_samples": msaa,
        }
        result = {
            "repeat": repeat,
            "condition": condition,
            "valid": True,
            "summary": summary,
            "plot": envelope(selected),
            "resources": synchronized,
            "identity": identity,
            "raw_directory": str(folder),
            "actual_resolution": actual,
            "scene_seconds": self.request["seconds"],
            "wall_seconds": selected[-1]["time_s"],
            "clock_bridge": {
                "offset_s": bridge,
                "method": "minimum observed CSV flush delay",
                "poll_seconds": 0.2,
                "note": "Buffered file clock estimate; coarse GPU trends only.",
            },
            "engine_summary": aggregate,
        }
        atomic_json(folder / "analysis.json", result)
        return result

    def run(self):
        from game_bench import discover, game_processes
        from lab_common import ENV, hypr
        from profile import SafetyMonitor, SafetyGuard

        actions = []
        result = None
        failure = None
        self.owned_files = []
        try:
            check_session(ENV)
            info = discover()
            if game_processes():
                raise RuntimeError(
                    "Close CS2 before pressing Bench; existing games are left running"
                )
            monitors = hypr("-j", "monitors")
            connected = {
                m["name"] for m in monitors if not m.get("disabled") and m.get("dpmsStatus", True)
            }
            validate_request(self.request, connected)
            if len(info["cfg_dirs"]) != 1:
                raise RuntimeError(
                    "Expected one CS2 settings profile; multiple Steam users need explicit selection"
                )
            status = self.api("status")
            self.item = next(
                (i for i in status["items"] if i["id"] == self.request["source"]), None
            )
            if self.item is None:
                raise RuntimeError("Selected wallpaper is no longer installed")
            self.graphics = GraphicsWatch(self.directory, ENV)
            actions.append(("graphics fault monitor", self.graphics.close))
            self.guard = SafetyMonitor(
                SafetyGuard(cpu_temperature_check=self.request.get("cpu_temperature_check", True)),
                max_rows=1200 if self.manual else None,
            )
            actions.append(("resource sampler", self.guard.stop))
            self.check()
            self.wake = WakeLease(self.directory, self.marker, ENV)
            actions.insert(0, ("wake inhibitor", self.wake.close))
            backgrounds = FrozenBackgrounds(self.directory)
            actions.insert(0, ("external wallpapers", backgrounds.restore))
            external = backgrounds.freeze()
            self.desktop = DesktopLease(self.request["game_output"], self.marker, self.directory)
            actions.insert(0, ("desktop workspace", self.desktop.restore))
            game = Path(info["game"]) / "game/csgo"
            backups = FileSnapshot(
                self.directory / "settings-backup",
                [Path(p) for p in info["cfg_dirs"]],
                [game / n for n in ["console.log", "Source2BenchV2.csv", "timedemo_profile.csv"]],
            )
            self.video_original = (Path(info["cfg_dirs"][0]) / "cs2_video.txt").read_text()

            def restore_settings():
                if game_processes(self.marker):
                    raise RuntimeError(
                        "CS2 is still running; restore the retained settings backup after it exits"
                    )
                backups.restore()

            actions.insert(0, ("game settings", restore_settings))
            self.restore_cfg = game / "cfg" / f"wpdb-restore-{self.marker}.cfg"
            self.owned_files.append(self.restore_cfg)
            write_restore_cfg(info, self.restore_cfg)
            actions.insert(
                0,
                ("temporary files", lambda: [p.unlink(missing_ok=True) for p in self.owned_files]),
            )
            actions.insert(0, ("game process", self.stop_game))
            monitor = self.desktop.monitor
            self.resolution = (
                [monitor["width"], monitor["height"]]
                if self.request["resolution"] == "display"
                else current_resolution(info)
            )
            self.result = result = {
                "schema": 2,
                "id": self.marker,
                "request": {
                    k: v
                    for k, v in self.request.items()
                    if k not in ("bench_token", "control", "directory", "op")
                },
                "game": {k: info[k] for k in ("platform", "proton_name", "build_id", "version")},
                "wallpaper": self.item,
                "actual_resolution": None,
                "requested_resolution": self.resolution,
                "comparison": None,
                "runs": self.runs,
                "external_backgrounds": external,
                "outputs": monitors,
                "scope": {
                    "game_frames": "Application frame intervals; not physical scanout or input latency",
                    "gpu": "Whole NVIDIA device via NVML at 4 Hz, with the driver averaging window",
                    "cpu": "CS2 process CPU, expressed as percent of one core",
                    "control": "Prototype surfaces removed; existing mpvpaper stopped, its retained textures remain",
                    "focus": "engine_no_focus_sleep=0; focus and visibility retained in raw observations",
                },
                "limitations": [
                    "A local bot game is not a live multiplayer match.",
                    "Short runs and small low-percentile sample counts need repeated observations.",
                    "External applications and compositor workload can still vary.",
                    "GPU-only bottleneck or a renderer winner cannot be inferred from average utilization.",
                ],
            }
            self.publish()
            self.desktop.enter()
            self.wallpaper("control")
            if self.manual:
                from game_bench_manual import record_gameplay

                record_gameplay(self, info)
            else:
                result["scope"].update(
                    {
                        "collector": "Source 2 application swap intervals",
                        "timedemo": "One rendered frame per demo tick; world playback accelerates at higher FPS",
                        "warmup": "One full replay excluded, then first 1024 ticks excluded in each measured run",
                        "clock": "Coarse clock bridge from buffered CSV flushes; not suitable for attributing an individual hitch",
                    }
                )
                demo = self.prepare_demo(info)
                result["demo"] = {
                    "path": str(demo),
                    "sha256": hashlib.sha256(demo.read_bytes()).hexdigest(),
                }
                warmup = self.run_scene(info, demo, 0, "control", warmup=True)
                result["actual_resolution"] = warmup["actual_resolution"]
                if not self.request.get("demo"):
                    metadata_path = demo.parent / "scene.json"
                    metadata = json.loads(metadata_path.read_text())
                    metadata["validated"] = True
                    metadata["warmup_evidence"] = str(self.directory / "warmup")
                    atomic_json(metadata_path, metadata)
                self.completed += 1
                for repeat in range(1, self.request["repeats"] + 1):
                    order = ["control", "wallpaper"] if repeat % 2 else ["wallpaper", "control"]
                    for condition in order:
                        self.check()
                        self.runs.append(self.run_scene(info, demo, repeat, condition))
                        self.completed += 1
                        atomic_json(self.directory / "partial.json", {"runs": self.runs})
                        self.publish()
                self.check()
        except Finished:
            self.stopped = True
            if result is None:
                self.result = result = {
                    "schema": 2,
                    "id": self.marker,
                    "runs": self.runs,
                    "request": {
                        k: v
                        for k, v in self.request.items()
                        if k not in ("bench_token", "control", "directory", "op")
                    },
                    "wallpaper": {"title": self.request.get("source", "Wallpaper")},
                    "game": {},
                    "comparison": None,
                }
        except Exception as error:
            failure = error
            traceback.print_exc()
        try:
            self.status("restoring", "Restoring CS2 settings and the desktop")
        except OSError:
            traceback.print_exc()
        cleanup_errors = cleanup_all(actions)
        if self.graphics and self.graphics.failure and failure is None:
            failure = GraphicsFault(self.graphics.failure)
        if self.guard and self.guard.failure and failure is None:
            failure = RuntimeError(self.guard.failure)
        if cleanup_errors:
            failure = RuntimeError(f'{failure or ""}; Restoration: ' + "; ".join(cleanup_errors))
        if result is not None and failure is None:
            result["comparison"] = completed_comparison(self.runs)
            result["stopped"] = self.stopped
            result["restoration"] = {
                "worker": "complete",
                "desktop_wallpapers": "restored by the Rust host after worker exit",
            }
            atomic_json(self.directory / "result.json", result)
            self.status(
                "complete",
                "Recording saved" if self.stopped else "Comparison complete",
                stopped=self.stopped,
            )
            self.publish()
            return 0
        state = "cancelled" if isinstance(failure, Cancelled) else "failed"
        self.status(
            state,
            "Cancelled" if state == "cancelled" else "Benchmark failed",
            error=str(failure),
            graphics_fault=isinstance(failure, GraphicsFault)
            or bool(self.graphics and self.graphics.failure),
        )
        return 1


def process_usage(pid):
    try:
        fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
        return {
            "cpu_s": (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK"),
            "rss_mib": int(fields[21]) * os.sysconf("SC_PAGE_SIZE") / 1048576,
        }
    except (OSError, ValueError, IndexError):
        return None


def current_resolution(info):
    from game_bench import vdf

    settings = vdf((Path(info["cfg_dirs"][0]) / "cs2_video.txt").read_text())["video.cfg"]
    return [int(settings["setting.defaultres"]), int(settings["setting.defaultresheight"])]


def configure_video(info, resolution, preset, original=None):
    from game_bench import vdf

    path = Path(info["cfg_dirs"][0]) / "cs2_video.txt"
    data = path.read_text() if original is None else original
    changes = {
        "defaultres": resolution[0],
        "defaultresheight": resolution[1],
        "mat_vsync": 0,
        "fullscreen": 0,
        "coop_fullscreen": 0,
        "nowindowborder": 1,
    }
    if preset != "current":
        high = preset == "high"
        changes |= {
            "msaa_samples": 4 if high else 0,
            "gpu_level": 3 if high else 0,
            "cpu_level": 3 if high else 0,
            "shaderquality": 1 if high else 0,
            "videocfg_shadow_quality": 2 if high else 0,
            "videocfg_texture_detail": 2 if high else 0,
            "videocfg_particle_detail": 2 if high else 0,
            "videocfg_ao_detail": 2 if high else 0,
        }
    for key, value in changes.items():
        pattern = r'("setting\.' + re.escape(key) + r'"\s*")[^"]*(")'
        data, count = re.subn(pattern, lambda match: match[1] + str(value) + match[2], data)
        if not count:
            raise RuntimeError(f"This CS2 build has no video setting {key}")
    path.write_text(data)
    return {
        key: value for key, value in vdf(data)["video.cfg"].items() if key.startswith("setting.")
    }


def write_restore_cfg(info, path):
    from game_bench import vdf

    source = Path(info["cfg_dirs"][0]) / "cs2_user_convars_0_slot0.vcfg"
    data = vdf(source.read_text())
    convars = data.get("config", {}).get("convars", {})
    lines = []
    for key, value in convars.items():
        if re.fullmatch("[a-zA-Z0-9_]+", key) and isinstance(value, str):
            escaped = (
                value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "").replace("\r", "")
            )
            lines.append(f'{key} "{escaped}"')
    if not lines:
        raise RuntimeError("Could not prepare archived CS2 preference restoration")
    path.write_text("\n".join(lines) + "\necholn wpdbpreferencesrestored\n")


def source2_summary(path):
    rows = list(csv.reader(io.StringIO(path.read_text())))
    header = next(i for i, row in enumerate(rows) if "numframes" in row and "width" in row)
    row = next(row for row in reversed(rows[header + 1 :]) if row)
    return dict(zip([key.strip() for key in rows[header]], [value.strip() for value in row]))


def observed_msaa(console, resolution):
    targets = re.findall(
        r"\bRT " + str(resolution[0]) + "x" + str(resolution[1]) + r" \S+\s+(?:(\d+)xMSAA\s*)?:",
        console,
    )
    if not targets:
        raise ValueError("No engine render-target evidence for the selected resolution")
    return max(int(value) if value else 1 for value in targets)


def verify_game(observations, output, start, duration):
    rows = [r for r in observations if start <= r["monotonic"] <= start + duration]
    if not rows:
        raise RuntimeError("No visible game observations during the measured scene")
    for row in rows:
        window, monitor = row.get("game_window"), row.get("game_monitor")
        if (
            not window
            or not monitor
            or window.get("visible") is not True
            or row.get("startup_adjustment")
            or window.get("fullscreen") != 2
            or monitor.get("name") != output
            or not monitor.get("dpmsStatus", True)
            or window.get("monitor") != monitor["id"]
            or window.get("workspace", {}).get("id") != monitor["activeWorkspace"]["id"]
        ):
            raise RuntimeError("Game was hidden or left the selected fullscreen workspace")


def verify_wallpaper(observations, condition, request, start, duration):
    rows = [r for r in observations if start <= r["monotonic"] <= start + duration]
    if not rows:
        raise RuntimeError("No wallpaper state observed during the scene")
    if condition == "control":
        if any(r["surfaces"] for r in rows):
            raise RuntimeError("Control condition contains a wallpaper")
        return
    for row in rows:
        if {s["output"] for s in row["surfaces"]} != set(request["outputs"]):
            raise RuntimeError("Wallpaper disappeared during the scene")
        for surface in row["surfaces"]:
            t = surface["telemetry"]
            if (
                t.get("error")
                or t.get("black_output") is True
                or t.get("state") not in (None, "ready")
            ):
                raise RuntimeError("Wallpaper renderer failed during game capture")
    for output in request["outputs"]:
        samples = [next(s for s in r["surfaces"] if s["output"] == output) for r in rows]
        first, last = samples[0]["telemetry"], samples[-1]["telemetry"]
        coverage = [set(row["covered_outputs"]) for row in rows]
        if request["policy"] == "normal" and any(value != coverage[0] for value in coverage):
            raise RuntimeError("Fullscreen coverage changed during the measured scene")
        paused = request["policy"] == "normal" and output in coverage[0]
        if first.get("renderer") == "native image":
            continue
        if any(sample.get("paused") is not paused for sample in samples):
            raise RuntimeError(
                f"Observed fullscreen pause policy differs from the request on {output}"
            )
        producer_paused = paused
        if request.get("span") and request.get("experiment") != "baseline":
            producer_paused = (
                request["policy"] == "normal" and set(request["outputs"]) <= coverage[0]
            )
        if any(sample["telemetry"].get("paused") is not producer_paused for sample in samples):
            raise RuntimeError(f"Wallpaper producer pause state was not verified on {output}")
        if producer_paused:
            key = "time" if first.get("renderer") == "mpv" else "frames"
            values = [sample["telemetry"].get(key) for sample in samples]
            if len(values) < 2 or any(value is None for value in values):
                raise RuntimeError(
                    f"Insufficient evidence of stopped wallpaper playback on {output}"
                )
            if len(set(values)) != 1:
                raise RuntimeError(f"Paused wallpaper continued producing on {output}")
        if (
            not producer_paused
            and request.get("kind") != "image"
            and len(samples) > 1
            and first.get("renderer") != "mpv"
            and (first.get("frames") is None or last.get("frames", 0) <= first["frames"])
        ):
            raise RuntimeError(f"Active wallpaper stopped producing frames on {output}")
        if first.get("renderer") == "mpv":
            if not producer_paused and len({s["telemetry"].get("time") for s in samples}) < 2:
                raise RuntimeError("Wallpaper video playback did not advance")
        if request.get("kind") == "video" and "media_new_frame_renders" in first:
            delta = last.get("media_new_frame_renders", 0) - first["media_new_frame_renders"]
            if (producer_paused and delta != 0) or (not producer_paused and delta <= 0):
                raise RuntimeError(
                    "Independent video frame progression differs from its pause policy"
                )
