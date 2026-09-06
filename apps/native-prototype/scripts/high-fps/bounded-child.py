"""Exec one fixture tool with a 100 MiB file limit and four-CPU affinity.

This separate, single-threaded process avoids preexec_fn in the threaded guard
parent. It never starts a player or a shell.
"""

import os
import resource
import shutil
import sys


def main():
    command = sys.argv[1:]
    if not command or command[0] not in {"ffmpeg", "ffprobe", "rsvg-convert", "fc-match"}:
        raise SystemExit("Only fixture-generation tools are accepted")
    executable = shutil.which(command[0])
    if executable is None:
        raise SystemExit(f"Tool unavailable: {command[0]}")
    resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024 * 1024, 100 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    allowed = sorted(os.sched_getaffinity(0))[:4]
    if not allowed:
        raise SystemExit("No CPUs available in inherited affinity")
    os.sched_setaffinity(0, allowed)
    os.execv(executable, command)


if __name__ == "__main__":
    main()
