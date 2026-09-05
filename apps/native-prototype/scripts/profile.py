"""Sustained paired experiments with frame-level presentation and a fixed GPU contender.

The contender is a synthetic graphics workload, not a game benchmark. Missing
counters stay null. NVML utilization has a coarser averaging window than polling.
"""

import argparse, csv, ctypes, hashlib, json, math, os, shutil, socket, statistics, struct, subprocess, threading, time
from pathlib import Path
from lab_common import ROOT, RUNTIME, CONTROL, ENV, api, assign, ready, hypr, saved_assignments


def percentile(xs, p):
    if not xs:
        return None
    a = sorted(xs)
    x = (len(a) - 1) * p
    lo = int(x)
    hi = min(lo + 1, len(a) - 1)
    return a[lo] + (a[hi] - a[lo]) * (x - lo)


def distribution(xs, period=None, duration=False):
    result = {
        "samples": len(xs),
        "p50": percentile(xs, 0.5),
        "p95": percentile(xs, 0.95),
        "p99": percentile(xs, 0.99),
        "p999": percentile(xs, 0.999),
        "max": max(xs) if xs else None,
    }
    if period:
        result.update(
            {
                f"over_{factor:g}x": sum(x > period * factor + 0.1 for x in xs)
                for factor in [1.5, 2, 3]
            }
        )
    if duration or period:
        result["over_50ms"] = sum(x > 50 for x in xs)
    return result


class GPU:
    """NVML in-process avoids spawning nvidia-smi on every sample."""

    class Util(ctypes.Structure):
        _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]

    def __init__(self):
        try:
            self.lib = ctypes.CDLL("libnvidia-ml.so.1")
            self.handle = ctypes.c_void_p()
            if (
                self.lib.nvmlInit_v2() != 0
                or self.lib.nvmlDeviceGetHandleByIndex_v2(0, ctypes.byref(self.handle)) != 0
            ):
                raise RuntimeError("NVML unavailable")
        except Exception:
            self.lib = None

    def read(self):
        if not self.lib:
            return {}
        u = self.Util()
        power = ctypes.c_uint()
        clock = ctypes.c_uint()
        temp = ctypes.c_uint()
        decoder = ctypes.c_uint()
        period = ctypes.c_uint()
        r = {}
        if self.lib.nvmlDeviceGetUtilizationRates(self.handle, ctypes.byref(u)) == 0:
            r.update(gpu_percent=u.gpu, memory_percent=u.memory)
        if self.lib.nvmlDeviceGetPowerUsage(self.handle, ctypes.byref(power)) == 0:
            r["watts"] = power.value / 1000
        if self.lib.nvmlDeviceGetClockInfo(self.handle, 0, ctypes.byref(clock)) == 0:
            r["graphics_mhz"] = clock.value
        if self.lib.nvmlDeviceGetTemperature(self.handle, 0, ctypes.byref(temp)) == 0:
            r["temperature_c"] = temp.value
        if (
            self.lib.nvmlDeviceGetDecoderUtilization(
                self.handle, ctypes.byref(decoder), ctypes.byref(period)
            )
            == 0
        ):
            r.update(decoder_percent=decoder.value, decoder_sample_us=period.value)
        return r


def processes():
    found = {}
    for p in Path("/proc").glob("[0-9]*/stat"):
        try:
            text = p.read_text()
            end = text.rfind(")")
            parts = text[end + 2 :].split()
            pid = int(p.parent.name)
            runtime = 0
            found[pid] = {
                "ppid": int(parts[1]),
                "name": text[text.find("(") + 1 : end],
                "runtime": runtime,
                "rss": int(parts[21]) * os.sysconf("SC_PAGE_SIZE"),
            }
        except (OSError, ValueError, IndexError):
            pass
    return found


def family(table, roots):
    members = set(roots)
    for _ in range(10):
        more = {p for p, v in table.items() if v["ppid"] in members}
        if more <= members:
            break
        members |= more
    return members


