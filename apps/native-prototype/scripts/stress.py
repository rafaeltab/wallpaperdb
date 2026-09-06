"""Guarded, disposable 4K experiment matrix. No physical display mode changes.

Run through `make native-stress ARGS='--list'` to inspect the recipe. Detailed
profiling lives in profile.py; this runner owns its temporary output and cleanup.
"""

import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import time

from lab_common import ROOT, ENV, api, hypr, saved_assignments

ENGINES = ["idle", "baseline", "gpu", "gpu-paced", "chromium"]
SUPPORTED_CASES = (set(ENGINES) | {"gpu-independent", "gpu-independent-drop"}) | {
    engine + "-paused"
    for engine in [*ENGINES, "gpu-independent", "gpu-independent-drop"]
    if engine != "idle"
}


def recipe(stage):
    def row(name, source, fps, seconds, repeats, contention, engines=ENGINES):
        return dict(
            name=name,
            source="stress-studio" + ("/" + source if source else ""),
            fps=fps,
            seconds=seconds,
            repeats=repeats,
            contention=contention,
            engines=engines,
        )

    recipes = {
        "screen": [row(f"screen-{fps}", "", fps, 15, 1, False) for fps in [120, 360]],
        "sweep": [
            row(f"sweep-{level}", "shader-" + level, 360, 20, 1, False)
            for level in ["light", "heavy"]
        ],
        "sustained": [row(f"paired-{fps}", "shader-heavy", fps, 60, 3, True) for fps in [120, 360]],
        "media": [row(f"media-{fps}", "media-heavy", fps, 60, 2, True) for fps in [120, 360]],
        "files": [
            row(f"file-{kind}", f"background-4k.{extension}", 360, 30, 1, False)
            for kind, extension in [("image", "png"), ("video", "mp4")]
        ],
        "soak": [
            row("soak-media-360", "media-heavy", 360, 180, 1, True, ["idle", "gpu", "gpu-paced"])
        ],
        "paused": [
            row(
                "paused-media-360",
                "media-heavy",
                360,
                45,
                2,
                True,
                ["idle", "baseline-paused", "gpu-paused", "gpu-paced-paused", "chromium-paused"],
            )
        ],
    }
    return [r for rows in recipes.values() for r in rows] if stage == "all" else recipes[stage]


@contextlib.contextmanager
def virtual_output(name, refresh):
    """An owned output; never remove a pre-existing output of the same name."""
    if any(m["name"] == name for m in hypr("-j", "monitors", "all")):
        raise RuntimeError(f"Output {name} already exists; refusing to replace it")
    created = False
    attempted = False
    try:
        attempted = True
        hypr("output", "create", "headless", name)
        created = True
        hypr("keyword", "monitor", f"{name},3840x2160@{refresh},6000x0,1")
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            monitor = next((m for m in hypr("-j", "monitors") if m["name"] == name), None)
            state_monitor = next((m for m in api("status")["monitors"] if m["name"] == name), None)
            if monitor and state_monitor and monitor["width"] == 3840 and monitor["height"] == 2160:
                if abs(monitor["refreshRate"] - refresh) > 0.1 or monitor["scale"] != 1:
                    raise RuntimeError(f"Unexpected virtual mode: {monitor}")
                yield monitor
                return
            time.sleep(0.2)
        raise RuntimeError("4K virtual output did not become ready")
    finally:
        if attempted and not created:
            # The IPC client can fail after the compositor accepted creation.
            # The initial refusal established that this reserved name was absent.
            try:
                created = any(m["name"] == name for m in hypr("-j", "monitors", "all"))
            except Exception as error:
                raise RuntimeError(
                    f"Cannot determine output creation outcome for {name}: {error}"
                ) from error
        if created:
            try:
                api("clear", outputs=[name])
            finally:
                hypr("output", "remove", name)


def mean(values):
    return statistics.mean(values) if values else None


