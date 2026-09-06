"""Temporary black OLED cover; run under systemd-inhibit during unattended tests."""

import argparse
import json
import os
import signal
import subprocess
import sys
import time

from lab_common import ENV, hypr

os.environ.update(ENV)
os.environ["GDK_BACKEND"] = "wayland"
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GtkLayerShell", "0.1")
from gi.repository import Gdk, GLib, Gtk, GtkLayerShell
import cairo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="DP-5")
    parser.add_argument("--seconds", type=int, default=10800)
    parser.add_argument("--pause-player")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 14400:
        parser.error("Cover lifetime must be between1 second and4 hours")
    os.environ.update(ENV)
    monitors = [m for m in hypr("-j", "monitors") if m["name"] == args.output]
    if len(monitors) != 1:
        parser.error(f"Expected one connected output named {args.output}")
    monitor = monitors[0]
    Gtk.init([])
    display = Gdk.Display.get_default()
    targets = [
        display.get_monitor(i)
        for i in range(display.get_n_monitors())
        if display.get_monitor(i).get_geometry().x == monitor["x"]
        and display.get_monitor(i).get_geometry().y == monitor["y"]
    ]
    if len(targets) != 1:
        parser.error(
            f"Cannot uniquely match {args.output} to a GDK monitor ({len(targets)} geometry matches)"
        )
    target = targets[0]
    window = Gtk.Window()
    window.set_title("WallpaperDB temporary benchmark cover")
    GtkLayerShell.init_for_window(window)
    if hasattr(GtkLayerShell, "set_respect_close"):
        GtkLayerShell.set_respect_close(window, True)
    GtkLayerShell.set_namespace(window, "wallpaperdb-stress-cover")
    GtkLayerShell.set_layer(window, GtkLayerShell.Layer.OVERLAY)
    GtkLayerShell.set_keyboard_mode(window, GtkLayerShell.KeyboardMode.NONE)
    GtkLayerShell.set_monitor(window, target)
    GtkLayerShell.set_exclusive_zone(window, -1)
    for edge in [
        GtkLayerShell.Edge.TOP,
        GtkLayerShell.Edge.BOTTOM,
        GtkLayerShell.Edge.LEFT,
        GtkLayerShell.Edge.RIGHT,
    ]:
        GtkLayerShell.set_anchor(window, edge, True)

    def draw(_window, context):
        context.set_source_rgb(0, 0, 0)
        context.paint()
        return True

    stopping = False

    def quit_cover(*_args):
        nonlocal stopping
        stopping = True
        if Gtk.main_level():
            Gtk.main_quit()
        return False

    window.connect("draw", draw)
    window.connect(
        "realize", lambda w: w.get_window().input_shape_combine_region(cairo.Region(), 0, 0)
    )
    window.connect("destroy", quit_cover)
    target.connect("invalidate", quit_cover)
    for sig in [signal.SIGTERM, signal.SIGINT]:
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, quit_cover)
    GLib.timeout_add_seconds(args.seconds, quit_cover)

    def player(*command):
        return subprocess.check_output(
            ["playerctl", "--player", args.pause_player, *command], text=True, timeout=5
        ).strip()

    paused_track = None
    pause_confirmed = False
    try:
        window.show_all()
        try:
            if not stopping and args.pause_player and player("status") == "Playing":
                paused_track = player("metadata", "--format", "{{mpris:trackid}}|{{xesam:url}}")
                player("pause")
                pause_confirmed = True
        except (OSError, subprocess.SubprocessError) as error:
            print(
                json.dumps(
                    {
                        "warning": "Optional player pause failed; cover remains active",
                        "player": args.pause_player,
                        "error": str(error),
                    }
                ),
                file=sys.stderr,
                flush=True,
            )
        if not stopping:
            print(
                json.dumps(
                    {
                        "pid": os.getpid(),
                        "output": args.output,
                        "black_cover": True,
                        "paused_player": args.pause_player if pause_confirmed else None,
                        "expires_unix": time.time() + args.seconds,
                    }
                ),
                flush=True,
            )
            Gtk.main()
    finally:
        if paused_track:
            try:
                if (
                    player("status") == "Paused"
                    and player("metadata", "--format", "{{mpris:trackid}}|{{xesam:url}}")
                    == paused_track
                ):
                    player("play")
            except (OSError, subprocess.SubprocessError):
                pass
        window.destroy()


if __name__ == "__main__":
    main()
