"""Original, numerically defined HDR fixtures; no external content or display changes."""

from pathlib import Path
import struct, zlib, subprocess, math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "examples"
W, H = 1280, 720
NITS = [0.1, 1, 10, 80, 203, 300, 400, 800]


def pq(n):
    p = (n / 10000) ** (2610 / 16384)
    return ((3424 / 4096 + (2413 / 128) * p) / (1 + (2392 / 128) * p)) ** (2523 / 32)


def chunk(name, data):
    return (
        struct.pack(">I", len(data))
        + name
        + data
        + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
    )


row = b"".join(
    struct.pack(">HHH", *([round(pq(NITS[min(x * 8 // W, 7)]) * 65535)] * 3)) for x in range(W)
)
png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 16, 2, 0, 0, 0))
    + chunk(b"cICP", bytes([9, 16, 0, 1]))
    + chunk(b"IDAT", zlib.compress((b"\0" + row) * H))
    + chunk(b"IEND", b"")
)
(OUT / "HDR reference.png").write_bytes(png)
common = [
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    str(OUT / "HDR reference.png"),
    "-color_primaries",
    "bt2020",
    "-color_trc",
    "smpte2084",
]
subprocess.run(
    common
    + [
        "-frames:v",
        "1",
        "-vf",
        "zscale=matrixin=gbr:matrix=2020_ncl:rangein=full:range=limited,format=yuv444p10le",
        "-c:v",
        "libaom-av1",
        "-cpu-used",
        "8",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv444p10le",
        "-colorspace",
        "bt2020nc",
        str(OUT / "HDR reference.avif"),
    ],
    check=True,
)
# Moving strip occupies only bottom 12%; the measured central row retains all eight patches.
subprocess.run(
    [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-loop",
        "1",
        "-i",
        str(OUT / "HDR reference.png"),
        "-t",
        "3",
        "-r",
        "30",
        "-vf",
        "zscale=matrixin=gbr:matrix=2020_ncl:rangein=full:range=limited,format=yuv420p10le,drawbox=x=0:y=640:w=iw:h=80:color=0x171022:t=fill:enable='lt(mod(t,1),0.5)'",
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p10le",
        "-color_primaries",
        "bt2020",
        "-color_trc",
        "smpte2084",
        "-colorspace",
        "bt2020nc",
        "-x265-params",
        "pools=4:frame-threads=2:log-level=error:hdr10=1:max-cll=800,300",
        "-crf",
        "12",
        str(OUT / "HDR reference.mkv"),
    ],
    check=True,
)
print("Generated 16-bit cICP PNG, 10-bit HDR AVIF, and 10-bit HDR video. Patch nits:", NITS)

subprocess.run(
    [
        "rsvg-convert",
        "-o",
        str(OUT / "rose-clock/background.png"),
        str(OUT / "rose-clock/background.svg"),
    ],
    check=True,
)
