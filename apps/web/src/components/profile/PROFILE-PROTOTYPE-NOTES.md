# Profile settings UX exploration — throwaway

Question: which layout gives a useful profile overview while keeping editing focused?

Run the existing development stack with `make dev` (after `make infra-start`), sign in,
then open `/web/settings/profile?variant=D` on this worktree's ingress (currently port 8140).
The normal settings screen is unchanged when `variant` is absent. Prototypes are development-only.
Existing authentication and profile reads stay in place; prototype edits stay in memory.

Available alternatives:

- A — Profile card: compact identity and handle above a biography preview.
- B — Profile preview: a public-profile composition with editing controls on the content.
- C — Editable details: a compact list with clear labels and section boundaries.
- D — Inline profile (prototype 4): B’s composition with matching inline text editors and a custom banner.

All alternatives use dialogs for pictures, biography and previous handles.
Use “Profile handle” in user-facing copy. Show routine refresh only as contextual recovery
in the eventual implementation. The current biography refresh reloads the profile, preserves
unsaved text, updates its concurrency version, and retries embedded wallpaper previews.

Decision: the user prefers B’s visual composition and previous-handles dialog. D explores their
requested refinement: consistent inline display-name/handle editing and a custom banner.
No production redesign or PR update is included.
When selected, implement the chosen behavior with TDD and remove this prototype and switcher.

## Comparing the prototypes

- `/web/settings/profile?variant=A` — **Profile card**: one compact card with
  identity and handle above the biography. Closest to the requested minimal overview.
- `/web/settings/profile?variant=B` — **Profile preview**: banner and overlapping avatar,
  with editing controls placed on a composition similar to the public profile.
- `/web/settings/profile?variant=C` — **Editable details**: labeled rows and dividers for
  familiar settings navigation. Uses more vertical space on a phone.
- `/web/settings/profile?variant=D` — **Inline profile** (prototype 4): B’s banner/overlapping-avatar
  layout. Display name and @handle start as text with pencils; both become matching inline
  inputs with Save/Cancel. The banner has its own local chooser, preview, save, and remove flow.

Use the floating arrows or left/right keys to compare. Edits carry across variants.
Arrow keys keep their normal behavior in fields and dialogs. **Example content** adds a
biography and representative retained, expiring, and historical handles. **Reset** restores
this page's current profile snapshot; reloading discards every local edit.

The picture chooser previews a local file. Replace and Remove sit beside one another.
Biography editing includes Write/Preview, Markdown help, Save, and Cancel. Previous handles
have separate headings, bordered rows, status badges, dates, and local redirect actions.
Display-name editing and a local public-profile preview are also available.

## Validation and scope

- Independently reviewed; corrected nested external-link confirmation layering, overlapping
  active/historical handles, and the display-name input label.
- Verified with agent-browser in the running worktree app: A/B/C at 1440px and 390px; picture
  dialog at 320px; local file selection/replacement/removal; biography cancel/save/Markdown
  preview; alias removal scheduling; dialog Escape and focus return; keyboard switching;
  unchanged normal route; local edits discarded on reload. Light and dark themes inspected.
- Focused Biome check passes. The app TypeScript check reports the same 72 existing
  diagnostics; none are in the prototype or its route integration.
- An accessibility scan of the C overview found existing app-shell nested/duplicate `main`
  landmarks (RootLayout + SidebarInset). This prototype does not change the app shell.
- No automated prototype tests were added, following the explicitly requested prototype
  skill's throwaway workflow. No API mutation handlers are wired to prototype controls.
- Cooldown, handle availability, complete alias policy, upload validation, and destructive
  confirmations are simplified. Final implementation needs real policy/error recovery,
  stale-version feedback, and tests. Upload previews do not normalize or store image files.
- Every increment is committed locally. Nothing has been pushed or changed on PR #208.

## Prototype 4 follow-up

User direction: keep prototype 2's visual composition and previous-handles modal; make
both display name and profile handle display as text with pencils and edit inline; explore
adding a custom profile banner. Prototype D implements this direction without API writes.

- Enter saves and Escape cancels each inline editor. Buttons use the same layout; focus
  returns to that field's pencil. Drafts survive switching variants and stay independent.
- Custom banners use a local file preview and cover cropping at the current screen size.
  Removing one restores the gradient. The local public-profile preview includes the banner.
- agent-browser verified D at 1440px/390px and the banner dialog at 320px: both inline
  editors, Enter/save, Escape/Cancel, invalid-handle feedback, focus return, custom banner
  preview/save/remove/cancel, previous-handles dialog, and D/A switcher wraparound.
- Independent subagent code review passed. Focused Biome passes; app TypeScript still has
  the same 72 existing diagnostics, with zero diagnostics in changed source files.
- Banner storage, image validation, positioning/cropping controls, and backend policy are
  outside this throwaway prototype. Changes remain local and reload discards them.

Decision pending: user's assessment of D, then implement the selected production flow with
TDD and remove these throwaway alternatives. PR #208 remains unchanged.