class Sampler:
    def __init__(self, folder, roots, period=0.05):
        self.folder = folder
        self.roots = roots
        self.period = period
        self.done = threading.Event()
        self.rows = []
        self.gpu_rows = []
        self.lateness = []
        self.prepared = threading.Event()
        self.begin = threading.Event()
        self.thread = threading.Thread(target=self.run)
        self.thread.start()

    def run(self):
        gpu = GPU() if self.period > 0 else None
        before = {}
        table = processes()
        wallpaper_members = family(table, [self.roots[0]])
        contender_members = family(table, [self.roots[1]])
        members = wallpaper_members | contender_members | set(self.roots[2:])
        self.topology = {pid: table.get(pid, {}) for pid in members}
        clocks = {}
        libc = ctypes.CDLL(None)
        for pid in members:
            cid = ctypes.c_int()
            if pid > 0 and libc.clock_getcpuclockid(pid, ctypes.byref(cid)) == 0:
                clocks[pid] = cid.value
        self.prepared.set()
        self.begin.wait()
        if self.period <= 0:
            return
        last = time.monotonic()
        next_due = last
        gpu_due = 0
        with (self.folder / "process.csv").open("w", buffering=65536) as f, (
            self.folder / "gpu.csv"
        ).open("w", buffering=65536) as gf:
            writer = csv.writer(f)
            writer.writerow(["monotonic", "pid", "name", "role", "cpu_percent_one_core", "rss_mib"])
            gw = csv.writer(gf)
            gw.writerow(
                [
                    "monotonic",
                    "gpu_percent",
                    "memory_percent",
                    "watts",
                    "graphics_mhz",
                    "temperature_c",
                    "decoder_percent",
                    "decoder_sample_us",
                ]
            )
            while not self.done.is_set():
                now = time.monotonic()
                self.lateness.append(max(0, now - next_due) * 1000)
                totals = {
                    "monotonic": now,
                    "wallpaper_cpu": 0.0,
                    "contender_cpu": 0.0,
                    "compositor_cpu": 0.0,
                    "profiler_cpu": 0.0,
                    "rss_mib": 0.0,
                }
                for pid in members:
                    try:
                        p = Path(f"/proc/{pid}")
                        ns = time.clock_gettime_ns(clocks[pid])
                        stat = p.joinpath("stat").read_text().rsplit(")", 1)[1].split()
                        rss = int(stat[21]) * os.sysconf("SC_PAGE_SIZE") / 1048576
                    except (OSError, ValueError, IndexError, KeyError):
                        continue
                    old = before.get(pid, ns)
                    cpu = max(0, ns - old) / (now - last) / 1e7
                    before[pid] = ns
                    name = table.get(pid, {}).get("name", "unknown")
                    role = "wallpaper"
                    if pid in contender_members:
                        role = "contender"
                    elif name == "Hyprland":
                        role = "compositor"
                    elif pid == os.getpid():
                        role = "profiler"
                    writer.writerow([now, pid, name, role, cpu, rss])
                    totals[role + "_cpu"] += cpu
                    if role == "wallpaper":
                        totals["rss_mib"] += rss
                self.rows.append(totals)
                if now >= gpu_due:
                    values = gpu.read()
                    values["monotonic"] = now
                    self.gpu_rows.append(values)
                    gw.writerow(
                        [now]
                        + [
                            values.get(k)
                            for k in [
                                "gpu_percent",
                                "memory_percent",
                                "watts",
                                "graphics_mhz",
                                "temperature_c",
                                "decoder_percent",
                                "decoder_sample_us",
                            ]
                        ]
                    )
                    gpu_due = now + 0.2
                last = now
                next_due += self.period
                if next_due < now:
                    next_due = now + self.period
                self.done.wait(max(0, next_due - time.monotonic()))

    def stop(self):
        self.done.set()
        self.thread.join()


def contender(folder, passes, fps, record=True):
    config = {
        "experiment": "gpu",
        "width": 1280,
        "height": 720,
        "fps": fps,
        "hdr": False,
        "stress": passes,
        "script": str(ROOT / "examples/prism/scene.lua"),
        "outputs": [{"name": "DP-2", "width": 1280, "height": 720}],
        "frames": str(folder / "contender-frames.csv") if record else "",
    }
    path = folder / "contender.json"
    path.write_text(json.dumps(config, indent=2))
    log = (folder / "contender.log").open("w")
    child = subprocess.Popen(
        [str(ROOT / "lab/build/presenter"), str(path)],
        env=ENV,
        stdin=subprocess.PIPE,
        stdout=log,
        stderr=log,
    )
    return child, log


