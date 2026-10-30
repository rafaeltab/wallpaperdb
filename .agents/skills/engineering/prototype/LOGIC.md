# Logic prototype

Build one self-contained HTML file for exploring business logic, state transitions, or data shape. A non-developer must be able to open it and drive the model. For appearance questions, use [UI.md](UI.md).

## When this is the right shape

Use it when someone needs to perform actions and inspect resulting state, especially to test awkward sequences or representational edge cases.

## Process

### 1. State the question

Put a visible paragraph at the top naming the state model and question being tested.

### 2. Isolate the logic in a portable module

Keep the logic in one pure `<script>` module that can later move into production code. Choose a reducer, explicit state machine, pure functions, or a stateful class according to the question. Keep DOM access and handlers in the page; the page calls the module, never the reverse.

### 3. Build the shareable HTML file

Use inline HTML, CSS, and JavaScript without a framework, bundler, or server. It must open by double-click. Use domain language and plain explanations.

Arrange the page as:

1. A title and short explanation of the question.
2. A panel of labeled fields showing all relevant state after every click. Call out changes when helpful; avoid raw JSON.
3. Always-available free-play buttons, one per action, each dispatching and rerendering state.
4. Tabbed guided scenarios. Each explains its setup and what to watch, then supplies ordered action buttons that perform each step. Starting a walkthrough resets to a known state.

Include the happy path, difficult edge cases, and illegal actions. Use restrained typography, spacing, and one accent color, without animations.

### 4. Hand it over

Send or open the file. Use feedback about unexpected state or missing scenarios to refine it.

### 5. Capture the answer and the prototype

Follow [SKILL.md](SKILL.md) to record the verdict and preserve the prototype. Move validated logic into the real module; keep the HTML shell on the throwaway branch, where it remains runnable.

## Anti-patterns

Follow the shared prototype rules: no tests, speculative generalization, or real database unless persistence is the question. Keep logic independent of the page. Do not ship the HTML shell to production.
