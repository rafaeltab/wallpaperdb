# Native Desktop

Owns the user's local wallpaper library and assignments to compositor outputs.

| Term | Meaning |
| --- | --- |
| Library item | An imported local image, video, or executable live wallpaper bundle |
| Output | A named display exposed by Hyprland, identified by connector name |
| Group | Non-overlapping set of outputs assigned one library item and playback settings |
| Canvas | Full logical coordinate space of a group; spans preserve physical layout gaps |
| Viewport | The rectangle of the canvas shown by one output |
| Signal | Explicit semantic input delivered to a scene, such as a shortcut-triggered key pulse |

The prototype has no backend dependency. Future remote catalog results should download into the local library and enter the same assignment path as file imports. It does not own wallpaper upload, search, or user profiles.
