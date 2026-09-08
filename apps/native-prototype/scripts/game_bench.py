"""Disposable CS2 game benchmark; one command via make native-game-bench."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import time


def vdf(text):
    tokens = iter(re.findall(r'"(?:\\.|[^"\\])*"|[{}]', text))

    def value(token):
        return token[1:-1].replace(r"\"", '"').replace("\\\\", "\\")

    def block():
        result = {}
        for token in tokens:
            if token == "}":
                break
            key = value(token)
            token = next(tokens)
            result[key] = block() if token == "{" else value(token)
        return result

    return block()


def discover():
    steam = Path.home() / ".local/share/Steam"
    if not steam.is_dir():
        steam = Path.home() / ".steam/steam"
    roots = [steam]
    folders = steam / "steamapps/libraryfolders.vdf"
    if folders.is_file():
        roots += [
            Path(entry["path"])
            for entry in vdf(folders.read_text()).get("libraryfolders", {}).values()
            if isinstance(entry, dict) and "path" in entry
        ]
    manifest = next(
        (
            p / "steamapps/appmanifest_730.acf"
            for p in roots
            if (p / "steamapps/appmanifest_730.acf").is_file()
        ),
        None,
    )
    if manifest is None:
        raise RuntimeError("CS2 is not installed in a discovered Steam library")
    app = vdf(manifest.read_text())["AppState"]
    game = manifest.parent / "common" / app["installdir"]
    native = game / "game/bin/linuxsteamrt64/cs2"
    windows = game / "game/bin/win64/cs2.exe"
    config = vdf((steam / "config/config.vdf").read_text())
    mapping = (
        config.get("InstallConfigStore", {})
        .get("Software", {})
        .get("Valve", {})
        .get("Steam", {})
        .get("CompatToolMapping", {})
        .get("730", {})
    )
    tool = mapping.get("name", "")
    proton = steam / "compatibilitytools.d" / tool / "proton"
    if not proton.is_file():
        names = {"proton_experimental": "Proton - Experimental", "proton_hotfix": "Proton Hotfix"}
        proton = next(
            (
                p / "steamapps/common" / names.get(tool, tool) / "proton"
                for p in roots
                if (p / "steamapps/common" / names.get(tool, tool) / "proton").is_file()
            ),
            proton,
        )
    binary = windows if tool and windows.is_file() else native
    if not binary.is_file():
        raise RuntimeError("The selected CS2 executable is missing; finish the Steam installation")
    if binary == windows and not proton.is_file():
        raise RuntimeError(f"Cannot locate the configured compatibility tool: {tool}")
    cfg = list(steam.glob("userdata/*/730/local/cfg"))
    return {
        "steam": str(steam.resolve()),
        "game": str(game.resolve()),
        "binary": str(binary),
        "build_id": app.get("buildid"),
        "version": (game / "game/csgo/steam.inf").read_text(),
        "platform": "proton" if binary == windows else "native-linux",
        "proton": str(proton) if binary == windows else None,
        "proton_name": tool if binary == windows else None,
        "compat_data": str(manifest.parent / "compatdata/730"),
        "cfg_dirs": [str(p) for p in cfg],
        "mangohud": shutil.which("mangohud"),
    }


def game_processes(marker=None):
    found = []
    for directory in Path("/proc").glob("[0-9]*"):
        try:
            argv = (directory / "cmdline").read_bytes().split(b"\0")
            executable = argv[0].replace(b"\\", b"/").rsplit(b"/", 1)[-1].lower()
            if executable not in (b"cs2", b"cs2.exe"):
                continue
            if marker is not None and f"WALLPAPERDB_BENCH_JOB={marker}".encode() not in (
                directory / "environ"
            ).read_bytes().split(b"\0"):
                continue
            found.append(int(directory.name))
        except (OSError, IndexError):
            continue
    return found


def stop_owned_game(marker):
    handles = []
    try:
        for pid in game_processes(marker):
            try:
                fd = os.pidfd_open(pid)
                if pid not in game_processes(marker):
                    os.close(fd)
                    continue
                handles.append(fd)
                signal.pidfd_send_signal(fd, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 5
        while game_processes(marker) and time.monotonic() < deadline:
            time.sleep(0.1)
        for fd in handles:
            try:
                signal.pidfd_send_signal(fd, signal.SIGKILL)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 2
        while game_processes(marker) and time.monotonic() < deadline:
            time.sleep(0.1)
    finally:
        for fd in handles:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--job", type=Path)
    args = parser.parse_args()
    if args.job:
        from game_bench_worker import Job

        raise SystemExit(Job(args.job).run())
    else:
        print(json.dumps(discover(), indent=2))


if __name__ == "__main__":
    main()