def frame_summary(path, start, end, period):
    if not path.exists():
        return {"available": False}, []
    stamps = {}
    sequences = {}
    sequence_gaps = {}
    intervals = []
    gpu = []
    cpu = []
    discarded = 0
    flags = {}
    timeline = []
    with path.open() as f:
        for row in csv.DictReader(f):
            try:
                t = float(row["monotonic"])
                a = float(row["value"])
                event = row["event"]
                if event == "presented":
                    t = a
                if not start <= t <= end:
                    continue
                if event == "presented":
                    output = row["output"]
                    seq = int(row["sequence"])
                    if output in sequences:
                        gap = seq - sequences[output]
                        sequence_gaps[str(gap)] = sequence_gaps.get(str(gap), 0) + 1
                    sequences[output] = seq
                    flag = row["flags"]
                    flags[flag] = flags.get(flag, 0) + 1
                    if output in stamps:
                        interval = (a - stamps[output]) * 1000
                        intervals.append(interval)
                        timeline.append([t - start, interval])
                    stamps[output] = a
                elif event == "gpu":
                    gpu.append(a)
                elif event == "cpu":
                    cpu.append(a)
                elif event == "discarded":
                    discarded += 1
            except (ValueError, KeyError):
                continue
    return {
        "available": True,
        "last_presentation": max(stamps.values(), default=None),
        "sequence_gaps": sequence_gaps,
        "presented_hz": len(intervals) / (end - start),
        "presentation_ms": distribution(intervals, period),
        "gpu_command_ms": distribution(gpu, duration=True),
        "cpu_submit_ms": distribution(cpu, duration=True),
        "discarded": discarded,
        "feedback_flags": flags,
    }, timeline


