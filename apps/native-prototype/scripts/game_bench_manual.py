"""One owned offline CS2 session, with user-controlled and unequal recording phases."""

import hashlib
import json
from pathlib import Path
import shutil
import time

from game_bench_host import atomic_json, send_game_command
from game_bench_live import MangoHudLog, MangoHudStream


def record_gameplay(job, info):
    from game_bench_worker import configure_video, process_usage
    from lab_common import hypr

    folder = job.directory / "gameplay"
    folder.mkdir()
    logs = folder / "frames"
    logs.mkdir()
    name = "wpdb" + hashlib.sha256(job.marker.encode()).hexdigest()[:20]
    # no_display prevents MangoHud's autostart timer from running in 0.8.4.
    # Keep its tiny HUD transparent and outside the viewport instead.
    (job.directory / "mangohud.conf").write_text(
        f"no_display=0\nalpha=0\nbackground_alpha=0\noffset_x=-10000\noffset_y=-10000\nfps_only\nlog_interval=0\nlog_duration=0\nautostart_log=1\n"
        f"output_folder={logs}\npermit_upload=0\nfps_limit=0\n"
    )
    settings = configure_video(info, job.resolution, job.request["preset"], job.video_original)
    atomic_json(folder / "video-settings.json", settings)
    job.result["scope"].update(
        {
            "collector": "MangoHud 0.8 per-frame Vulkan presentation intervals (log_interval=0)",
            "manual": "One live offline game. Control and wallpaper durations are independent; gameplay is not matched.",
            "clock": "Gameplay frame clock; host resource times relative to the logging command, approximate alignment",
            "live": "At most 1200 time buckets per phase. Min/max frame times survive coarsening. Live percentiles use 1 microsecond bins; saved summaries use exact raw frame values.",
        }
    )
    job.result["limitations"] += [
        "Manual phases have different gameplay and durations; their difference is descriptive, not a controlled causal estimate.",
        "MangoHud writes each frame to disk and retains its own recording buffer. Collector and open-UI overhead have not been isolated.",
        "Manual render dimensions and graphics settings are submitted settings, not independently verified engine dimensions.",
    ]
    identity = {
        "build_id": info["build_id"],
        "platform": info["platform"],
        "proton": info["proton_name"],
        "mode": "manual",
        "session": job.marker,
        "requested_resolution": job.resolution,
        "preset": job.request["preset"],
        "cap": job.request["cap"],
        "display": job.request["game_output"],
        "collector": "MangoHud per-frame Vulkan, log_interval=0",
        "submitted_video_settings": settings,
        "wallpaper_outputs": job.request["outputs"],
        "policy": job.request["policy"],
    }
    job.status(
        "running",
        "Loading continuous gameplay",
        message="Preparing an offline Dust II bot game. The library stays on its current display.",
    )
    job.publish()
    job.launch(
        info, folder, ["+sv_lan", "1", "+game_type", "0", "+game_mode", "1", "+map", "de_dust2"]
    )
    tail = MangoHudLog(logs)
    phase_file = None
    stream = None
    trace = None
    resources = []
    resource_stride = 0.25
    next_resource = 0
    capture_started = 0
    condition = None
    logging = False
    previous_cpu = None
    last_resource = None
    last_frame_at = 0
    next_live = 0
    next_probe = 0
    next_disk = 0
    observation_count = hidden_count = unfocused_count = 0
    raw = (folder / "observations.jsonl").open("w")

    def drain():
        nonlocal last_frame_at
        data = tail.read()
        if data and logging:
            count = len(stream.stats.values)
            stream.feed(data)
            phase_file.write(data)
            phase_file.flush()
            if len(stream.stats.values) > count:
                last_frame_at = time.monotonic()

    def run_view(exact=False):
        return {
            "repeat": 1,
            "condition": condition,
            "valid": exact,
            "provisional": not exact,
            "summary": stream.stats.summary(exact=exact),
            "plot": stream.stats.plot(),
            "resources": resources,
            "wall_seconds": stream.stats.total_ms / 1000,
            "identity": identity,
            "raw_directory": str(folder),
            "raw_frames": str(trace) if trace else None,
            "session_frames": str(tail.path),
            "first_log_elapsed_s": stream.first,
            "last_log_elapsed_s": stream.last_elapsed,
            "observations": {
                "count": observation_count,
                "hidden": hidden_count,
                "unfocused": unfocused_count,
            },
        }

    def finish_phase():
        nonlocal logging
        if not logging:
            return
        drain()
        logging = False
        phase_file.close()
        if len(stream.stats.values) >= 2:
            stream.validate()
        run = run_view(exact=True)
        if len(stream.stats.values) < 2:
            run.update(valid=False, excluded_reason="Fewer than two frames were recorded")
        job.runs.append(run)
        job.completed += 1
        atomic_json(folder / f"{condition}-analysis.json", run)
        atomic_json(job.directory / "partial.json", {"runs": job.runs})
        job.publish()

    try:
        started = time.monotonic()
        while True:
            job.check()
            if job.child.poll() is not None:
                raise RuntimeError("CS2 exited while preparing continuous gameplay")
            job.find_game()
            console = Path(info["game"]) / "game/csgo/console.log"
            text = console.read_text(errors="replace") if console.exists() else ""
            tail.read()
            if (
                job.client
                and "CNetworkGameClient::OnSwitchLoopModeFinished( game : success )" in text
                and tail.header
            ):
                break
            if time.monotonic() - started > 90:
                raise RuntimeError(
                    "CS2 or its per-frame MangoHud log did not become ready within 90 seconds"
                )
            job.wait(0.5)
        cfg = Path(info["game"]) / "game/csgo/cfg" / (name + ".cfg")
        cfg.write_text("jointeam 3\nmp_warmup_end\nmp_freezetime 0\nbot_quota 10\nhideconsole\n")
        job.owned_files.append(cfg)
        send_game_command(job.client["address"], f"exec {name}")
        job.wait(3)
        job.desktop.focus_game(job.client)
        job.allow_finish = True
        job.next_requested()  # Ignore premature clicks while the game was loading.
        job.status(
            "running",
            "Ready to record control benchmark",
            can_next=True,
            message="Get ready in the game, then choose Start control recording. Loading and the phase transition are excluded.",
        )
        job.publish()
        while True:
            job.check()
            now = time.monotonic()
            if job.finish_requested():
                finish_phase()
                job.stopped = True
                break
            if job.child.poll() is not None:
                raise RuntimeError("CS2 closed before Stop and save; raw observations are retained")
            requested = job.next_requested()
            if (
                requested == ("wallpaper" if condition == "control" else "control")
                and condition != "wallpaper"
            ):
                job.status(
                    "running",
                    "Preparing wallpaper recording" if condition else "Starting control recording",
                )
                finish_phase()
                next_condition = "wallpaper" if condition else "control"
                if next_condition == "wallpaper":
                    job.wallpaper("wallpaper")
                job.wait(0.25)
                if job.finish_requested():
                    job.stopped = True
                    break
                stream, trace, resources = MangoHudStream(), None, []
                previous_cpu = last_resource = None
                observation_count = hidden_count = unfocused_count = 0
                resource_stride, next_resource = 0.25, 0
                tail.read()  # Discard all loading/transition frames before this phase.
                stream.feed(tail.header + "\n")
                condition = next_condition
                hypr("dispatch", "focuswindow", f"address:{job.client['address']}")
                capture_started = last_frame_at = time.monotonic()
                trace = folder / f"{condition}-frames.csv"
                phase_file = trace.open("w")
                phase_file.write(tail.header + "\n")
                logging = True
                job.status(
                    "running",
                    f"Recording {condition} benchmark",
                    recording=condition,
                    can_next=condition == "control",
                    message="Play for as long as you like. "
                    + (
                        "Switch to wallpaper recording when ready."
                        if condition == "control"
                        else "Stop and save when you are done. Each phase keeps its own duration."
                    ),
                )
                job.publish()
            drain()
            if logging:
                if now - last_frame_at > 15:
                    raise RuntimeError("No new gameplay frames for 15 seconds; collector stalled")
                resource = job.guard.snapshot()
                if resource["monotonic"] != last_resource:
                    last_resource = resource["monotonic"]
                    cpu = process_usage(job.client["pid"])
                    row = resource | {"time_s": resource["monotonic"] - capture_started}
                    if cpu and previous_cpu:
                        row["game_cpu_one_core_percent"] = max(
                            0, 100 * (cpu["cpu_s"] - previous_cpu[1]) / (now - previous_cpu[0])
                        )
                    if cpu:
                        previous_cpu = (now, cpu["cpu_s"])
                    raw.write(json.dumps({"condition": condition, "resource": row}) + "\n")
                    if row["time_s"] >= next_resource:
                        resources.append(row)
                        next_resource = row["time_s"] + resource_stride
                        if len(resources) > 1200:
                            resources = resources[::2]
                            resource_stride *= 2
                if now >= next_probe:
                    next_probe = now + 1
                    status = job.api("status")
                    if condition == "control" and status["surfaces"]:
                        raise RuntimeError("Control contains a prototype wallpaper")
                    if condition == "wallpaper":
                        if {s["output"] for s in status["surfaces"]} != set(job.request["outputs"]):
                            raise RuntimeError("Wallpaper disappeared during recording")
                        if any(
                            s["telemetry"].get("error") or s["telemetry"].get("black_output")
                            for s in status["surfaces"]
                        ):
                            raise RuntimeError("Wallpaper renderer failed during recording")
                    current = next(
                        (c for c in hypr("-j", "clients") if c["address"] == job.client["address"]),
                        None,
                    )
                    focused = hypr("-j", "activewindow").get("address") == job.client["address"]
                    observation_count += 1
                    hidden_count += not current or not current.get("visible")
                    unfocused_count += not focused
                    raw.write(
                        json.dumps(
                            {
                                "condition": condition,
                                "monotonic": now,
                                "game_window": current,
                                "game_focused": focused,
                                "surfaces": status["surfaces"],
                                "covered_outputs": status["fullscreen_outputs"],
                            }
                        )
                        + "\n"
                    )
                    raw.flush()
                if now >= next_live:
                    next_live = now + 1
                    if stream.stats.values:
                        job.publish(run_view())
            if now >= next_disk:
                next_disk = now + 30
                if shutil.disk_usage(folder).free < 512 * 1024 * 1024:
                    raise RuntimeError("Less than 512 MiB free for gameplay evidence")
            job.wait(0.1)
        job.status("running", "Saving gameplay recording")
        job.publish()
        send_game_command(job.client["address"], f"exec {job.restore_cfg.stem}; quit")
        deadline = time.monotonic() + 8
        while job.child.poll() is None and time.monotonic() < deadline:
            job.wait(0.2)
    finally:
        if phase_file and not phase_file.closed:
            phase_file.close()
        raw.close()
        job.copy_console(info, folder)
