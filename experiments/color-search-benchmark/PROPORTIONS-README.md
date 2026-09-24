# Color proportions — interactive prototype

Try arbitrary color percentages against the same **100 real wallpapers**, or switch to **16 controlled examples** with known compositions. This is a throwaway ranking experiment, separate from the application.

## Run

From the repository root with the normal workspace dependencies installed:

```sh
make color-proportions-serve
```

Open **http://localhost:8220/proportions.html**. The command verifies/downloads the pinned corpus, prepares palettes and controlled examples, checks ratio semantics, and starts a local server. If this prototype server is already running, it prints its address. No database or event service is required. Stop a foreground server with Ctrl-C.

### Access from another device on the tailnet

The default listener uses localhost. To listen on this machine's Tailscale IPv4 address instead:

```sh
COLOR_PROPORTIONS_HOST="$(tailscale ip -4)" make color-proportions-serve
```

From the other device, open `http://zerotwo:8220/proportions.html` (or replace `zerotwo` with this server's Tailscale IP or full MagicDNS name). Keep the server process running. If testing on the server itself, use the printed Tailscale IP URL: its local hostname may resolve to a loopback address. `COLOR_PROPORTIONS_HOST` controls the listen address; the default remains `127.0.0.1`.

## Try it

1. Start with **40% green**. The other 60% may contain other colors, but extra green counts against the match. With the same shades, 40% green beats 80% green.
2. Try **50% green / 50% red**, **80% red / 20% black**, or **five colors at 20% each**. Edit any shade and percentage; add up to ten color rows. Totals above 100% are rejected.
3. Under **Images to search**, select the controlled examples. Exact compositions should win there. These synthetic stripes are separate from the 100 real-image evaluation.
4. Compare the two result columns. Each can use perceptual transport, direct coverage error, or the earlier palette presence score. The earlier score treats percentages as importance weights and cannot express exact proportions.
5. Expand **Color tolerance and matching behavior** to explore the balance between an exact shade and neighboring shades. Exact proportions are the default; “at least” is an optional comparison mode.

The palette strip summarizes each image. The percentages below it are **approximate color-area estimates**, with each palette portion assigned exclusively to its nearest requested shade and weighted by similarity. They are not literal segmented pixel counts. Match cost is a separate ranking objective: zero is best, and even the best available result can be poor. Scores from different methods are not interchangeable.

The editor preserves queries in the URL; **Copy query link** includes colors, percentages, matching mode, tolerance, methods, and dataset. Source links identify each real image. The browser scores every image in the selected dataset, so candidate retrieval cannot hide a better result in this experiment.

## Reproduce the evaluation

```sh
make color-proportions                    # data + controlled diagnostics
make color-proportions-audit              # independent transport solver audit
make color-proportions-evaluate           # prepare data + evaluate all 100 images
make color-proportions-format             # format only this prototype's sources
```

Evaluation builds 64- and 128-color reference palettes and independently sampled CIELAB pixel references. The first run builds a local cache; subsequent runs reuse it when its provenance matches. Originals, thumbnails, cache, and screenshots live in ignored directories. Source URLs and checksums, palettes, numeric results, and written findings are retained.

## What to read

- [Findings and remaining limitations](PROPORTIONS-FINDINGS.md)
- [Full real-image evaluation](PROPORTIONS-EVALUATION.md) and [machine-readable rankings](proportions-evaluation.json)
- [Mathematical design and solver audit](PROPORTIONS-DESIGN.md)
- [Controlled diagnostics](proportions-diagnostics.json) and [independent audit results](proportions-audit.json)
- [Browser checks](PROPORTIONS-BROWSER-CHECK.md)
- [Durable work log](PROPORTIONS-WORKLOG.md)
- [Earlier cosine/L2 experiment](README.md)

## Implementation boundary

`proportions.mjs` is a dependency-free scorer shared by the browser and evaluation scripts. Its input is a weighted OKLab image palette plus absolute requested fractions:

```js
scorePalette(image.palette, [
  { color: '#008040', amount: 0.4 },
], { mode: 'target', method: 'transport', tolerance: 0.06 });
```

The remaining fraction is inferred; partial queries are never normalized to 100%. Duplicate hex colors merge. The transport solver allocates each image portion once and penalizes color differences, shortages, and excess requested colors. See the design notes for the exact objective and its limits.

`proportions-prepare.ts` uses the existing palette extractor. `proportions-ui.mjs` renders the standalone editor. Production gateway, extractor, OpenSearch mappings, and NATS contracts are unchanged. This prototype establishes a query/scoring model; production retrieval, backfill, and API work require a separate implementation.
