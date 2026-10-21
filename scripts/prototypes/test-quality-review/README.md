# Advisory test review prototype, issue 420

This opt-in experiment asks whether a context-aware reviewer can find test meaning and maintenance defects without objecting to valid interaction contracts or source-analysis tests. It does not change repository policy, production tests, CI, or publish review comments. The evidence and adoption decision belong to [issue 420](https://github.com/rafaeltab/wallpaperdb/issues/420).

Run commands from the repository root after the normal [checkout setup](../../../CONTRIBUTING.md). Offline controls require Node only through the existing Make/package runner. Live reviews require an authenticated `codex` executable. The measured version is in each evidence manifest. The runner follows the [official non-interactive CLI procedure](https://learn.chatgpt.com/docs/non-interactive-mode).

```sh
# Protocol controls, including deliberately invalid reviewer output, and all green seeded suites.
make run PACKAGE=scripts SCRIPT=prototype:test-quality:test

# Execute only the frozen seeded test suites, with no model call.
make run PACKAGE=scripts SCRIPT=prototype:test-quality ARGS=controls

# Three fresh, paid/subscription reviews. Use a new, absent absolute directory each time.
make run PACKAGE=scripts SCRIPT=prototype:test-quality ARGS='run --live --out /tmp/test-quality-new-evaluation --repeats 3'

# Recompute committed evaluation metrics without model access.
make run PACKAGE=scripts SCRIPT=prototype:test-quality ARGS='report --out prototypes/test-quality-review/evidence/final'
```

`make run` executes inside `scripts`, so relative `--out`, `--packet` and `--judgments` paths are relative to that workspace. The default packet and judgments paths are independent of the working directory. `prepare` explicitly refreshes the packet using Git and `gh`; do not run it to replay frozen evidence. It reads the pinned baseline and full issue bodies, comments and labels, so refreshed issue context can change the prompt.

## Review procedure

1. `packet.json` contains complete selected test/helper and production files, selected test/production changes, requirements, and the relevant authoritative standards. Case scope states the owning boundary. Lines are numbered in the reviewer prompt. Review snapshots as a whole rather than treating a test diff as complete context.
2. `rubric.txt` defines supported categories, evidence requirements, exceptions, and optional nesting/snapshot observations. No finding quota is imposed. Seed labels in `corpus.mjs` stay outside the reviewer prompt.
3. `cli.mjs run --live` launches independent ephemeral CLI sessions in empty temporary directories. It ignores user/project configuration and rules, disables shell tools, requests read-only operation and schema-constrained JSON, and rejects detected tool use. Only public repository context is supplied. This is a packet review, not an interactive repository explorer or an OS security boundary.
4. Each review has a 180-second timeout, 250,000-byte prompt limit, 2 MiB captured output limit, and 30-finding maximum. A run accepts one through three reviews and executes serially. There are no automatic retries. Output directories must be new. Transport/schema/evidence failures stop the experiment and remain failed output, never clean results.
5. Each finding supplies a case/category, test citation, supporting requirement/code/standard citation, concrete failure or maintenance dependency, and focused correction. Quotes must match exact original lines. Mechanical validation checks evidence existence; it cannot prove that the reasoning is correct.
6. A person classifies each distinct claim with a rationale. `judgments.json` accepts `key`, `verdict` of `actionable` or `false-positive`, `judgeKind` of `human`, and `rationale`. Record the judge and source response too. Agent judgments may be stored with `judgeKind: agent`; they never count toward human precision. Leave uncertain judgments absent. Re-run `report` after classification.

The requested model is `gpt-6.1-sol`, with low reasoning effort and CLI 0.162.1. The manifest records these settings and SHA-256 digests of the exact packet, prompt and output schema. The CLI exposes an alias, not immutable model weights or a backend snapshot version. No deterministic seed or temperature guarantee is claimed. Identical requests can vary.

## Evaluation set

The baseline is `5953aad569a62fff1b050c21e6c3123e2afbc6de`. Three real suites cover frontend Profile management, signed backend pagination cursors with controlled-adapter parity, and frontend source-analysis tooling. They execute 52 repository tests. These are a purposeful small sample, not a random or comprehensive inventory.

Ten executable seeded suites contain six defects, three clean controls and one optional nesting case. All seeded tests pass, so green execution alone does not reveal the quality defects. Seeds cover a missing specified failure, a circular expectation, private storage, hidden helper data, unrelated policies in one test, and duplicated behavior at a wider boundary. Clean controls cover meaningful write-port interactions, legitimate source-text assertions, and a 55-line snapshot that intentionally freezes a public export. No mutation testing is included.

Required detection uses the six predeclared case/category keys in `corpus.mjs`. Optional warnings are not required defects. Clean-control flag rates measure the declared control expectations, not human precision. The test runner never changes production tests.

## Metrics and interpretation

`report` requires every configured review to complete validly. Findings are conservatively grouped by case/category across runs. Different wording, repeated copies and multiple citations do not increase the independent denominator. This grouping can merge distinct subclaims and therefore understate their number. A human must split genuinely independent claims before any larger enforcement study.

Repeatability is pairwise Jaccard overlap of grouped claim sets, plus occurrence lists for each claim. Seed misses are missing required keys per run. Clean-control flags are listed per control and run. Human precision is actionable / classified unique findings; its complement is the false discovery proportion, distinct from the fraction of clean cases flagged. Pending and agent judgments contribute to neither. A blank judgment file yields `null` precision, not 100%.

The 95% actionable threshold over a representative sample of 50 independently judged findings remains unvalidated for this small curated corpus, regardless of its observed hit rate. The report deliberately cannot approve stronger enforcement.

Token usage and measured runtime come from each CLI completion and the parent process timer. Cached tokens are included in input tokens and must not be added again; reasoning output is a reported subset, not extra output. Subscription billing does not expose a per-run charge here. Do not invent a USD price or call token usage free. Context preparation, implementation work, and human review time are separate costs.

`evidence/calibration` preserves the earlier, smaller-context three-run experiment and its exact prompt. `pilot-invalid-run.json` records an earlier validator rejection of a legitimate helper citation. That validator was corrected before calibration. Final evaluation adds originating issues 338, 170 and 122 and a scoped cursor production diff; context rounds must not be pooled as repeatability trials or independent findings. Include all model calls in total experiment cost.

## Human feedback and contextual controls

`human-feedback.json` records the requesting user's response to the simplified illustrations. Examples 2 and 8 repeat one concern, so there are eight distinct principle responses. The user supports precise outcomes, separating unrelated scenarios, public-interface assertions, explicit helper inputs, and avoiding redundant wider matrices. The response qualifies round-trip and repeated-call warnings and requires successful and failed input classes to be tested at their appropriate owning boundary. This is human feedback on review usefulness and conditions, not verification of the original repository findings; `judgments.json` and human precision remain unchanged.

The revised rubric must inspect surrounding independent encode/decode tests before criticizing a round trip. It permits explicit repeatability/idempotency invariants and comparison of generated POST input with a GET result. Business input matrices belong at their narrow public unit/capability/workflow owner. Wider tests cover their distinct translation/infrastructure/lifecycle guarantees and failures. This does not require reproducing the full business matrix at every integration boundary.

`feedback-packet.json` freezes four additional clean controls: an independently checked encoder/decoder plus round trip, an explicitly stable opaque key, generated input preserved through POST/GET, and uppercase/lowercase successes plus failed input classes at a narrow policy with focused wider outcome translation. Two original seeded defects remain to check that exceptions do not hide missing failures or a circular expectation. Packet-local grading metadata is withheld from the reviewer prompt. Historical evidence retains its original prompt; the revised rubric is evaluated separately.

```sh
make run PACKAGE=scripts SCRIPT=prototype:test-quality ARGS='controls --packet prototypes/test-quality-review/feedback-packet.json'
make run PACKAGE=scripts SCRIPT=prototype:test-quality ARGS='run --live --packet prototypes/test-quality-review/feedback-packet.json --out /tmp/test-quality-feedback-new --repeats 3'
make run PACKAGE=scripts SCRIPT=prototype:test-quality ARGS='report --packet prototypes/test-quality-review/feedback-packet.json --out prototypes/test-quality-review/evidence/feedback'
```

Pass `--packet` when reporting the follow-up set so its own two seeded defects and four controls determine the denominators. Do not pool the follow-up runs with the original runs for repeatability or independent precision. Decisions about numeric readability warnings are still open.

## Limits and adoption decisions

The seeds are conspicuous and the wider-boundary wrapper is synthetic. The three real suites are existing snapshots with selected historical changes, not a representative sample of live PRs. Requirements from large originating issues are explicitly scoped to the selected owner; other modules and system outcomes are outside each case. Source analysis uses coding standards as its contract, with related issue context rather than a recovered original standalone tooling spec.

Citation existence is weaker than requirement correctness. Existing suite completeness outside supplied files, drift after the pinned baseline, prompt changes, model alias changes, and human disagreement require further evaluation. Broad issue context increases latency and can induce scope errors. Optional numeric warnings can create style-only noise. A clean review proves neither completeness nor correctness.

Use the issue's evidence to choose a small voluntary rollout. A maintainer supplies the originating criteria and affected owner context, reviews findings locally, records actionable/false-positive/missed cases and review time, and keeps dismissal reasons. Start with missing specified outcomes and circular expectations; require human interpretation for interactions, helpers and boundary matrices. Decide separately whether readability advice saves enough time to retain. Keep numerical warnings optional. Any stronger enforcement needs the representative human-judged study and a new policy decision.
