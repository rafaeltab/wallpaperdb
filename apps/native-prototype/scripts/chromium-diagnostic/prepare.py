"""Prepare an isolated diagnostic lab copy. Does not build or launch anything."""

import argparse
import difflib
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError(
            f"Source anchor changed ({text.count(before)} matches): {before[:100]!r}"
        )
    return text.replace(before, after, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="apps/native-prototype directory")
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    root, destination = args.root.resolve(), args.destination.resolve()
    if destination == root or destination.is_relative_to(root):
        parser.error("Diagnostic copies must be outside the active native-prototype tree")
    if destination.exists():
        parser.error("Destination must not already exist")
    inputs = [
        "lab/electron.cjs",
        "lab/presenter.c",
        "lab/pacing.h",
        "lab/media_texture.h",
        "lab/dmabuf.c",
        "lab/Makefile",
        "lab/protocols/wlr-layer-shell.xml",
        "runtime/wallpaper.js",
    ]
    source = {name: (root / name).read_text() for name in inputs}
    changed = dict(source)
    electron = source["lab/electron.cjs"]
    electron = replace_once(
        electron,
        'const config = JSON.parse(fs.readFileSync(configPath, "utf8"));',
        'const config = JSON.parse(fs.readFileSync(configPath, "utf8"));\n'
        'const diagnostic = require("./diagnostic.cjs")(transport, () => stop());',
    )
    electron = replace_once(
        electron,
        'win.webContents.on("paint", (event, _dirty, image) => {',
        'win.webContents.on("paint", diagnostic.paint(() => nextId, (event, _dirty, image) => {',
    )
    electron = replace_once(
        electron,
        "    });\n    const releaseTimer = setInterval",
        "    }));\n    const releaseTimer = setInterval",
    )
    electron = replace_once(
        electron, "const buffer = image.toBitmap(),", "const buffer = diagnostic.bitmap(image),"
    )
    electron = replace_once(
        electron,
        "fs.writeSync(memory, buffer, 0, buffer.length, 0);",
        "diagnostic.write(memory, buffer);",
    )
    for before, after, expected in [
        ("transport.poll(fd)", "diagnostic.poll(fd)", 3),
        ("transport.submit(", "diagnostic.submit(", 2),
    ]:
        if electron.count(before) != expected:
            raise RuntimeError(f"Expected {expected} occurrences of {before!r}")
        electron = electron.replace(before, after)
    electron = replace_once(
        electron,
        "    await win.loadURL(pathToFileURL(wrapper).href);",
        "    await win.loadURL(pathToFileURL(wrapper).href);\n"
        "    await diagnostic.start(win, helper);",
    )
    changed["lab/electron.cjs"] = electron

    presenter = source["lab/presenter.c"]
    presenter = replace_once(
        presenter, "#include <wayland-egl.h>", '#include <wayland-egl.h>\n#include "diagnostic.h"'
    )
    presenter = replace_once(
        presenter,
        "    json_object *o = json_tokener_parse(line);\n    if (o) {",
        "    json_object *o = json_tokener_parse(line);\n    if (o) {\n"
        '      if (get(o, "diagnostic_trace"))\n'
        '        diagnostic_control(json_object_get_boolean(get(o, "diagnostic_trace")));',
    )
    presenter = replace_once(
        presenter,
        "    if (send(peer, ack, n, MSG_DONTWAIT | MSG_NOSIGNAL) == n)\n      pending_ack = 0;",
        "    double began = diagnostic_begin();\n"
        "    ssize_t sent = send(peer, ack, n, MSG_DONTWAIT | MSG_NOSIGNAL);\n"
        "    diagnostic_span(sent == n ? D_ACK_SENT : D_ACK_RETRY, pending_ack, began);\n"
        "    if (sent == n) pending_ack = 0;",
    )
    presenter = replace_once(
        presenter,
        "  glDeleteSync(import_fence);",
        "  diagnostic_span(D_FENCE_OBSERVED, imported_id, diagnostic_fence_began);\n"
        "  glDeleteSync(import_fence);",
    )
    presenter = replace_once(
        presenter,
        "  ssize_t n = recvmsg(peer, &msg, MSG_DONTWAIT | MSG_CMSG_CLOEXEC);",
        "  double diagnostic_received_at = diagnostic_begin();\n"
        "  ssize_t n = recvmsg(peer, &msg, MSG_DONTWAIT | MSG_CMSG_CLOEXEC);",
    )
    presenter = replace_once(
        presenter,
        '  imported_id = val(o, "id", 0);',
        '  imported_id = val(o, "id", 0);\n'
        "  diagnostic_span(D_RECEIVE, imported_id, diagnostic_received_at);\n"
        "  diagnostic_import_began = diagnostic_begin();",
    )
    presenter = replace_once(
        presenter,
        "    void *data = mmap(NULL, size, PROT_READ, MAP_SHARED, fds[0], 0);",
        "    double diagnostic_map_at = diagnostic_begin();\n"
        "    void *data = mmap(NULL, size, PROT_READ, MAP_SHARED, fds[0], 0);\n"
        "    diagnostic_span(D_MAP, imported_id, diagnostic_map_at);",
    )
    presenter = replace_once(
        presenter,
        "    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_BGRA, GL_UNSIGNED_BYTE,\n"
        "                 data);",
        "    double diagnostic_upload_at = diagnostic_begin();\n"
        "    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_BGRA, GL_UNSIGNED_BYTE,\n"
        "                 data);\n"
        "    diagnostic_span(D_UPLOAD_CPU, imported_id, diagnostic_upload_at);",
    )
    presenter = replace_once(
        presenter,
        "    glFlush();\n    received_frames++;",
        "    glFlush();\n"
        "    diagnostic_fence_began = diagnostic_begin();\n"
        "    diagnostic_span(D_IMPORT_CPU, imported_id, diagnostic_import_began);\n"
        "    received_frames++;",
    )
    presenter = replace_once(
        presenter,
        "  for (int i = 0; i < view_count; i++)\n    cancel_frame_callback(&views[i]);\n  glFinish();",
        "  diagnostic_finish();\n"
        "  for (int i = 0; i < view_count; i++)\n    cancel_frame_callback(&views[i]);\n  glFinish();",
    )
    changed["lab/presenter.c"] = presenter
    changed["lab/Makefile"] = replace_once(
        source["lab/Makefile"],
        "$(BUILD)/presenter: presenter.c pacing.h ",
        "$(BUILD)/presenter: presenter.c pacing.h diagnostic.h ",
    )

    # All transformations succeed before creating the isolated destination.
    destination.mkdir(parents=True, mode=0o700)
    hashes = {}
    patches = []
    for name, contents in changed.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(contents)
        hashes[name] = {
            "original_sha256": hashlib.sha256(source[name].encode()).hexdigest(),
            "diagnostic_sha256": hashlib.sha256(contents.encode()).hexdigest(),
        }
        if contents != source[name]:
            patches.extend(
                difflib.unified_diff(
                    source[name].splitlines(True),
                    contents.splitlines(True),
                    fromfile="a/" + name,
                    tofile="b/" + name,
                )
            )
    for name in ["diagnostic.cjs", "diagnostic.h"]:
        shutil.copyfile(HERE / name, destination / "lab" / name)
        hashes["lab/" + name] = {
            "diagnostic_sha256": hashlib.sha256((HERE / name).read_bytes()).hexdigest()
        }
    (destination / "diagnostic.patch").write_text("".join(patches))
    (destination / "source-provenance.json").write_text(
        json.dumps(
            {
                "diagnostic_only": True,
                "original_root": str(root),
                "files": hashes,
                "prepare_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "note": "Separate copied lab. Original source/runtime/build files were not modified.",
            },
            indent=2,
        )
        + "\n"
    )
    (destination / "example-config.json").write_text(
        json.dumps(
            {
                "experiment": "chromium",
                "kind": "live",
                "hdr": False,
                "fps": 360,
                "width": 3840,
                "height": 2160,
                "epoch": 0,
                "source": str(root / "examples/stress-studio/shader-heavy/index.html"),
                "script": "",
                "media": "",
                "outputs": [
                    {
                        "name": "WDB-STRESS",
                        "width": 3840,
                        "height": 2160,
                        "crop_x": 0,
                        "crop_y": 0,
                        "pixel_width": 3840,
                        "pixel_height": 2160,
                    }
                ],
                "note": "Requires an existing explicitly prepared WDB-STRESS output; never creates or reconfigures one.",
            },
            indent=2,
        )
        + "\n"
    )
    print(
        f"Prepared source only: {destination}; review diagnostic.patch before the explicit build/run"
    )


if __name__ == "__main__":
    main()
