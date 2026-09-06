"""Generate the bounded, original 4K60 fixture used by both stress-studio hosts.

This does real encoding only when invoked without --dry-run. No monitor or player
is touched. The selected encoder never silently falls back to a different one.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1] / "examples" / "stress-studio"
WIDTH, HEIGHT, FPS, FRAMES = 3840, 2160, 60, 480
SEED = 173
COLOR_FILTER = "h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=0"


def artwork():
    """Render vectors at 4096×2304; every output video pixel is a source pixel."""
    rng = random.Random(SEED)
    stars = "".join(
        f'<circle cx="{rng.uniform(0, 4096):.2f}" cy="{rng.uniform(0, 1700):.2f}" '
        f'r="{rng.uniform(.55, 2.2):.2f}" fill="#c2d9e8" '
        f'opacity="{rng.uniform(.13, .7):.3f}"/>'
        for _ in range(520)
    )
    ridges = ""
    for layer, color in enumerate(["#172e48", "#14273b", "#102132", "#0c1a28"]):
        points = " ".join(
            f"{x},{1520 + layer * 152 + math.sin(x / 340 + layer) * 110 + math.sin(x / 127 + layer * 2) * 35:.2f}"
            for x in range(-32, 4140, 32)
        )
        ridges += f'<polygon points="-32,2304 {points} 4140,2304" fill="{color}"/>'
    grid = "".join(
        f'<path d="M{x} 1660V2304" stroke="#91b8bf" stroke-opacity=".045" stroke-width="1"/>'
        for x in range(0, 4097, 16)
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="2304" viewBox="0 0 4096 2304">
<defs>
  <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#071323"/><stop offset=".6" stop-color="#254257"/><stop offset="1" stop-color="#746170"/></linearGradient>
  <radialGradient id="halo"><stop stop-color="#76928c" stop-opacity=".35"/><stop offset="1" stop-color="#76928c" stop-opacity="0"/></radialGradient>
  <linearGradient id="moon" x2="1" y2="1"><stop stop-color="#b3d2c9"/><stop offset="1" stop-color="#6e889b"/></linearGradient>
  <linearGradient id="glass" x2="1" y2="1"><stop stop-color="#adb7c9" stop-opacity=".2"/><stop offset=".6" stop-color="#6d8da3" stop-opacity=".025"/><stop offset="1" stop-color="#7fb4b4" stop-opacity=".15"/></linearGradient>
</defs>
<rect width="4096" height="2304" fill="url(#sky)"/>{stars}
<ellipse cx="3150" cy="880" rx="1080" ry="800" fill="url(#halo)"/>
<circle cx="3200" cy="730" r="255" fill="url(#moon)"/>
<ellipse cx="2810" cy="1040" rx="780" ry="255" transform="rotate(-24 2810 1040)" fill="none" stroke="#99b1bf" stroke-opacity=".16" stroke-width="7"/>
<path d="M540 425 1640 650 1335 1580 235 1355Z" fill="url(#glass)" stroke="#99b4c6" stroke-opacity=".2" stroke-width="2"/>
<path d="M1240 245 2340 470 2035 1400 935 1175Z" fill="url(#glass)" stroke="#bcc1cb" stroke-opacity=".11" stroke-width="2"/>
{ridges}{grid}
<path d="M0 1845Q1024 1800 2048 1845T4096 1845" fill="none" stroke="#9bb5bc" stroke-opacity=".1" stroke-width="2"/>
</svg>"""


def encoder_options(name):
    if name == "h264_nvenc":
        return [
            "-c:v",
            name,
            "-preset",
            "p4",
            "-rc",
            "vbr",
            "-cq",
            "23",
            "-b:v",
            "22M",
            "-maxrate",
            "40M",
            "-bufsize",
            "80M",
        ]
    return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-maxrate",
        "40M",
        "-bufsize",
        "80M",
    ]