@contextlib.contextmanager
def termination_cleanup():
    """The first interruption unwinds ownership contexts; later ones cannot cut cleanup short."""
    signals = (signal.SIGTERM, signal.SIGINT)
    previous = {sig: signal.getsignal(sig) for sig in signals}

    def interrupt(signum, _frame):
        for sig in signals:
            signal.signal(sig, signal.SIG_IGN)
        raise KeyboardInterrupt(signal.Signals(signum).name)

    try:
        for sig in signals:
            signal.signal(sig, interrupt)
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


@contextlib.contextmanager
def deferred_spawn_signals():
    """Publish the new child handle before dispatching a signal received in Popen."""
    signals = (signal.SIGTERM, signal.SIGINT)
    previous = {sig: signal.getsignal(sig) for sig in signals}
    pending = []

    def defer(signum, _frame):
        if not pending:
            pending.append(signum)
        # Keep caught dispositions during exec; children must not inherit SIG_IGN.

    try:
        for sig in signals:
            signal.signal(sig, defer)
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if pending:
            signum = pending[0]
            handler = previous[signum]
            if callable(handler):
                handler(signum, None)
            elif handler != signal.SIG_IGN:
                raise KeyboardInterrupt(signal.Signals(signum).name)


def wait_child(child, timeout):
    """Observe exit without reaping: the leader's reserved PID pins its owned process group.

    Do not use Popen.poll/wait until stop_child has drained that group. WNOWAIT
    deliberately leaves an exited leader waitable, even if its descendants live.
    https://docs.python.org/3/library/os.html#os.waitid
    """
    deadline = time.monotonic() + timeout
    while True:
        result = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        if result is not None:
            return result.si_status if result.si_code == os.CLD_EXITED else -result.si_status
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(child.args, timeout)
        time.sleep(min(0.1, remaining))


def owned_group_members(child):
    # WNOWAIT plus our sole ownership of reaping prevents PID/PGID reuse during
    # the following /proc scan and killpg. Refuse to signal if that proof is lost.
    try:
        os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError as error:
        raise RuntimeError(
            "Profiler leader is no longer waitable; refusing to signal its ID"
        ) from error
    if os.getpgid(child.pid) != child.pid or os.getsid(child.pid) != child.pid:
        raise RuntimeError("Profiler is outside its owned session; refusing group signal")
    members = []
    for path in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = path.read_text().rsplit(")", 1)[1].split()
            if (
                fields[0] not in ("Z", "X")
                and int(fields[2]) == child.pid
                and int(fields[3]) == child.pid
            ):
                members.append(int(path.parent.name))
        except (FileNotFoundError, ProcessLookupError):
            pass  # An unrelated process may exit during the scan.
    return members


def stop_child(child, grace=5):
    if child is None or child.returncode is not None:
        return
    members = owned_group_members(child)
    for signum in (signal.SIGTERM, signal.SIGKILL):
        if not members:
            break
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signum)
        deadline = time.monotonic() + grace
        while members:
            members = owned_group_members(child)
            remaining = deadline - time.monotonic()
            if not members or remaining <= 0:
                break
            time.sleep(min(0.1, remaining))
    if members:
        raise RuntimeError(f"Owned profiler processes survived SIGKILL: {members}")
    child.wait(timeout=grace)  # Reap only after every live member is gone.


