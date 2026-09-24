# Favorite optimization lab

Throwaway visual comparison for the preserved strict-hue favorite and execution/encoding prototypes. Start with `make color-favorite-lab`; it binds `0.0.0.0:8228`. The original inspector on 8227 is independent.

- Sixteen selectable methods retain OpenSearch's hit order and score. Searches run sequentially.
- Shared controls use 256 bins, quality influence 0/0.5/1, cutoff weighting 0/1/3, picked colors or named vibes, and target proportions in 5% steps. The saved favorite defaults are quality 0.5 and cutoff weighting 1.
- The gallery excludes controlled fixtures. The full index must nevertheless contain all known corpus IDs, including fixtures, for evaluations to remain comparable.
- Utility searches inspect fixed real-corpus indexes: original encodings use `color-exploration-favorite-opt-real-v4`, precision encodings use `color-exploration-favorite-precision-real-v1`, and numeric point methods use `color-exploration-favorite-points-real-v2`. Their UUID, definition, encoding and control presets are checked. A new index generation must pass document-count and complete-ID membership checks before a search runs. A `favorite`-only index rejects nondefault controls; an `all`-preset index enables every listed setting.
- The sixteenth method, **Global maxima bounds**, retains the original bounded score and adds necessary per-color ranges from global maxima in the same snapshot. It has its own executor and checks both numeric points and keyword ID doc values. Duplicate utility fields keep the original bound. Existing fifteen entries are unchanged.
- Precomputation and reduced-precision variants are explicitly labeled. The displayed small-corpus latency is not a million-document performance claim.
- Optional live updates debounce edits and cancel older requests. Edited queries mark previous results stale until their replacement arrives.

Focused verification: `make color-favorite-lab-test` covers request constraints, global service order, fixture exclusion, index/preset/encoding guards, generation-aware corpus validation, and HTTP responses. Browser and real-service checks are coordinated by the main optimization campaign; no service was started by this UI implementation task.
