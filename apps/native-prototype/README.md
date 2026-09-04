# WallpaperDB Desktop

A native desktop prototype that turns a local wallpaper collection into images, looping videos, and programmable environments on Manjaro with Hyprland.

It provides a WallpaperDB-themed library window and CLI, independent or spanning display groups, audio and pointer reactivity, keyboard-triggered effects, and automatic suspension when a display sleeps or shows a fullscreen application.

Rust owns the library, layout, process lifecycle, and compositor integration. GTK layer-shell displays still images; mpv renders videos; JavaScript scenes run in WebKitGTK and can combine images, videos, canvas graphics, and live inputs.