def compact_run(batch, run, report):
    def avg(key, samples):
        return mean([s[key] for s in samples if key in s and s[key] is not None])

    wall, contender = run.get("wallpaper", {}), run.get("contender", {})
    samples = run.get("cpu_timeline", [])
    gpu = run.get("gpu_timeline", [])
    return {
        "batch": batch["name"],
        "name": run["name"],
        "source": batch["source"],
        "requested_fps": batch["fps"],
        "contention": batch["contention"],
        "valid": run["valid"],
        "errors": run["errors"],
        "content_behavior": run.get("content_behavior"),
        "pause_evidence": run.get("pause_evidence"),
        "video_progress": run.get("video_progress"),
        "cpu_evidence": run.get("cpu_evidence"),
        "report": str(report),
        "seconds": run["end"] - run["start"],
        "wallpaper": wall,
        "contender": contender,
        "cpu_mean": run.get("cpu", {}).get("mean", avg("wallpaper_cpu", samples)),
        "cpu": run.get("cpu", {}),
        "compositor_cpu_mean": run.get("cpu_by_role", {})
        .get("compositor", {})
        .get("mean", avg("compositor_cpu", samples)),
        "gpu_mean": avg("gpu_percent", gpu),
        "gpu": run.get("gpu", {}),
        "watts_mean": avg("watts", gpu),
        "rss_mean_mib": avg("rss_mib", samples),
        "gpu_peak_c": max((s.get("temperature_c", 0) for s in gpu), default=None),
        "effective_fps_limit": run.get("initial_telemetry", {}).get("target_fps"),
        "details": {
            k: run[k]
            for k in [
                "initial_telemetry",
                "final_telemetry",
                "guard_failure",
                "resources",
                "background_cpu",
                "pointer",
            ]
            if k in run
        },
    }


def write_summary(folder, manifest, batches):
    runs = []
    report_errors = []
    for batch in batches:
        path = folder / batch["name"] / "report.json"
        if not path.exists():
            continue
        try:
            report = json.loads(path.read_text())
            batch_runs = [
                compact_run(batch, r, path.relative_to(folder).with_suffix(".html"))
                for r in report["runs"]
            ]
            runs.extend(batch_runs)
        except (OSError, ValueError, KeyError, TypeError) as error:
            # A terminated writer can leave a partial report. Preserve the original
            # run/cleanup failure and all complete batches instead of masking it.
            report_errors.append({"path": str(path.relative_to(folder)), "error": str(error)})
    manifest["report_errors"] = report_errors
    data = {"manifest": manifest, "batches": batches, "runs": runs}
    (folder / "summary.json").write_text(json.dumps(data, indent=2))
    payload = json.dumps(data).replace("</", "<\\/")
    html = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WallpaperDB · 4K stress lab</title>
