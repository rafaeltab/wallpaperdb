# Frontend design

Scope: browser application code and shared frontend/UI modules. The [project-wide module organization rules](project-organization.md#module-organization) also apply.

## State ownership

- Give each kind of state one authoritative owner. The query layer owns the saved server data and request activity it manages; the router owns URL state; the authentication provider owns authentication state; editors own unsaved drafts and editing sessions.
- Derive combined values such as command availability and `canSave` from their owners. Avoid synchronizing additional mutable copies of request activity between the query layer, an editor, and React.
- An editor's captured base value and version are intentional history. Preserve them while the user edits, and change them only when the editing policy explicitly adopts or rebases onto newer server data.

## Feature interfaces

- Cross-feature dependencies use deliberately public entries. Keep private implementation details private and feature dependencies acyclic.
- Designate effectful adapter entries explicitly. A file's placement in an adapter directory does not make it public.

## Request and UI lifetimes

- An accepted request retains its intended command and owner. Define whether it continues after navigation and where its result may be published.
- Separate cache publication from component feedback. A response may update its original valid cache after the editor unmounts; toasts, focus changes, and local feedback belong to the originating UI lifetime.
- Responses from an earlier session must not overwrite a replacement session's cache or update its UI. Identify request ownership independently of the current rendered component or a reused profile identifier.
- Release UI-owned timers and subscriptions when their owning UI lifetime ends. Late completions must respect that lifetime even when the underlying request continues.

## Testing

The [shared testing principles](project-organization.md#shared-testing-principles) apply. Select frontend test boundaries by the responsibility they exercise:

- Test calculations and workflows through their public interfaces.
- Test React/query integration for synchronization and lifecycle behavior.
- Use browser tests for behavior that depends on real focus, measurement, or animation. The [browser E2E policy](project-organization.md#browser-e2e-testing) governs complete journeys through real services.
- For complex editors, cover dirty-draft preservation, captured confirmations, competing commands, navigation, and session replacement where those behaviors apply. Assert the intended command and publication outcomes without depending on private implementation details.
