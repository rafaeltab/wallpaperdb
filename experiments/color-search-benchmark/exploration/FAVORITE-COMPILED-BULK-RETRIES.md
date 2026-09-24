# Compiled-index admission retries

The first numeric-points real index stopped after200 acknowledged documents when OpenSearch returned a whole HTTP429 parent circuit-breaker error while reserving memory for `<http_request>`. This is a rejected admission, before item execution. That failed index and its receipt remain evidence; subsequent builds use a new index and output directory.

The [OpenSearch2.11 REST controller](https://github.com/opensearch-project/OpenSearch/blob/2.11/server/src/main/java/org/opensearch/rest/RestController.java#L264-L305) reserves the request bytes with that label before invoking the request handler. This ordering supports retrying this narrowly identified rejection. It does not justify retrying an arbitrary HTTP429 returned later during execution.

`favorite-compiled-index.mjs` now makes at most **six attempts per identical create batch**, waiting1,2,4,8,10 seconds between eligible failures. The shared request helper and both encoders are unchanged.

Only a complete, parseable `OpenSearch 429: {...}` error with top-level `circuit_breaking_exception` and the exact parent/`<http_request>` reason is eligible. Any supplied root causes must agree. Truncated or unknown errors fail closed. HTTP200 partial bulk failures,409 conflicts, timeout/network failures, and breakers raised during bulk execution are never retried. Every returned item must acknowledge its original ID with status201 before the batch contributes to the indexed count. A conflict after an eligible retry still fails the build conservatively.

Each build writes external `retries.jsonl` events for attempt start, failure and accepted acknowledgement. Every event includes the batch ordinal, attempt, complete ID list, request body hash and byte count. Failure events retain the error, admission classification, planned delay and retry decision; invalid bulk acknowledgements also retain the complete response and response hash. `batches.jsonl` includes successful attempt count and total elapsed time including retries. `index.json` records attempts, retries, attempted bytes, admission rejections, request errors, acknowledgement failures and scheduled wait milliseconds. Original batch/document counters count accepted batches once.

Total indexing time includes delays and journaling. Retries do not resume failed indexes, overwrite existing documents, change scoring or conceal failed attempts. Exhaustion leaves a failed receipt. This mechanism addresses temporary admission pressure; it does not establish sustained full-schema capacity.

Validation is entirely offline using injected requests and sleep:

```sh
make color-favorite-compiled-index-test
```

Nine tests pass, including identical create payloads, bounded backoff, terminal error identity, partial acknowledgements, incorrect IDs, conflicts and uncertain outcomes. No OpenSearch requests were issued to test the retry code.
