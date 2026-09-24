"""Reproduce kernel resource summaries; no benchmark service access."""
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def stamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()

def counters(value):
    return {line.split()[0]: int(line.split()[1]) for line in value.splitlines()}

def read_window(name, artifact_name, observer):
    artifact_path = ROOT / artifact_name
    if not artifact_path.exists():
        return {"phase": name, "pending": True}
    artifact_bytes = artifact_path.read_bytes()
    artifact = json.loads(artifact_bytes)
    end = artifact.get("finishedAt") or artifact.get("interruptions", [{}])[-1].get("at")
    if not end:
        return {"phase": name, "pending": True}
    first, last = stamp(artifact["startedAt"]), stamp(end)
    selected = []
    resource_file = ROOT / observer / "resources.jsonl"
    with resource_file.open() as stream:
        for line in stream:
            row = json.loads(line)
            if first <= stamp(row["at"]) <= last:
                selected.append(row)
    if len(selected) < 2:
        raise ValueError("Insufficient resource observations for " + name)
    initial, final = selected[0], selected[-1]
    cpu0, cpu1 = [counters(row["cgroup"]["cpu.stat"]) for row in (initial, final)]
    event0, event1 = [counters(row["cgroup"]["memory.events"]) for row in (initial, final)]
    peak = max(selected, key=lambda row: int(row["cgroup"]["memory.current"]))
    mem_at_peak = counters(peak["cgroup"]["memory.stat"])
    host_available = [int(next(line.split()[1] for line in row["hostMeminfo"].splitlines() if line.startswith("MemAvailable:"))) * 1024 for row in selected]
    return {"phase": name, "artifact": str(artifact_path), "artifactSha256": hashlib.sha256(artifact_bytes).hexdigest(),
        "observer": observer, "requestedStart": artifact["startedAt"], "requestedEnd": end,
        "observedStart": initial["at"], "observedEnd": final["at"], "samples": len(selected),
        "observedSeconds": stamp(final["at"]) - stamp(initial["at"]),
        "cpuDelta": {key: cpu1[key] - cpu0[key] for key in cpu0},
        "memoryEventDelta": {key: event1[key] - event0[key] for key in event0},
        "peakObservedContainerBytes": int(peak["cgroup"]["memory.current"]), "peakObservedAt": peak["at"],
        "anonAtContainerPeakBytes": mem_at_peak["anon"], "fileAtContainerPeakBytes": mem_at_peak["file"],
        "peakObservedSwapBytes": max(int(row["cgroup"]["memory.swap.current"]) for row in selected),
        "minimumHostAvailableBytes": min(host_available), "cpuMax": peak["cgroup"]["cpu.max"],
        "memoryMax": peak["cgroup"]["memory.max"]}

windows = [("projection", "projection/scale.json", "resources"),
    ("arrival", "arrival/arrival.json", "resources"),
    ("full256", "full256/scale.json", "resources-full"),
    ("full1024-indexing-and-10k", "full1024/scale.json", "resources-full"),
    ("full1024-completion", "full1024-completion/completion.json", "resources-full"),
    ("maintenance", "maintenance/maintenance.json", "resources-full"),
    ("maintained", "maintained/maintained.json", "resources-full")]
result = {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "limitations": ["Whole cgroup including other retained indexes, charged cache and merges; not per-index memory.",
        "One-second samples approximate window edges and may miss instantaneous peaks.",
        "Memory max events indicate reclaim at the limit, not necessarily OOM; explicit OOM counters remain separate.",
        "processMemory describes the container init wrapper and is deliberately not used as JVM RSS."],
    "windows": [read_window(*window) for window in windows]}
(ROOT / "resource-summary.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