<style>body{font:15px system-ui;background:#151217;color:#eee4ef;max-width:1500px;margin:40px auto;padding:0 24px}h1{font-size:36px}p{color:#c2afc1;line-height:1.6}a{color:#f1a5d0}select{padding:10px;background:#302330;color:white;border:1px solid #684563;border-radius:8px}table{width:100%;border-collapse:collapse}td,th{padding:12px 9px;border-bottom:1px solid #463344;text-align:right;font-size:13px}th:first-child,td:first-child{text-align:left}pre{white-space:pre-wrap}.bad{color:#ff997f}.scroll{overflow:auto}</style>
<h1>4K stress laboratory</h1><p>3840 × 2160 producer canvas on a temporary 360 Hz virtual output. This measures real 4K rendering and compositor feedback, not physical 4K/360 Hz scanout. The synthetic competing workload uses the output, frame rate and black/visible mode recorded below. Black mode keeps the same offscreen work while presenting opaque black to protect the OLED. CPU is percent of one core. NVIDIA load and power include the whole desktop.</p>
<p>Each requested rate is a target. Chromium bitmap capture is capped at 240 fps. WebKit JavaScript callbacks do not establish delivered frames. Inspect frame-time tails and actual output rates together: less work is not necessarily a more efficient implementation.</p>
<label>Batch <select id="filter"><option value="">All</option></select></label><div class="scroll"><table><thead><tr><th>Run / detailed chart</th><th>Requested → limit</th><th>Delivered fps</th><th>Wall p99 ms</th><th>Wall worst ms</th><th>CPU mean %</th><th>CPU p99 %</th><th>GPU mean %</th><th>Contender fps</th><th>Contender p99 ms</th><th>Contender worst ms</th></tr></thead><tbody id="rows"></tbody></table></div><p id="count"></p><details><summary>Recipe, guards and display evidence</summary><pre id="manifest"></pre></details>
<script>const data=PAYLOAD;const fmt=x=>x==null?'—':Number(x).toFixed(2);const filter=document.getElementById('filter');for(const b of data.batches){const o=document.createElement('option');o.value=b.name;o.textContent=b.name;filter.append(o)}function draw(){const rows=data.runs.filter(r=>!filter.value||r.batch===filter.value);document.getElementById('rows').innerHTML=rows.map(r=>{const w=r.wallpaper.presentation_ms||{},c=r.contender.presentation_ms||{};return `<tr class="${r.valid?'':'bad'}"><td><a href="${r.report}">${r.batch} / ${r.name}</a>${r.valid?'':' · INVALID: '+r.errors.join('; ')}</td><td>${r.requested_fps}${r.effective_fps_limit != null && r.effective_fps_limit !== r.requested_fps ? ' → '+r.effective_fps_limit : ''}</td><td>${fmt(r.wallpaper.presented_hz)}</td><td>${fmt(w.p99)}</td><td>${fmt(w.max)}</td><td>${fmt(r.cpu_mean)}</td><td>${fmt(r.cpu.p99)}</td><td>${fmt(r.gpu_mean)}</td><td>${fmt(r.contender.presented_hz)}</td><td>${fmt(c.p99)}</td><td>${fmt(c.max)}</td></tr>`}).join('');document.getElementById('count').textContent=rows.length+' runs shown; '+rows.filter(r=>r.valid).length+' valid.'}filter.onchange=draw;document.getElementById('manifest').textContent=JSON.stringify(data.manifest,null,2);draw();</script>""".replace(
        "PAYLOAD", payload
    )
    (folder / "index.html").write_text(html)


@termination_cleanup()
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=["screen", "sweep", "sustained", "media", "files", "soak", "paused", "all"],
        default="screen",
    )
    parser.add_argument(
        "--list", action="store_true", help="Print recipe without starting any renderer"
    )
    parser.add_argument("--seconds", type=float)
    parser.add_argument("--repeats", type=int)
    parser.add_argument("--only", help="Comma-separated batch names from --list")
    parser.add_argument("--engines", help="Comma-separated renderer names; idle is a control")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--output-name", default="WDB-STRESS")
    parser.add_argument("--contender-output", default="DP-2")
    parser.add_argument("--contender-fps", type=int, default=144)
    parser.add_argument("--contender-black", action="store_true")
    parser.add_argument(
        "--no-contender",
        action="store_true",
        help="Disable synthetic contention for every selected batch; defaults retain the recipe",
    )
    parser.add_argument("--passes", type=int, default=600)
    parser.add_argument(
        "--warmup",
        type=float,
        help="Override warmup: default 35s for retained images, 8s otherwise",
    )
    parser.add_argument(
        "--sample-hz",
        type=float,
        default=20,
        help="CPU sample rate; 0 disables CPU sampling and periodic status polls while retaining frame CSV, GPU timing and resource guards",
    )
    parser.add_argument("--audio", action="store_true")
    parser.add_argument("--cooldown", type=float, default=120)
    args = parser.parse_args()
    if not math.isfinite(args.sample_hz) or not 0 <= args.sample_hz <= 100:
        parser.error("CPU/status sample rate must be finite and between 0 and 100 Hz")
    if not 1 <= args.contender_fps <= 360:
        parser.error("Contender rate must be between 1 and 360 fps")
    if (
        not 1 <= args.passes <= 1200
        or (args.warmup is not None and not 2 <= args.warmup <= 60)
        or not 0 <= args.cooldown <= 120
    ):
        parser.error("Passes must be 1–1200, warmup 2–60s, and cooldown 0–120s")
    batches = recipe(args.stage)
    if args.only:
        selected = set(args.only.split(","))
        batches = [r for r in batches if r["name"] in selected]
        if selected != {r["name"] for r in batches}:
            parser.error("Unknown batch in --only")
    for batch in batches:
        batch["warmup"] = (
            args.warmup if args.warmup is not None else (35 if batch["name"] == "file-image" else 8)
        )
        if args.seconds is not None:
            batch["seconds"] = args.seconds
        if args.repeats is not None:
            batch["repeats"] = args.repeats
        if args.engines:
            batch["engines"] = args.engines.split(",")
        if args.no_contender:
            batch["contention"] = False
        if (
            not set(batch["engines"]) <= SUPPORTED_CASES
            or not math.isfinite(batch["seconds"])
            or not 1 <= batch["seconds"] <= 600
            or not 1 <= batch["repeats"] <= 5
        ):
            parser.error("Invalid engine, duration, or repeat count")
    if args.list:
        print(json.dumps(batches, indent=2))
        return
    folder = (args.output_dir or ROOT / "verification" / f"stress-{int(time.time())}").resolve()
    folder.mkdir(parents=True, exist_ok=False)
    manifest = {
        "arguments": vars(args) | {"output_dir": str(folder)},
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "measurement": f"Virtual 4K producer/presentation; {args.contender_output} contender at {args.contender_fps} fps, black output={args.contender_black}. No 4K physical monitor is installed.",
        "guards": "profile.py defaults: GPU 82°C; CPU 96°C sustained 3s (95°C boost target is normal for this 7950X); free VRAM 1024 MiB; MemAvailable 8192 MiB; bounded cooldown and subprocess duration.",
        "sampling": f"CPU sampler and periodic status polls: {args.sample_hz:g} Hz CPU target; zero disables both. Frame CSV, GPU timing and resource guards remain enabled.",
        "contention_override": (
            "disabled by --no-contender" if args.no_contender else "recipe defaults"
        ),
        "complete": False,
    }
    child = None
    try:
        with saved_assignments() as original:
            (folder / "original.json").write_text(json.dumps(original, indent=2))
            outputs = sorted({o for g in original["groups"] for o in g["outputs"]})
            if outputs:
                api("clear", outputs=outputs)
            with virtual_output(args.output_name, 360) as monitor:
                manifest["virtual_monitor"] = monitor
                for batch in batches:
                    print("STRESS " + json.dumps(batch), flush=True)
                    command = [
                        sys.executable,
                        str(ROOT / "scripts/profile.py"),
                        "--source",
                        batch["source"],
                        "--wallpaper-output",
                        args.output_name,
                        "--wallpaper-fps",
                        str(batch["fps"]),
                        "--seconds",
                        str(batch["seconds"]),
                        "--repeats",
                        str(batch["repeats"]),
                        "--cases",
                        ",".join(batch["engines"]),
                        "--warmup",
                        str(batch["warmup"]),
                        "--contender-output",
                        args.contender_output,
                        "--contender-fps",
                        str(args.contender_fps),
                        "--passes",
                        str(args.passes),
                        "--sample-hz",
                        str(args.sample_hz),
                        "--cooldown",
                        str(args.cooldown),
                        "--output-dir",
                        str(folder / batch["name"]),
                    ]
                    if not batch["contention"]:
                        command.append("--no-contender")
                    if args.contender_black:
                        command.append("--contender-black")
                    if args.audio:
                        command.append("--audio")
                    watchdog = (
                        len(batch["engines"])
                        * batch["repeats"]
                        * (batch["seconds"] + batch["warmup"] + args.cooldown + 40)
                        + 60
                    )
                    try:
                        with deferred_spawn_signals():
                            child = subprocess.Popen(command, env=ENV, start_new_session=True)
                        code = wait_child(child, timeout=watchdog)
                    finally:
                        # Stop the profile before output cleanup or assignment restoration:
                        # an interrupted child must not race the restored desktop.
                        stop_child(child)
                        child = None
                    write_summary(folder, manifest, batches)
                    if code:
                        raise RuntimeError(
                            f"Batch {batch['name']} failed or hit a safety guard; stopping escalation (exit {code})"
                        )
        manifest["complete"] = True
    except (Exception, KeyboardInterrupt) as error:
        manifest["error"] = str(error) or type(error).__name__
        raise
    finally:
        stop_child(child)
        manifest["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_summary(folder, manifest, batches)
        print(folder / "index.html", flush=True)


if __name__ == "__main__":
    main()