def write_report(folder, manifest, runs):
    data = {"manifest": manifest, "runs": runs}
    (folder / "report.json").write_text(json.dumps(data, indent=2))
    payload = json.dumps(data).replace("</", "<\\/")
    html = """<!doctype html><meta charset="utf-8"><title>WallpaperDB · Frame-time laboratory</title><style>
body{background:#151217;color:#eee4ef;font:15px system-ui;margin:40px auto;max-width:1250px;padding:0 24px}h1{font-size:36px}p{color:#bbadbd;line-height:1.6}select,input{background:#302330;color:white;border:1px solid #684563;padding:9px;border-radius:8px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #463344;font-size:13px}svg{width:100%;height:300px;background:#201924;border-radius:14px}.accent{color:#efa8d4}pre{white-space:pre-wrap}label{margin-right:20px}</style>
<h1>Frame-time laboratory</h1><p>Paired synthetic GPU contention on DP-2. Presentation timing measures compositor feedback; this is not a benchmark of any particular game. CPU samples use nanosecond process clocks at the selected rate; NVIDIA utilization averages a coarser native window. Startup warmup is excluded.</p>
<div id="summary"></div><label>Run <select id="run"></select></label><label>From <input id="from" type="number" value="0" min="0" step="5"> seconds</label><label>Window <input id="window" type="number" value="30" min="1"> seconds</label><p class="accent">Contender presentation intervals (ms). Dashed line: twice the intended frame period.</p><svg id="chart" viewBox="0 0 1200 300"></svg><p>Aligned resource samples: pink = wallpaper CPU, blue = compositor CPU, gray = profiler CPU (percent of one core); green = total NVIDIA utilization (percent, coarsely averaged). Correlation alone does not establish cause.</p><svg id="resources" viewBox="0 0 1200 300"></svg><p id="detail"></p><details><summary>Method, hardware, and measurement limits</summary><pre id="manifest"></pre></details><script>const data=PAYLOAD;
const n=x=>x==null?'unavailable':x.toFixed(2);document.querySelector('#manifest').textContent=JSON.stringify(data.manifest,null,2);
document.querySelector('#summary').innerHTML='<table><tr><th>Run</th><th>Median ms</th><th>p99 ms</th><th>p99.9 ms</th><th>Worst ms</th><th>Over 2× budget</th><th>Wallpaper CPU p99</th></tr>'+data.runs.map(r=>{const p=r.contender.presentation_ms||{};return `<tr><td>${r.name}${r.valid?'':' (INVALID)'}</td><td>${n(p.p50)}</td><td>${n(p.p99)}</td><td>${n(p.p999)}</td><td>${n(p.max)}</td><td>${p.over_2x??'n/a'}</td><td>${n(r.cpu.p99)}%</td></tr>`}).join('')+'</table>';
const select=document.querySelector('#run');select.innerHTML=data.runs.map((r,i)=>`<option value="${i}">${r.name}</option>`).join('');
function draw(){const r=data.runs[+select.value],a=+document.querySelector('#from').value,w=+document.querySelector('#window').value;const points=r.timeline.filter(p=>p[0]>=a&&p[0]<=a+w);const max=Math.max(25,...points.map(p=>p[1]));const y=v=>280-v/max*255;document.querySelector('#chart').innerHTML=`<text x="15" y="20" fill="#bbadbd">${max.toFixed(1)} ms</text><path d="M40 ${y(data.manifest.contender_period_ms*2)}H1180" stroke="#86617d" stroke-dasharray="8 5"/><polyline points="${points.map(p=>`${40+(p[0]-a)/w*1140},${y(p[1])}`).join(' ')}" fill="none" stroke="#efa8d4" stroke-width="1.4"/>`;const cpu=r.cpu_timeline.filter(p=>p.monotonic-r.start>=a&&p.monotonic-r.start<=a+w),gpu=r.gpu_timeline.filter(p=>p.monotonic-r.start>=a&&p.monotonic-r.start<=a+w);const cap=Math.max(100,...cpu.map(p=>Math.max(p.wallpaper_cpu,p.compositor_cpu,p.profiler_cpu)));const line=(rows,key,color)=>`<polyline points="${rows.map(p=>`${40+(p.monotonic-r.start-a)/w*1140},${280-(p[key]||0)/cap*255}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`;document.querySelector('#resources').innerHTML=`<text x="15" y="20" fill="#bbadbd">${cap.toFixed(0)}%</text>`+line(cpu,'wallpaper_cpu','#efa8d4')+line(cpu,'compositor_cpu','#89b4fa')+line(cpu,'profiler_cpu','#888888')+line(gpu,'gpu_percent','#a6e3a1');document.querySelector('#detail').textContent=JSON.stringify({case:r.name,cpu:r.cpu,gpu:r.gpu,sampling_lateness_ms:r.sampling_lateness_ms},null,2);}
for(const id of ['run','from','window'])document.getElementById(id).oninput=draw;draw();</script>""".replace(
        "PAYLOAD", payload
    )
    (folder / "report.html").write_text(html)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--seconds", type=float, default=120)
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--warmup", type=float, default=10)
    p.add_argument("--cases", default="idle,baseline,gpu,chromium")
    p.add_argument("--passes", type=int, default=400)
    p.add_argument("--contender-fps", type=int, default=144)
    p.add_argument("--wallpaper-output", default="DP-2")
    p.add_argument("--source", default="prism")
    p.add_argument("--audio", action="store_true")
    p.add_argument("--no-contender", action="store_true")
    p.add_argument("--sample-hz", type=float, default=20)
    a = p.parse_args()
    if a.seconds < 1 or a.repeats < 1 or a.warmup < 2 or a.sample_hz < 0 or a.contender_fps < 1:
        raise SystemExit("Invalid measurement duration or sampling rate")
    folder = ROOT / "verification" / f"profile-{int(time.time())}"
    folder.mkdir(parents=True)
    runs = []
    table = processes()
    hypr_pids = [pid for pid, v in table.items() if v["name"] == "Hyprland"]
    manifest = {
        "arguments": vars(a),
        "monitors": hypr("-j", "monitors"),
        "contender_period_ms": 1000 / a.contender_fps,
        "scanout": "DP-2 is AMD; presenter and contender must report NVIDIA RTX4080. This includes cross-GPU presentation.",
        "gpu_utilization_limit": "NVML integrates approximately 1/6–1 second; 5Hz polling is not millisecond GPU attribution.",
        "cpu_counter": f"Linux process CPU clocks, {a.sample_hz:g}Hz; includes exited threads. Process membership frozen after warmup to avoid periodic /proc scans. No runqueue delay attribution.",
        "feedback_clock": "CLOCK_MONOTONIC required; actual presentation timestamps used for intervals and timeline. Callback receipt timestamps retained separately in raw CSV.",
        "source_sha256": hashlib.sha256(
            b"".join(
                p.read_bytes()
                for p in sorted((ROOT / "examples" / a.source).rglob("*"))
                if p.is_file()
            )
            if (ROOT / "examples" / a.source).is_dir()
            else (ROOT / "examples" / a.source).read_bytes()
        ).hexdigest(),
        "binary_sha256": hashlib.sha256((ROOT / "lab/build/presenter").read_bytes()).hexdigest(),
        "producer_sha256": hashlib.sha256((ROOT / "lab/electron.cjs").read_bytes()).hexdigest(),
        "daemon_sha256": hashlib.sha256(
            (ROOT / "target/release/wallpaperdb-native").read_bytes()
        ).hexdigest(),
        "baseline_processes": [
            v | {"pid": pid}
            for pid, v in table.items()
            if v["name"] in ["Hyprland", "swww-daemon", "mpvpaper"]
        ],
    }
    with saved_assignments() as original:
        library_windows = [w for w in hypr("-j", "clients") if w["class"] == "wallpaperdb-native"]
        manifest["closed_library_for_measurement"] = bool(library_windows)
        for window in library_windows:
            hypr("dispatch", "closewindow", "address:" + window["address"])
        owned = sorted({o for g in original["groups"] for o in g["outputs"]})
        manifest["original_assignments"] = original["groups"]
        if owned:
            api("clear", outputs=owned)
        with socket.socket(socket.AF_UNIX) as s:
            s.connect(str(CONTROL))
            daemon = struct.unpack("3i", s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[0]
        for repeat in range(a.repeats):
            cases = a.cases.split(",")
            cases = cases if repeat % 2 == 0 else list(reversed(cases))
            for case in cases:
                name = f"{repeat+1}-{case}"
                out = folder / name
                out.mkdir()
                api("clear", outputs=[a.wallpaper_output])
                stats = {}
                if case != "idle":
                    engine = (
                        case.removesuffix("-paused")
                        if case.endswith("-paused")
                        else "gpu" if case == "paused" else case
                    )
                    assign(
                        a.source,
                        engine,
                        [a.wallpaper_output],
                        audio=a.audio,
                        keep_playing=True,
                        trace=True,
                    )
                    stats = ready(a.wallpaper_output)
                    if engine.startswith("chromium") and stats.get("probe_max_scrgb", 0) <= 0:
                        raise RuntimeError(
                            "Known nonblack scene produced black pixels; invalid performance comparison"
                        )
                    if stats.get("presentation_clock", 1) != 1:
                        raise RuntimeError("Unsupported presentation clock")
                    if case == "paused" or case.endswith("-paused"):
                        api("pause", outputs=[a.wallpaper_output], paused=True)
                child = log = None
                sampler = None
                try:
                    if not a.no_contender:
                        child, log = contender(out, a.passes, a.contender_fps)
                    time.sleep(a.warmup)
                    if child and child.poll() is not None:
                        raise RuntimeError("Contender exited; inspect its log")
                    if child and (
                        "NVIDIA" not in (out / "contender.log").read_text()
                        or '"presentation_clock":1' not in (out / "contender.log").read_text()
                    ):
                        raise RuntimeError("Contender did not report NVIDIA rendering")
                    sampler = Sampler(
                        out,
                        [daemon, child.pid if child else -1, *hypr_pids, os.getpid()],
                        1 / a.sample_hz if a.sample_hz else 0,
                    )
                    sampler.prepared.wait(10)
                    start = time.monotonic()
                    sampler.begin.set()
                    telemetry = []
                    print(f"PROFILE {name}: {a.seconds}s after {a.warmup}s warmup", flush=True)
                    while time.monotonic() - start < a.seconds:
                        if a.sample_hz:
                            status = api("status")
                            telemetry.append(
                                {"monotonic": time.monotonic(), "surfaces": status["surfaces"]}
                            )
                        time.sleep(min(1, max(0, a.seconds - (time.monotonic() - start))))
                    end = time.monotonic()
                    run_errors = []
                    if child and child.poll() is not None:
                        run_errors.append("Contender exited during measurement")
                    final_status = api("status")
                    if case != "idle":
                        final_stats = next(
                            (
                                s["telemetry"]
                                for s in final_status["surfaces"]
                                if s["output"] == a.wallpaper_output
                            ),
                            {},
                        )
                        if (
                            final_stats.get("state") not in (None, "ready")
                            or final_stats.get("error")
                            or final_stats.get("browser", {}).get("error")
                        ):
                            run_errors.append("Wallpaper reported an error at end of run")
                        if not case.endswith("paused") and final_stats.get(
                            "frames", 0
                        ) <= stats.get("frames", 0):
                            run_errors.append("Animated wallpaper stopped producing frames")
                finally:
                    if sampler:
                        sampler.stop()
                    if child:
                        child.terminate()
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait()
                    if log:
                        log.close()
                after_table = processes()
                after_members = family(after_table, [daemon])
                before_members = family(sampler.topology, [daemon])
                new_processes = sorted(after_members - before_members)
                api("clear", outputs=[a.wallpaper_output])  # flush owned player's frame log
                (out / "telemetry.json").write_text(json.dumps(telemetry))
                frame_file = stats.get("frames_file")
                wall = {}
                if frame_file and Path(frame_file).exists():
                    shutil.copyfile(frame_file, out / "wallpaper-frames.csv")
                    wall, _ = frame_summary(out / "wallpaper-frames.csv", start, end, 1000 / 30)
                cont, timeline = frame_summary(
                    out / "contender-frames.csv", start, end, 1000 / a.contender_fps
                )
                if child and (
                    not cont.get("last_presentation") or end - cont["last_presentation"] > 0.5
                ):
                    run_errors.append("Missing recent contender presentation")
                animated = (
                    case != "idle"
                    and not case.endswith("paused")
                    and (ROOT / "examples" / a.source).is_dir()
                )
                if (
                    animated
                    and frame_file
                    and (not wall.get("last_presentation") or end - wall["last_presentation"] > 0.5)
                ):
                    run_errors.append("Missing recent wallpaper presentation")
                if animated and telemetry:
                    tail = [entry for entry in telemetry if end - entry["monotonic"] < 5]
                    counts = [
                        surface["telemetry"].get("frames", 0)
                        for entry in tail
                        for surface in entry["surfaces"]
                        if surface["output"] == a.wallpaper_output
                    ]
                    if len(counts) > 2 and max(counts) == min(counts):
                        run_errors.append("Wallpaper froze during the last five seconds")
                if new_processes:
                    run_errors.append("Process membership changed")
                row = {
                    "valid": not run_errors,
                    "errors": run_errors,
                    "valid_process_membership": not new_processes,
                    "unexpected_processes": new_processes,
                    "name": name,
                    "start": start,
                    "end": end,
                    "contender": cont,
                    "wallpaper": wall,
                    "cpu": distribution([v["wallpaper_cpu"] for v in sampler.rows]),
                    "gpu": distribution(
                        [v["gpu_percent"] for v in sampler.gpu_rows if "gpu_percent" in v]
                    ),
                    "process_topology": sampler.topology,
                    "sampling_lateness_ms": distribution(sampler.lateness, duration=True),
                    "timeline": timeline,
                    "cpu_timeline": sampler.rows,
                    "gpu_timeline": sampler.gpu_rows,
                }
                runs.append(row)
                write_report(folder, manifest, runs)
                print(json.dumps({"run": name, "contender": cont, "cpu": row["cpu"]}), flush=True)
    print(folder / "report.html", flush=True)


if __name__ == "__main__":
    main()
