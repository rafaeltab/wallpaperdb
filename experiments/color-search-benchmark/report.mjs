// PROTOTYPE: turn the recorded benchmark into a self-contained visual review.
// Run with make color-benchmark-report; no framework or remote assets required.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const results = JSON.parse(
	await readFile(new URL("results.json", root), "utf8"),
);
const reportData = {
	generatedAt: results.generatedAt,
	gitCommit: results.gitCommit,
	version: results.opensearch?.version?.number,
	corpus: results.corpus,
	queries: results.queries,
	algorithms: results.algorithms,
	relevance: results.relevance,
	rankings: results.rankings,
	perQuery: results.perQuery,
	summaries: results.summaries,
	maxScoreError: results.maxScoreError,
};
// JSON lives in a script element: escape markup and JS line separators before embedding.
const embedded = JSON.stringify(reportData).replace(
	/[<>&\u2028\u2029]/g,
	(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
);

function client() {
	const data = JSON.parse(
		document.getElementById("benchmark-data").textContent,
	);
	const byId = new Map(data.corpus.map((entry) => [entry.id, entry]));
	const algorithmById = new Map(
		data.algorithms.map((entry) => [entry.id, entry]),
	);
	const metrics = {
		lab20: "Lab radius 20",
		lab30: "Lab radius 30",
		lab40: "Lab radius 40",
		hsv: "HSV neighborhood",
	};
	const $ = (id) => document.getElementById(id);
	const percent = (value) =>
		Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : "—";
	const fixed = (value) => (Number.isFinite(value) ? value.toFixed(3) : "—");
	const node = (tag, className, text) => {
		const element = document.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	};
	const safeUrl = (value) =>
		/^(https?:\/\/|corpus\/|\.\/)/.test(value ?? "") ? value : "#";
	const link = (text, href, className) => {
		const element = node("a", className, text);
		element.href = safeUrl(href);
		element.target = "_blank";
		element.rel = "noopener noreferrer";
		return element;
	};
	const option = (select, value, label) => {
		const entry = node("option", "", label);
		entry.value = value;
		select.append(entry);
	};
	const state = {
		query: "",
		left: "",
		right: "",
		third: "",
		metric: "lab30",
		split: "holdout",
	};
	let blind = false;
	let columnOrder = [0, 1, 2];

	function readUrl() {
		const params = new URLSearchParams(location.search);
		state.query = data.queries.some((query) => query.id === params.get("q"))
			? params.get("q")
			: data.queries[0].id;
		state.left = algorithmById.has(params.get("left"))
			? params.get("left")
			: "cosine-default";
		state.right = algorithmById.has(params.get("right"))
			? params.get("right")
			: algorithmById.has("palette32-06")
				? "palette32-06"
				: data.algorithms[1].id;
		state.third = algorithmById.has(params.get("third"))
			? params.get("third")
			: "";
		state.metric = Object.hasOwn(metrics, params.get("metric"))
			? params.get("metric")
			: "lab30";
		state.split = ["all", "development", "holdout"].includes(
			params.get("split"),
		)
			? params.get("split")
			: "holdout";
	}
	function saveUrl() {
		const url = new URL(location.href);
		for (const [key, value] of Object.entries({
			q: state.query,
			left: state.left,
			right: state.right,
			metric: state.metric,
			third: state.third,
			split: state.split === "holdout" ? "" : state.split,
		}))
			value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		// Some browsers restrict history updates for file:// documents. The report still works.
		try {
			history.replaceState(null, "", url);
		} catch {
			/* Local-file browser restriction. */
		}
	}
	function description(algorithm) {
		if (algorithm.id === "hellinger")
			return "Square-root probability histograms; cosine ranks by Hellinger distance.";
		if (algorithm.palette)
			return `Weighted 32-color OKLab palette; Gaussian affinity (σ ${algorithm.sigma}); multi-color geometric mean.`;
		if (algorithm.field === "rgb512")
			return `512 RGB bins; weighted OKLab Gaussian affinity (σ ${algorithm.sigma}); inner product.`;
		if (algorithm.metric === "cosinesimil")
			return `64 HSV bins; cosine = dot / (image norm × query norm), σ ${algorithm.sigma ?? ".30"}.`;
		if (algorithm.metric === "innerproduct")
			return `64 HSV bins; sum of image mass × color affinity, σ ${algorithm.sigma ?? ".30"}.`;
		if (algorithm.metric === "l1")
			return "Sum of absolute probability differences; equivalent ranking to histogram overlap.";
		if (algorithm.metric === "linf")
			return "Largest absolute bin difference between unit-sum histograms.";
		if (algorithm.metric === "l2")
			return `Sum of squared bin differences; ${algorithm.normalize ? "unit-sum query" : "unchanged, unnormalized production query"}.`;
		return algorithm.label;
	}
	function queryMetric(algorithm) {
		return data.perQuery.find(
			(row) =>
				row.query === state.query &&
				row.metric === state.metric &&
				row.algorithm === algorithm,
		);
	}
	function coverage(id) {
		return data.relevance[state.query]?.[id]?.[state.metric] ?? 0;
	}
	function qualifies(id) {
		const measured = data.relevance[state.query]?.[id];
		return (
			measured?.perColor?.every((color) => color[state.metric] >= 0.1) ?? false
		);
	}
	function matchCard(hit, rank) {
		const wallpaper = byId.get(hit.id);
		const value = coverage(hit.id);
		const card = node("article", "match");
		const pictureLink = link("", wallpaper.filename, "picture-link");
		const image = node("img");
		image.src = safeUrl(wallpaper.thumbnail ?? wallpaper.filename);
		image.alt = wallpaper.title;
		image.loading = rank <= 5 ? "eager" : "lazy";
		image.width = 220;
		image.height = 124;
		pictureLink.append(image);
		const info = node("div", "match-info");
		info.append(node("div", "rank", `#${rank} · ${wallpaper.id}`));
		info.append(node("h4", "match-title", wallpaper.title));
		info.append(
			node(
				"div",
				qualifies(hit.id) ? "coverage positive" : "coverage",
				`${percent(value)} coverage`,
			),
		);
		const perColor = data.relevance[state.query]?.[hit.id]?.perColor ?? [];
		if (perColor.length > 1) {
			info.append(
				node(
					"div",
					"raw-score",
					`Each color: ${perColor.map((color) => percent(color[state.metric])).join(" / ")}`,
				),
			);
		}
		const meter = node("div", "meter");
		meter.setAttribute("aria-hidden", "true");
		const fill = node("span");
		fill.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
		meter.append(fill);
		info.append(meter);
		info.append(
			node(
				"div",
				"raw-score method-detail",
				`Ranking score ${hit.score.toPrecision(5)}`,
			),
		);
		const source = link(
			"Source ↗",
			wallpaper.sourcePage ?? wallpaper.sourceUrl,
			"source",
		);
		source.setAttribute("aria-label", `Source for ${wallpaper.title}`);
		info.append(source);
		card.append(pictureLink, info);
		return card;
	}
	function renderColumn(id, position) {
		const algorithm = algorithmById.get(id);
		const ranking = data.rankings[state.query][id];
		const section = node("section", "comparison-column");
		const title = blind
			? `Method ${String.fromCharCode(65 + position)}`
			: algorithm.label;
		section.append(node("h3", "", title));
		section.append(node("p", "formula method-detail", description(algorithm)));
		const measurement = queryMetric(id);
		if (measurement) {
			const stats = node("div", "column-stats");
			stats.append(node("span", "", `nDCG@10 ${fixed(measurement.ndcg10)}`));
			stats.append(
				node("span", "", `P@10 ${percent(measurement.precision10)}`),
			);
			stats.append(
				node(
					"span",
					"",
					`Mean coverage ${percent(measurement.meanCoverage10)}`,
				),
			);
			section.append(stats);
		}
		ranking
			.slice(0, 5)
			.forEach((hit, index) => section.append(matchCard(hit, index + 1)));
		const more = node("details", "more-matches");
		more.append(node("summary", "", "Show ranks 6–10"));
		ranking
			.slice(5, 10)
			.forEach((hit, index) => more.append(matchCard(hit, index + 6)));
		section.append(more);
		return section;
	}
	function renderSummary() {
		const rows = data.summaries
			.filter((row) => row.split === state.split && row.metric === state.metric)
			.sort((a, b) => (b.ndcg10 ?? -1) - (a.ndcg10 ?? -1));
		const baseline = rows.find((row) => row.algorithm === "cosine-default");
		const body = $("summary-body");
		body.replaceChildren();
		rows.forEach((row) => {
			const tr = node(
				"tr",
				row.algorithm === "cosine-default" ? "baseline-row" : "",
			);
			const method = node("th");
			method.scope = "row";
			method.append(
				node(
					"span",
					"",
					algorithmById.get(row.algorithm)?.label ?? row.algorithm,
				),
			);
			const compare = node("button", "small-button", "Compare");
			compare.setAttribute(
				"aria-label",
				`Compare ${algorithmById.get(row.algorithm)?.label ?? row.algorithm} with current`,
			);
			compare.addEventListener("click", () => {
				state.left = "cosine-default";
				state.right = row.algorithm;
				render();
				$("comparison-heading").scrollIntoView({
					behavior: "smooth",
					block: "start",
				});
			});
			method.append(compare);
			tr.append(method, node("td", "", fixed(row.ndcg10)));
			const delta =
				Number.isFinite(row.ndcg10) && Number.isFinite(baseline?.ndcg10)
					? row.ndcg10 - baseline.ndcg10
					: null;
			tr.append(
				node(
					"td",
					delta > 0 ? "positive" : "",
					delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`,
				),
			);
			tr.append(
				node("td", "", percent(row.precision10)),
				node("td", "", percent(row.meanCoverage10)),
				node("td", "", percent(row.top1Coverage)),
				node("td", "", String(row.queries)),
			);
			body.append(tr);
		});
		const total = data.queries.filter(
			(query) => state.split === "all" || query.split === state.split,
		).length;
		const judged = rows[0]?.queries ?? 0;
		$("summary-note").textContent =
			`${metrics[state.metric]} · nDCG is defined for ${judged}/${total} queries with nonzero ideal relevance. P@10 and coverage average all ${rows[0]?.totalQueries ?? total} queries, including zero-match queries. Available P@10 ceiling: ${percent(rows[0]?.attainablePrecision10)}. The holdout separates queries on the same 100 images; it does not test unseen-image generalization.`;
	}
	function renderGallery() {
		const gallery = $("gallery");
		gallery.replaceChildren();
		data.corpus.forEach((wallpaper) => {
			const figure = node("figure");
			const picture = link("", wallpaper.filename);
			const image = node("img");
			image.src = safeUrl(wallpaper.thumbnail ?? wallpaper.filename);
			image.alt = wallpaper.title;
			image.loading = "lazy";
			image.width = 320;
			image.height = 180;
			picture.append(image);
			const caption = node("figcaption");
			caption.append(
				node(
					"strong",
					"",
					`${wallpaper.id} · ${percent(coverage(wallpaper.id))}`,
				),
			);
			caption.append(node("span", "", wallpaper.title));
			caption.append(
				link(
					`${wallpaper.category} · source ↗`,
					wallpaper.sourcePage ?? wallpaper.sourceUrl,
				),
			);
			figure.append(picture, caption);
			gallery.append(figure);
		});
	}
	function render() {
		for (const key of ["left", "right", "third", "metric", "split"])
			$(key).value = state[key];
		$("query").value = state.query;
		const query = data.queries.find((entry) => entry.id === state.query);
		const swatches = $("query-swatches");
		swatches.replaceChildren();
		const total = query.colors.reduce((sum, color) => sum + color.amount, 0);
		query.colors.forEach((color) => {
			const chip = node("span", "color-chip");
			const swatch = node("span", "swatch");
			if (/^#[0-9a-f]{6}$/i.test(color.color))
				swatch.style.backgroundColor = color.color;
			chip.append(
				swatch,
				node(
					"span",
					"",
					`${color.color} · ${percent(color.amount / total)} weight`,
				),
			);
			swatches.append(chip);
		});
		swatches.append(node("span", "split-badge", query.split));
		const available = data.corpus.filter((wallpaper) =>
			qualifies(wallpaper.id),
		).length;
		const everyColor =
			query.colors.length > 1 ? "for every requested color" : "";
		$("availability").textContent = available
			? `${available} / ${data.corpus.length} wallpapers reach 10% ${metrics[state.metric].toLowerCase()} coverage ${everyColor}. Best possible P@10: ${percent(Math.min(10, available) / 10)}.`
			: `No wallpapers reach 10% ${metrics[state.metric].toLowerCase()} coverage ${everyColor}. These are ranked suggestions; this query has no qualifying matches at that threshold.`;
		$("availability").className = available
			? "availability"
			: "availability no-match";
		$("multi-note").hidden = query.colors.length < 2;
		document.body.classList.toggle("blind", blind);
		$("blind-toggle").textContent = blind
			? "Reveal algorithms"
			: "Start blind comparison";
		$("blind-note").hidden = !blind;
		$("summary-section").hidden = blind;
		const columns = $("comparison");
		const selected = [state.left, state.right, state.third].filter(Boolean);
		const ordered = blind
			? columnOrder
					.filter((index) => index < selected.length)
					.map((index) => selected[index])
			: selected;
		columns.style.setProperty("--columns", ordered.length);
		columns.replaceChildren(...ordered.map(renderColumn));
		renderSummary();
		if ($("corpus-section").open) renderGallery();
		saveUrl();
	}

	data.queries.forEach((query) =>
		option(
			$("query"),
			query.id,
			`${query.id.replaceAll("-", " + ")} · ${query.split}`,
		),
	);
	for (const key of ["left", "right", "third"]) {
		if (key === "third") option($(key), "", "None — two columns");
		data.algorithms.forEach((algorithm) =>
			option($(key), algorithm.id, algorithm.label),
		);
	}
	Object.entries(metrics).forEach(([value, label]) =>
		option($("metric"), value, label),
	);
	for (const key of ["query", "left", "right", "third", "metric", "split"]) {
		$(key).addEventListener("change", () => {
			state[key] = $(key).value;
			render();
		});
	}
	$("blind-toggle").addEventListener("click", () => {
		blind = !blind;
		if (blind) {
			columnOrder = [0, 1, 2];
			for (let i = columnOrder.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[columnOrder[i], columnOrder[j]] = [columnOrder[j], columnOrder[i]];
			}
		}
		render();
	});
	$("corpus-section").addEventListener("toggle", () => {
		if ($("corpus-section").open) renderGallery();
	});
	window.addEventListener("popstate", () => {
		readUrl();
		render();
	});
	$("run-meta").textContent =
		`${data.corpus.length} wallpapers · ${data.queries.length} queries · ${data.algorithms.length} algorithms · OpenSearch ${data.version ?? "unknown"} · ${new Date(data.generatedAt).toLocaleString()}`;
	$("commit").textContent =
		`Source commit ${data.gitCommit?.slice(0, 12) ?? "unknown"} · max OpenSearch/local score error ${data.maxScoreError?.toExponential(2) ?? "unknown"}`;
	readUrl();
	render();
	document.documentElement.dataset.reportReady = "true";
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wallpaper color search · 100-image comparison</title>
<style>
:root{color-scheme:light;font:15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18232e;background:#f4f6f8}*{box-sizing:border-box}body{margin:0}main{max-width:1560px;padding:26px 30px 60px;margin:auto}h1{font-size:30px;letter-spacing:-.8px;margin:4px 0 8px}h2{font-size:21px;margin:0}h3{font-size:16px;line-height:1.35;margin:0 0 7px}p{margin:7px 0}a{color:#175aae;text-underline-offset:3px}button,select{font:inherit;color:inherit;border:1px solid #b9c5d0;border-radius:6px;background:white;padding:8px 10px}button{cursor:pointer}button:hover{background:#e9f2ff}button:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #428cef;outline-offset:3px}select{width:100%;min-width:0}label{display:block;font-size:12px;font-weight:650;color:#41536a;margin-bottom:5px}.eyebrow{text-transform:uppercase;letter-spacing:1.5px;color:#49617b;font-weight:700;font-size:11px}.muted,#run-meta,#commit{color:#566679;font-size:13px}.intro{display:flex;gap:20px;justify-content:space-between;align-items:flex-start}.links{font-size:13px;display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.notice{border-left:3px solid #5478a4;background:#eaf0f6;padding:10px 13px;margin:16px 0;font-size:13px}.toolbar{display:grid;grid-template-columns:minmax(220px,1fr) minmax(200px,1fr) auto;gap:16px;align-items:end}.toolbar button{white-space:nowrap}.query-context{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px}#query-swatches{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.color-chip{display:flex;gap:7px;align-items:center;font-size:12px;font-variant-numeric:tabular-nums}.swatch{width:27px;height:27px;border-radius:6px;border:1px solid #aab5c1}.split-badge{font-size:11px;border-radius:20px;background:#e3e9f0;padding:3px 9px}.availability{font-size:13px;color:#41536a;padding:8px 0}.no-match{color:#8a4400;font-weight:600}#multi-note,#blind-note{font-size:12px;margin-top:0;color:#725515}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:24px 0 10px}.algorithm-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:12px 0}.comparison{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:18px}.comparison-column{min-width:0;background:white;border:1px solid #d5dde5;border-radius:9px;padding:14px}.formula{font-size:12px;line-height:1.35;color:#586c81;min-height:34px}.column-stats{display:flex;flex-wrap:wrap;gap:6px 13px;padding:8px 0 10px;font-size:11px;color:#53647b;font-variant-numeric:tabular-nums}.match{display:flex;gap:12px;border-top:1px solid #e6eaf0;padding:9px 0;min-height:119px}.picture-link{display:flex;align-items:center;justify-content:center;background:#edf0f3;width:44%;max-width:235px;flex-shrink:0;border-radius:4px;overflow:hidden}.picture-link img{width:100%;height:100px;object-fit:contain;display:block}.match-info{min-width:0;flex:1}.rank{font-size:10px;color:#66768a;letter-spacing:.2px}.match-title{font-size:12px;font-weight:600;line-height:1.25;margin:3px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.coverage{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:5px}.positive{color:#12684e}.meter{height:3px;background:#e6eaf0;border-radius:4px;overflow:hidden;margin:4px 0;width:100%}.meter span{display:block;background:#309677;height:100%}.raw-score,.source{font-size:10px}.raw-score{color:#66768a}.source{display:inline-block;margin-top:3px}.more-matches{margin-top:6px}.more-matches summary{font-size:12px;padding:8px 0;cursor:pointer;color:#175aae}#summary-section{margin-top:32px}.summary-heading{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:10px}.summary-heading select{width:190px}.table-wrap{overflow-x:auto;border:1px solid #d5dde5;border-radius:8px;background:white}table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;text-align:right;border-bottom:1px solid #e8edf2;white-space:nowrap}thead th{background:#eaf0f6;font-size:11px;color:#41536a}th:first-child{text-align:left}tbody th{font-weight:500;display:flex;justify-content:space-between;gap:12px;align-items:center}.baseline-row{background:#edf4ff}.small-button{font-size:10px;padding:3px 7px}.explanation{font-size:12px;color:#53647b;margin:10px 0}.methodology{margin-top:25px;border-top:1px solid #d5dde5;padding:16px 0}.methodology summary,#corpus-section>summary{font-weight:650;cursor:pointer}.methodology li{margin-bottom:6px;font-size:13px;max-width:1100px}#corpus-section{margin-top:25px}.gallery{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:17px;margin-top:15px}.gallery figure{margin:0;border:1px solid #d5dde5;border-radius:7px;background:white;overflow:hidden}.gallery img{width:100%;height:135px;object-fit:contain;display:block;background:#e8edf2}.gallery figcaption{padding:9px;font-size:11px}.gallery figcaption strong,.gallery figcaption span{display:block;margin-bottom:3px}.gallery figcaption span{line-height:1.3;min-height:28px}.blind .method-detail,.blind .algorithm-controls{display:none}.blind .comparison-column>h3{font-size:19px}[hidden]{display:none!important}footer{margin-top:35px;padding-top:16px;border-top:1px solid #d5dde5;font-size:12px;color:#53647b}noscript{display:block;padding:20px;background:#ffe9bf}
@media(max-width:1050px){main{padding:20px}.comparison{gap:10px}.comparison-column{padding:10px}.picture-link{width:42%}.match{gap:8px}.gallery{grid-template-columns:repeat(4,minmax(0,1fr))}.algorithm-controls{gap:10px}.toolbar{grid-template-columns:1fr 1fr}.toolbar button{grid-column:1/-1;justify-self:start}.match-title{font-size:11px}}
@media(max-width:700px){main{padding:16px 12px 35px}h1{font-size:25px}.intro{display:block}.toolbar{grid-template-columns:1fr 1fr;gap:10px}.algorithm-controls{grid-template-columns:1fr}.comparison{grid-template-columns:1fr}.picture-link{width:42%;max-width:210px}.picture-link img{height:110px}.match-title{font-size:13px}.match{min-height:126px}.gallery{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gallery img{height:105px}.summary-heading{align-items:flex-end}h2{font-size:18px}.summary-heading select{width:150px}.formula{min-height:0}.coverage{font-size:14px}}
@media print{main{max-width:none;padding:10px}.toolbar,.algorithm-controls,button,.links,.more-matches,#corpus-section{display:none}body{background:white}.comparison{grid-template-columns:repeat(var(--columns),minmax(0,1fr))}.comparison-column{break-inside:avoid}.notice{font-size:11px}}
</style></head><body><main>
<header class="intro"><div><div class="eyebrow">WallpaperDB · search experiment</div><h1>Does the color actually match?</h1><p id="run-meta"></p></div><nav class="links" aria-label="Experiment files"><a href="./FINDINGS.md">Findings</a><a href="./README.md">Reproduce</a><a href="./RESEARCH.md">Research</a><a href="./CORPUS.md">Corpus sources</a><a href="./results.json">Raw results</a><a href="./summary.json">Summary data</a></nav></header>
<div class="notice"><strong>Experimental comparison.</strong> Coverage and ranking metrics are independent proxies, not human ground truth. Inspect the wallpapers alongside the numbers. This report does not change production search.</div>
<section aria-labelledby="comparison-heading"><div class="section-heading"><h2 id="comparison-heading">Compare the matches</h2></div>
<div class="toolbar"><div><label for="query">Requested color / palette</label><select id="query"></select></div><div><label for="metric">Independent relevance measurement</label><select id="metric"></select></div><button id="blind-toggle" type="button">Start blind comparison</button></div>
<div class="query-context"><div id="query-swatches"></div></div><p id="availability" aria-live="polite"></p><p id="multi-note" hidden>Palette coverage uses a weighted geometric mean. A qualifying match requires at least 10% coverage for every requested color. These measurements do not judge palette proportions.</p><p id="blind-note" hidden>Columns are shuffled. Algorithm names, formulas, ranking scores, and the summary are hidden until reveal. Independent coverage remains visible.</p>
<div class="algorithm-controls"><div><label for="left">Left method</label><select id="left"></select></div><div><label for="right">Right method</label><select id="right"></select></div><div><label for="third">Optional third method</label><select id="third"></select></div></div>
<div id="comparison" class="comparison"></div><p class="explanation">Thumbnails show the complete image; click to open the original. Ranking scores are method-specific and cannot be compared across columns. Each column shows the top five, with ranks 6–10 available below.</p></section>
<section id="summary-section" aria-labelledby="summary-heading"><div class="summary-heading"><h2 id="summary-heading">Ranking quality across queries</h2><div><label for="split">Evaluation set</label><select id="split"><option value="holdout">Held-out queries</option><option value="development">Development queries</option><option value="all">All queries</option></select></div></div>
<div class="table-wrap"><table><thead><tr><th scope="col">Method</th><th scope="col">nDCG@10 ↑</th><th scope="col">Δ current</th><th scope="col">P@10 ↑</th><th scope="col">Mean coverage ↑</th><th scope="col">Top-1 coverage ↑</th><th scope="col">Queries</th></tr></thead><tbody id="summary-body"></tbody></table></div><p id="summary-note" class="explanation"></p>
<p class="explanation"><strong>nDCG@10:</strong> coverage-weighted ranking quality relative to the best possible order of this corpus (1 is best). <strong>P@10:</strong> fraction of the top ten with at least 10% measured coverage for every requested color. For several colors, graded “coverage” is the aggregate presence score. The default palette method was selected using development queries.</p></section>
<details class="methodology"><summary>How to read this experiment</summary><ul><li>CIELAB D65 measurements count alpha-weighted pixels within distance 20, 30, or 40 of the requested color. They use a separate, higher-resolution sample and no candidate histogram or palette.</li><li>The HSV proxy uses hue difference ≤25°, saturation and value differences ≤0.3. Grayscale queries use pixel saturation &lt;0.15 and value difference ≤0.2.</li><li>Multi-color relevance is the amount-weighted geometric mean of individual coverages; a missing color produces zero. This describes color presence rather than composition.</li><li>Thresholds and the development / holdout split were fixed before evaluating rankings. Comparing many alternatives still makes this an exploratory benchmark.</li><li>Exact OpenSearch searches compare all 100 candidates; native ANN checks are recorded in the raw data. Application palette scores are also evaluated over all 100. A production reranker would depend on candidate recall.</li><li>Recorded run times include experiment overhead. They are not production latency measurements, and 100 images cannot establish performance at scale.</li></ul><p class="explanation"><a href="https://docs.opensearch.org/2.11/search-plugins/knn/knn-score-script/" target="_blank" rel="noopener noreferrer">OpenSearch 2.11 exact scoring</a> · <a href="https://docs.opencv.org/4.13.0/d8/dc8/tutorial_histogram_comparison.html" target="_blank" rel="noopener noreferrer">Histogram comparison formulas</a> · <a href="./RESEARCH.md">Full methods and limitations</a></p></details>
<details id="corpus-section"><summary>Browse all ${results.corpus.length} wallpapers</summary><p class="explanation">Fixed corpus order. Coverage updates with the selected query and metric. Every image links to its original source.</p><div id="gallery" class="gallery"></div></details>
<footer><p id="commit"></p><p>Rebuild with <code>make color-benchmark-report</code>; serve with <code>make color-benchmark-serve</code>. Query and method selections are saved in the URL. Embedded results also work when opening this HTML locally; images require the adjacent corpus directory.</p></footer>
<noscript>Enable JavaScript to compare the embedded benchmark results.</noscript>
</main><script id="benchmark-data" type="application/json">${embedded}</script><script>(${client.toString()})();</script></body></html>`;
await writeFile(new URL("report.html", root), html);
console.log(
	`Wrote report.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB), ${results.corpus.length} wallpapers, ${results.algorithms.length} algorithms.`,
);
