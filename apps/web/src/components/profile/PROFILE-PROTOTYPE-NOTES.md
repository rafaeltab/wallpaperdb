# Profile settings UX exploration — throwaway

Question: which layout gives a useful profile overview while keeping editing focused?

Run the existing development stack with `make dev` (after `make infra-start`), sign in,
then open `/web/settings/profile?variant=E` on this worktree's ingress (currently port 8140).
The normal settings screen is unchanged when `variant` is absent. Prototypes are development-only.
Existing authentication and profile reads stay in place; prototype edits stay in memory.

Available alternatives:

- A — Profile card: compact identity and handle above a biography preview.
- B — Profile preview: a public-profile composition with editing controls on the content.
- C — Editable details: a compact list with clear labels and section boundaries.
- D — Inline profile (prototype 4): B’s composition with matching inline text editors and a fixed gradient.
- E — Edit in place (prototype 5): the public Profile layout with controls at each field.

All alternatives use dialogs for pictures and previous handles. A/B/C retain biography dialogs;
D/E edit biography inline. Custom banner editing has been deferred to issue #212.
Use “Profile handle” in user-facing copy. Show routine refresh only as contextual recovery
in the eventual implementation. The current biography refresh reloads the profile, preserves
unsaved text, updates its concurrency version, and retries embedded wallpaper previews.

Decision: the user prefers B’s visual composition and previous-handles dialog. D explores their
requested refinement: consistent inline display-name, handle, and biography editing.
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
  inputs with Save/Cancel, stacked display name above handle. Biography edits inline using the
  same Write/Preview flow. The gradient stays fixed; custom banner support is deferred.

Use the floating arrows or left/right keys to compare. Edits carry across variants.
Arrow keys keep their normal behavior in fields and dialogs. **Example content** adds a
biography and representative retained, expiring, and historical handles. **Reset** restores
this page's current profile snapshot; reloading discards every local edit.

The picture chooser previews a local file. Replace and Remove sit beside one another.
Biography editing includes Write/Preview, Markdown help, Save, and Cancel. Previous handles
have separate headings, bordered rows, status badges, dates, and local redirect actions.
Display-name editing and a local public-profile preview are also available. The preview
shows identity and biography without wallpapers, and links to the real saved Profile.

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

## Prototype 4 follow-up (historical; banner exploration removed below)

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


## Inline biography and handle availability refinement (before banner deferral)

The user refined D: biography editing should expand in place, and display name should sit
above the handle at every screen size. Implemented while retaining picture/banner dialogs
and the previously accepted previous-handles details dialog.

- Biography keeps Write/Preview, character count, Markdown help, Save/Cancel and Escape.
  Unsaved draft and preview mode survive variant switches. Enter inserts a newline.
- Cooldown now derives from the owner's `lastHandleChangedAt` plus seven days, disables the
  handle pencil, and shows a relative availability message beside it. Saving a handle
  starts a local seven-day cooldown and focuses that explanation. Availability is checked
  every minute. **Cooldown** in the prototype bar toggles this local scenario; Reset restores
  the loaded profile. This toolbar override never affects backend policy.
- Existing production behavior differs: it shows the next-change date, but leaves the input
  and submit enabled. The server enforces seven days and returns HTTP 429 with authoritative
  `nextHandleChangeAt`. The production redesign should retain that server authority.
- agent-browser verified desktop and 390px/320px mobile: inline biography entry/focus,
  rendered Markdown preview, save, cancellation/Escape, stacked identity, no horizontal
  overflow, cooldown preview toggle, and actual local handle save -> disabled editing and
  focus on the availability message. Independent review passed after correcting that focus.
- Focused Biome passes. TypeScript still reports 72 existing diagnostics, none in the edited
  source files. The prototype remains local, with incremental commits and no PR update.

## Full banner support: assessment, not implementation

Planning estimate: **3–5 focused engineering days** for static JPEG/PNG/WebP upload,
replacement, removal, public display, tests, review and browser verification. Draggable
crop/focal-point editing would add roughly **1–2 days**. These ranges depend on implementation
and verification findings; they are not a delivery commitment.

Reuse existing image validation/normalization, private object storage, version-safe asset
adoption, cleanup retries, and origin availability checks. The production public profile
already has the gradient banner and overlapping avatar composition.

Add a banner asset reference and explicit image role to User's schema with migration;
version-safe banner commands; banner metadata in profile events, Gateway projection/GraphQL,
and Media delivery/authorization; actual frontend upload/error states and public rendering.
Verify independent avatar/banner ownership, concurrent changes, retirement/cleanup, removal,
and compatibility with older events. A separate service or bucket is not required.