def commands(directory, encoder):
    source = directory / "source.svg"
    raster = directory / "source.png"
    image = directory / "background-4k.png"
    movie = directory / "background-4k.mp4"
    crop = "crop=3840:2160:x='128+96*sin(2*PI*t/8)':y='72+48*cos(2*PI*t/8)':exact=1"
    return [
        ["rsvg-convert", "--width", "4096", "--height", "2304", "-o", str(raster), str(source)],
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-nostdin",
            "-y",
            "-threads",
            "4",
            "-i",
            str(raster),
            "-filter_threads",
            "2",
            "-vf",
            "crop=3840:2160:128:120:exact=1",
            "-frames:v",
            "1",
            "-threads",
            "4",
            "-update",
            "1",
            str(image),
        ],
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-nostdin",
            "-y",
            "-threads",
            "4",
            "-loop",
            "1",
            "-framerate",
            str(FPS),
            "-i",
            str(raster),
            "-filter_threads",
            "2",
            "-vf",
            crop + ",scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p",
            "-an",
            "-sn",
            "-dn",
            "-frames:v",
            str(FRAMES),
            "-t",
            "8",
            "-r",
            str(FPS),
            *encoder_options(encoder),
            "-threads",
            "4",
            "-g",
            "120",
            "-pix_fmt",
            "yuv420p",
            "-color_primaries",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_trc",
            "13",
            "-color_range",
            "tv",
            "-bsf:v",
            COLOR_FILTER,
            "-movflags",
            "+faststart",
            "-fs",
            "100M",
            str(movie),
        ],
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encoder", choices=["h264_nvenc", "libx264"], default="h264_nvenc")
    parser.add_argument(
        "--timeout", type=int, default=180, help="Per-command deadline, 10–300 seconds"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the plan; do not rasterize or encode"
    )
    args = parser.parse_args()
    if not 10 <= args.timeout <= 300:
        parser.error("--timeout must be between 10 and 300 seconds")
    plan = {
        "width": WIDTH,
        "height": HEIGHT,
        "fps": FPS,
        "frames": FRAMES,
        "duration_seconds": 8,
        "encoder": args.encoder,
        "seed": SEED,
        "per_command_timeout_seconds": args.timeout,
        "image": "background-4k.png",
        "video": "background-4k.mp4",
        "metadata": "fixture.json",
        "color": "SDR BT.709 primaries/matrix, sRGB transfer (13), limited-range YUV420P",
        "bitstream_filter": COLOR_FILTER,
        "source": "Original 4096×2304 vector raster, animated integer-pixel crop to 3840×2160; no upscaling",
    }
    if args.dry_run:
        plan["commands"] = commands(Path("<temporary-directory>"), args.encoder)
        print(json.dumps(plan, indent=2))
        return
    for tool in ["rsvg-convert", "ffmpeg", "ffprobe"]:
        if not shutil.which(tool):
            parser.error(f"Required tool is missing: {tool}")
    ROOT.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(ROOT).free < 256 * 1024 * 1024:
        parser.error("Fixture generation requires at least 256 MiB of free disk space")
    print(json.dumps(plan, indent=2), flush=True)
    with tempfile.TemporaryDirectory(prefix=".stress-assets-", dir=ROOT) as temporary:
        directory = Path(temporary)
        (directory / "source.svg").write_text(artwork())
        for command in commands(directory, args.encoder):
            subprocess.run(command, check=True, timeout=args.timeout)
        probe = json.loads(
            subprocess.check_output(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=codec_name,width,height,pix_fmt,avg_frame_rate,nb_frames,duration,color_space,color_transfer,color_primaries,color_range",
                    "-of",
                    "json",
                    str(directory / "background-4k.mp4"),
                ],
                timeout=10,
            )
        )["streams"][0]
        if (
            probe["width"] != WIDTH
            or probe["height"] != HEIGHT
            or probe["avg_frame_rate"] != "60/1"
            or int(probe.get("nb_frames", 0)) != FRAMES
            or abs(float(probe.get("duration", 0)) - 8) > 0.02
            or probe.get("color_primaries") != "bt709"
            or probe.get("color_transfer") != "iec61966-2-1"
            or probe.get("color_space") != "bt709"
            or probe.get("color_range") != "tv"
        ):
            raise RuntimeError(f"The generated clip does not match the fixed workload: {probe}")
        plan["probe"] = probe
        plan["files"] = {}
        for name in ["background-4k.png", "background-4k.mp4"]:
            path = directory / name
            with path.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            plan["files"][name] = {
                "bytes": path.stat().st_size,
                "sha256": digest,
            }
            path.replace(ROOT / name)
        (directory / "fixture.json").write_text(json.dumps(plan, indent=2) + "\n")
        (directory / "fixture.json").replace(ROOT / "fixture.json")
    print(
        "Generated one 4K still and one 8-second 4K60 clip; fixture.json records their exact hashes."
    )


if __name__ == "__main__":
    main()
