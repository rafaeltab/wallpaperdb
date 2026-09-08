"""Incremental gameplay evidence. Live plots stay bounded; exact values use eight bytes/frame."""

from array import array
from collections import Counter
import csv
import math
import time
import os
import signal
import subprocess


class WakeLease:
    """Finite, verified OS leases renewed with overlap for manual sessions."""

    def __init__(self, directory, marker, env):
        self.directory, self.marker, self.env = directory, marker, env
        self.child = None
        self.expires = 0
        self.check()

    @staticmethod
    def release(child):
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=3)

    def check(self):
        if self.child and self.child.poll() is not None:
            raise RuntimeError("Benchmark wake inhibitor exited unexpectedly")
        if time.monotonic() < self.expires - 300:
            return
        with (self.directory / "inhibitor.log").open("a") as log:
            candidate = subprocess.Popen(
                [
                    "systemd-inhibit",
                    "--what=sleep:idle",
                    "--mode=block",
                    "--who=WallpaperDB Bench",
                    f"--why={self.marker}",
                    "sleep",
                    "900",
                ],
                env=self.env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                listed = subprocess.run(
                    ["systemd-inhibit", "--list", "--no-pager"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if candidate.poll() is not None:
                    break
                if any(
                    self.marker in line and str(candidate.pid) in line.split()
                    for line in listed.stdout.splitlines()
                ):
                    old, self.child = self.child, candidate
                    self.expires = time.monotonic() + 900
                    self.release(old)
                    return
                time.sleep(0.1)
            raise RuntimeError("Could not verify the temporary wake inhibitor")
        except Exception:
            self.release(candidate)
            raise

    def close(self):
        self.release(self.child)


class FrameStats:
    def __init__(self):
        self.values = array("d")
        self.histogram = Counter()
        self.total_ms = 0.0
        self.buckets = []
        self.width = 0.1
        self.thresholds = {limit: 0 for limit in (1000 / 120, 1000 / 60, 33.333333, 50, 100)}
        self.clusters = self.current_cluster = self.longest_cluster = 0

    def append(self, elapsed, frame):
        if not math.isfinite(elapsed) or not math.isfinite(frame) or elapsed < 0 or frame <= 0:
            raise ValueError("Invalid individual gameplay frame")
        self.values.append(frame)
        self.histogram[max(1, round(frame * 1000))] += 1
        self.total_ms += frame
        for threshold in self.thresholds:
            self.thresholds[threshold] += frame > threshold
        if frame > 1000 / 60:
            self.clusters += self.current_cluster == 0
            self.current_cluster += 1
            self.longest_cluster = max(self.longest_cluster, self.current_cluster)
        else:
            self.current_cluster = 0
        index = int(elapsed / self.width)
        if not self.buckets or self.buckets[-1]["index"] != index:
            self.buckets.append(
                dict(
                    index=index,
                    time_s=elapsed,
                    end_s=elapsed,
                    min_ms=frame,
                    max_ms=frame,
                    total_ms=frame,
                    count=1,
                )
            )
        else:
            bucket = self.buckets[-1]
            bucket.update(
                end_s=elapsed,
                min_ms=min(bucket["min_ms"], frame),
                max_ms=max(bucket["max_ms"], frame),
                total_ms=bucket["total_ms"] + frame,
                count=bucket["count"] + 1,
            )
        if len(self.buckets) > 1200:
            self.width *= 2
            merged = []
            for bucket in self.buckets:
                index = int(bucket["time_s"] / self.width)
                if merged and merged[-1]["index"] == index:
                    before = merged[-1]
                    before.update(
                        end_s=bucket["end_s"],
                        min_ms=min(before["min_ms"], bucket["min_ms"]),
                        max_ms=max(before["max_ms"], bucket["max_ms"]),
                        total_ms=before["total_ms"] + bucket["total_ms"],
                        count=before["count"] + bucket["count"],
                    )
                else:
                    merged.append(bucket | {"index": index})
            self.buckets = merged

    def plot(self):
        return [
            {k: v for k, v in bucket.items() if k not in ("index", "total_ms")}
            | {"mean_ms": bucket["total_ms"] / bucket["count"]}
            for bucket in self.buckets
        ]

    def summary(self, exact=False):
        count = len(self.values)
        if not count:
            return None
        # Live percentiles have 1 µs bins. Sort raw values only after recording stops.
        weighted = (
            [(value, 1) for value in sorted(self.values)]
            if exact
            else [(value / 1000, frequency) for value, frequency in sorted(self.histogram.items())]
        )

        def at(position):
            seen = 0
            for value, frequency in weighted:
                seen += frequency
                if seen > position:
                    return value
            return weighted[-1][0]

        def percentile(fraction):
            offset = (count - 1) * fraction
            lower = math.floor(offset)
            return at(lower) + (at(min(count - 1, lower + 1)) - at(lower)) * (offset - lower)

        def low(fraction):
            wanted = max(1, math.ceil(count * fraction))
            remaining, total = wanted, 0
            for value, frequency in reversed(weighted):
                take = min(remaining, frequency)
                total += value * take
                remaining -= take
                if not remaining:
                    break
            return 1000 / (total / wanted)

        result = dict(
            frames=count,
            frame_duration_s=self.total_ms / 1000,
            average_fps=1000 * count / self.total_ms,
            low_1_percent_fps=low(0.01),
            low_01_percent_fps=low(0.001),
            p50_ms=percentile(0.5),
            p95_ms=percentile(0.95),
            p99_ms=percentile(0.99),
            p999_ms=percentile(0.999),
            worst_ms=max(bucket["max_ms"] for bucket in self.buckets),
            slow_frame_clusters=self.clusters,
            longest_slow_cluster_frames=self.longest_cluster,
            low_01_percent_frame_count=max(1, math.ceil(count * 0.001)),
        )
        result.update(
            {f"over_{threshold:g}ms": count for threshold, count in self.thresholds.items()}
        )
        return result


class MangoHudStream:
    def __init__(self):
        self.header = None
        self.pending = ""
        self.stats = FrameStats()
        self.previous = None
        self.first = None
        self.origin = None
        self.duration_sum = 0.0
        self.last_elapsed = None

    def feed(self, text):
        lines = (self.pending + text).split("\n")
        self.pending = lines.pop()
        for line in lines:
            if not line.strip():
                continue
            values = next(csv.reader([line]))
            if self.header is None:
                if "frametime" in values and "elapsed" in values:
                    self.header = values
                continue
            if len(values) != len(self.header):
                raise ValueError("Incomplete gameplay CSV row")
            raw = dict(zip(self.header, values))
            frame, elapsed = float(raw["frametime"]), float(raw["elapsed"]) / 1e9
            if not math.isfinite(elapsed) or (
                self.previous is not None and elapsed <= self.previous
            ):
                raise ValueError("Non-monotonic gameplay frame timestamps")
            if self.first is None:
                self.first = elapsed
                self.origin = elapsed - frame / 1000
            else:
                self.duration_sum += frame / 1000
            self.stats.append(elapsed - self.origin, frame)
            self.previous = self.last_elapsed = elapsed

    def validate(self):
        if len(self.stats.values) < 2:
            raise ValueError("Not enough individual gameplay frames")
        elapsed = self.previous - self.first
        if abs(self.duration_sum - elapsed) > max(0.005, elapsed * 0.02):
            raise ValueError("Sparse or incomplete gameplay capture; expected log_interval=0")
        if self.pending.strip():
            raise ValueError("Gameplay capture ended with an incomplete CSV row")


class MangoHudLog:
    """Tail one continuously flushed log; discard loading and transition rows."""

    def __init__(self, directory):
        self.directory = directory
        self.path = None
        self.offset = 0
        self.pending = ""
        self.header = None

    def read(self):
        if self.path is None:
            candidates = [
                p for p in self.directory.glob("cs2_*.csv") if not p.name.endswith("_summary.csv")
            ]
            if len(candidates) > 1:
                raise RuntimeError("Multiple CS2 frame logs appeared for one gameplay session")
            if not candidates:
                return ""
            self.path = candidates[0]
        with self.path.open() as source:
            if self.path.stat().st_size < self.offset:
                raise RuntimeError("Gameplay frame log was truncated during recording")
            source.seek(self.offset)
            text = source.read()
            self.offset = source.tell()
        lines = (self.pending + text).split("\n")
        self.pending = lines.pop()
        data = []
        for line in lines:
            if not line.strip():
                continue
            if self.header is None:
                values = next(csv.reader([line]))
                if "frametime" in values and "elapsed" in values:
                    self.header = line
                continue
            data.append(line + "\n")
        return "".join(data)