Implementation seams inspected:
- `apps/user/src/services/profile-picture-processing.ts`
- `apps/user/src/services/profile.service.ts`
- `apps/user/src/services/profile-picture-retention.service.ts`
- `apps/media/src/services/profile-picture.service.ts`
- `packages/events/src/schemas/profile-updated.ts`
- `apps/web/src/components/profile/public-profile-page.tsx`


## Relative cooldown follow-up

Replaced the timestamp and policy paragraph with **“Available for change in 7 days”** after
the disabled pencil. The message wraps below the handle on narrow screens, uses hours and
minutes near expiry, and retains a machine-readable deadline and programmatic focus target.
The demo now starts at seven days, using the same clock value for the deadline and rendering.
agent-browser confirmed the text and pencil share a row at 1440px, wrap without horizontal
overflow at 320px, and the pencil stays disabled. Independent review passed; Biome passed.


## Alignment, accurate preview, and navigation refinement

The current D overview keeps the display name above the handle, with matching pencils
vertically centered on each text row. Icon buttons keep their background unchanged on hover;
only their glyph color changes. The relative cooldown follows the handle pencil and wraps
on small screens. Hovering or keyboard-focusing the underlined duration opens the full
weekday/date/year/time/time-zone tooltip.

Banner editing and its local state have been removed. The gradient remains. Full custom
banner support is tracked in [GitHub issue #212](https://github.com/rafaeltab/wallpaperdb/issues/212).
The earlier banner sections above record the exploration, not the current UI.

“View profile” previews local changes using the real public Profile overview, picture
renderer (including fallback colors and initials), biography renderer, and wallpaper list.
“Open your profile” opens the real saved Profile in another tab using the immutable Profile
ID, so unsaved prototype handle changes cannot create broken links.

The account dropdown is wide enough for “Your profile” and “Sign out” on single lines.
“Your profile” opens the public page. That page shows “Edit profile” at the top right only
for the authenticated owner. During local development it leads back to prototype D; in
production it leads to normal Profile settings. The redesigned editor remains a local,
read-only prototype and is not promoted by this navigation change.

Navigation behavior was implemented test-first. Independent review corrected preview avatar
consistency and gradient/identity layering. Desktop browser checks confirmed the tooltip on
hover and keyboard focus, centered pencil/text rows, public preview, real profile link, and
owner edit link. The first four focused test files passed all 48 tests. Biome passed. App
TypeScript reports 71 pre-existing diagnostics, none in changed source files; importing the
existing missing test helper removed one prior diagnostic.


### Final navigation and mobile verification

Browser verification exposed an existing infinite loop when intent-preloading a Profile ID
link: href-only canonical redirects recursively preloaded the original route. Canonical
redirects now use typed router destinations and handle parameters. Three bounded real-router
regressions cover repeated ID, bare-handle, and alias preloads under `/web`; all three failed
before the fix. They and the ten existing loader tests pass (13 tests), in addition to the
48 component tests above. Review checked the shared redirect fix, and agent-browser repeated
menu hover/click → canonical Profile → Edit profile successfully with cached data.

At 320px, the public page, owner edit action, account menu, editor, and preview fit without
horizontal overflow. Account menu entries remain one line. The full date tooltip has 16px
screen gutters, including keyboard focus. Closing the preview restores focus to “View profile.”
Desktop verification confirmed that pencil glyph color changes on hover while the background
stays transparent; icon and text line centers match. Light and dark layouts were inspected.

Final app TypeScript check remains at 71 existing diagnostics, with none in the changed source
or new redirect tests. Scoped Biome and whitespace checks pass. Verification browser sessions
are closed; the user's running development stack is left running. All changes are committed
locally, with no push or update to PR #208.


## Smaller icons and themed action hints

The follow-up scales pencil glyphs with CSS `1ex` (the surrounding font's x-height), while
keeping a larger click target. Profile icon actions, dialog close, and prototype arrows now
have concise hover/focus tooltips. Disabled actions keep hover explanations through a wrapper.
The shared tooltip now uses popover surface/text colors and a matching arrow, so dark mode
shows a dark surface instead of the previous inverted white surface.

Profile preview no longer includes Wallpapers. The public Profile page still shows them.
The preview retains its real-profile link and the shared public identity/biography layout.
Agent-browser confirmed the smaller glyphs, dark tooltip colors, concise labels, cooldown
expanded date, wallpaper-free preview, and dialog focus return on desktop and 390px mobile.


## Prototype 5 — edit in place

Latest direction: align the editor with the actual public Profile and keep the content in
place when editing. E is available at `/web/settings/profile?variant=E`; D remains at
`?variant=D`. The switcher includes A–E and preserves drafts between alternatives.

E reuses the public Profile's exact outer width/padding, gradient, overlapping picture,
identity alignment, font sizes, line heights, and biography position. “View profile” sits
at the top right inside the card. Picture rendering uses the real public fallback colors
and initials. The name and handle become inputs at their existing text origin, without
visible labels or routine descriptions. The fixed @ prefix stays in place. Save/Cancel
use icons with concise tooltips; labels remain available to assistive technology. Invalid
input receives contextual feedback. Enter saves and Escape cancels.

Biography has an edit icon in place of the visible heading, then opens inline at the same
content origin with Write/Preview, icon Save/Cancel, a character count, and formatting help.
The previous-handles summary occupies the existing gap below the identity, preserving the
public page's layout. Its details dialog and the picture dialog remain available.

Browser checks at 1440px and 320px confirmed exact read/edit name and handle origins and
line heights, local save/cancel and focus return, Markdown preview/save/cancel, alias details,
cooldown tooltip, icon tooltips (including disabled Save), and preserved drafts across D/E.
The 320px example alias summary fits on one line and clears the divider. Light and dark
appearances were inspected, with no page errors reported. Picture/alias dialogs focus their
title on entry, so the Close tooltip does not intercept the first Escape key.

A wrapped display name initially collapsed to one line when edited. The editor now retains
the measured read height for that edit cycle: a 108px name keeps its following handle in
place while using a single-line input at the first line's origin. This throwaway reservation
is not recalculated for viewport resizing during an active edit. Final production work
should handle that case, authoritative policy/errors, persistence, and full automated tests.

Independent code review passed. All edits remain in memory and changes are committed locally;
PR #208 has not been updated. Banner support remains deferred to issue #212.

Final validation: 44 existing Profile settings/public page/account menu tests pass; focused
Biome formatting and whitespace checks pass. App TypeScript still reports 71 pre-existing
diagnostics, with none in the changed prototype, tooltip, switcher, or route files. The
verification browser is closed; the user's development stack remains running.


## Baseline alignment and explicit biography action

Identity icons now participate in the actual text baseline instead of centering within a
button box. Their glyphs remain `1ex`, and their click targets retain the surrounding line
height. The same rule covers E's Edit/Save/Cancel icons and the other prototypes' text pencils.
Agent-browser measured the name icon's bottom 3.3125px above its text baseline before the fix;
afterward it exactly matched the baseline in desktop read/edit states and in mobile name and
handle rows. Wrapped-name edit height still preserves the following handle position.

The biography entry action is now a regular outlined **Edit biography** button throughout
the prototypes. E retains its existing biography content origin. Desktop/mobile browser
checks confirmed entry, Escape/cancel, and focus return; no page errors were reported.
Independent code review and focused formatting checks passed. Changes remain local; PR #208
is unchanged.

## Inline save feedback

The handle's Edit/Save/Cancel glyphs are now 14px, with the existing click targets and
baseline alignment. The status row below the card has been removed. Inline display name,
handle, and biography saves share a simulated 900ms loading state: the check becomes a
spinner, then a green check pulses between bright/dark green twice and fades over 1.6s.
The editor closes after the feedback. Local values commit when success is announced,
so switching prototypes during the animation keeps a confirmed save.

Failures show a pulsing red cross and an error toast, preserve the draft, and keep the
editor open. After the pulse, Save is available for retry. The prototype toolbar's
**Fail next save** toggle makes this state reproducible; it is consumed by one inline
save. This remains a memory-only demonstration, with no API writes. Reduced-motion
preferences replace animation with static status icons for the same feedback interval.

Toasts use the app's themed Sonner component, at the top right to clear the floating
prototype toolbar on narrow screens. Successful retries clear the earlier error text.
Pending saves prevent duplicate submission and cancellation; Reset cancels pending timers.
Completion restores focus only when it would not interrupt another focused control.

Agent-browser verified all three editors' failure/retry flows, spinner/green/red states,
preserved drafts, Enter/Escape behavior, reset cancellation, confirmed saves across variant
switches, focus retention, and biography focus return. Desktop and 320px layouts were
checked in light/dark themes, including reduced motion and themed toast placement. The
14px handle icon still meets the text baseline exactly (both measured at 311px on mobile).
No browser errors were reported. Independent code review passed; 44 existing settings,
public Profile, and account-menu tests pass. TypeScript still reports the same 71 existing
errors, with none in the changed prototype files. Changes are committed locally; PR #208
remains unchanged.
