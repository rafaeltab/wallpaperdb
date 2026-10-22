# Skills

Skills live in category folders, following [Matt Pocock's organization](https://github.com/mattpocock/skills/tree/main/skills):

- [Engineering](engineering/): code, design, reviews, and implementation planning.
- [Productivity](productivity/): interviews, writing, and other workflows.
- [Misc](misc/): specialized tools from Matt Pocock's collection.
- [In progress](in-progress/): experimental skills from that collection.
- [WallpaperDB](wallpaperdb/): workflows maintained for this repository.

These are the actual skill directories. Codex discovers their nested `SKILL.md` files. Keep names unique across categories and update relative links when moving a skill. Matt Pocock skills use the category in their upstream `skillPath` in [`skills-lock.json`](../../skills-lock.json); repository-specific workflows belong in `wallpaperdb/`.

## Installing and updating

skills.sh installs and lists skills in a flat `.agents/skills/<name>` layout. Its installed-skill list does not discover these nested copies, and running an install or update here can create competing flat copies.

Stage upstream installs with skills.sh in a temporary directory. Compare the staged files with the categorized copies, merge the desired changes, and update the corresponding source entries in this repository's lockfile. Preserve local customizations and adjust staged relative links to their final location. The lockfile's `skillPath` identifies the upstream source path, not the local category path.
