# Interrupted full-million screen: file-only diagnosis

The screen stopped at 18:01:15.768 UTC during the maxima-bounded, single-color,
concurrency-16 profile. Eleven earlier profiles completed. The interrupted profile
retains 12,285 requests: 4,794 successes and 7,491 generic `fetch failed` errors.
No request in that interrupted profile reached one second; its many transport
errors still make it a failed result.

The first recorded error is ordinal 3033 (the smallest failing ordinal is 3009
because requests complete out of order). There were 1,769 further successes after
that first recorded error; the last recorded success is ordinal 11193. Error p95
was 10.91 ms, much faster than a search timeout. The final successful resource
sample starts at 18:01:15.755 UTC, immediately before the terminal resource fetch.
Raw trials have no wall timestamps or nested exception causes, so an exact
first-error time cannot be recovered. Resource-sample gaps begin around 18:01:09.

Saved kernel samples from 18:00:50–18:01:24 show roughly 9.65 GiB container charge,
4.597 GiB anonymous pages, 4.851 GiB file cache and 0.797 GiB swap. Memory-limit,
OOM and OOM-kill counters are unchanged; memory-pressure totals are flat. JVM heap
cycles normally and is 18% in the final sample, with old heap around 778 MB. Search
queue and rejections remain zero. PIT/open-context counts rise from roughly the
active concurrency to 33 after failures; that may reflect failed cleanup, and is
not evidence of a large preexisting leak. FD/socket/conntrack metrics were not
captured in these saved files.

## Concrete connection-churn mechanism

The installed runtime is Node22.22.3 with Undici6.24.1. Its HTTP/1 writer treats
DELETE as a method not expected to carry a payload. Sending a body on that method
marks the socket for reset unless request.reset is explicitly false. Our PIT
cleanup uses DELETE with a JSON body. The code therefore explains a new HTTP
connection per cleanup under the default fetch transport. It does **not** by
itself establish why the observed ECONNRESET failures began.

The exact local runtime excerpts and full embedded-source hash are preserved in
`runtime-transport-evidence.json`; no internal runtime API is proposed for actual
transport implementation. Public, version-pinned sources:

- [Undici6.24.1 HTTP/1 writer](https://github.com/nodejs/undici/blob/v6.24.1/lib/dispatcher/client-h1.js)
- [Undici6.24.1 Dispatcher options](https://github.com/nodejs/undici/blob/v6.24.1/docs/docs/api/Dispatcher.md)
- [Node22.22.3 pooled HTTP agent](https://nodejs.org/download/release/v22.22.3/docs/api/http.html#class-httpagent)

A controlled A/B should preserve the same executor bodies, total deadline and
cleanup reserve, make no retries, and change only cleanup transport to a pooled
DELETE implementation. Capture nested transport causes, method/stage,
request/response Connection headers, socket reuse and HTTP connection counters,
plus host TCP state and available ephemeral ports before/during/after. Do not
infer exhaustion from post-recovery counters and do not change host sysctls.

`diagnosis.json` records raw counts, ordinal buckets, resource timeline, source
and artifact hashes. `kernel-window.json` preserves the selected kernel evidence.
The original failed benchmark and request artifacts remain untouched.

Embedded runtime source SHA256: `590b397c3ef9b1310b17214196319ede352f8c782ddfb6f3d1635f8b6d65445c`.
