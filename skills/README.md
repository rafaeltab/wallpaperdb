# Skills

Browse the project's skills by category:

- [Engineering](engineering/): code, design, reviews, and implementation planning.
- [Productivity](productivity/): interviews, writing, and other workflows.
- [Misc](misc/): specialized tools from Matt Pocock's collection.
- [In progress](in-progress/): experimental skills from that collection.
- [WallpaperDB](wallpaperdb/): workflows maintained for this repository.

The categories follow [Matt Pocock's organization](https://github.com/mattpocock/skills/tree/main/skills). Each entry here is a relative symbolic link to its installed directory under [`.agents/skills`](../.agents/skills/). That flat directory remains the source of truth for agent discovery, relative references, and skills.sh installation and updates. Editing a file through either path changes the same file.

Keep upstream provenance in [`skills-lock.json`](../skills-lock.json). When adding, removing, or renaming a skill, update its category link too. Matt Pocock skills use the category in their lockfile `skillPath`; repository-specific workflows belong in `wallpaperdb/`.
