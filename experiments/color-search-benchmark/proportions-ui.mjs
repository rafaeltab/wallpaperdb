// THROWAWAY PROTOTYPE: interactive queries against the recorded image palettes.
import { labToHex, normalizeQuery, scorePalette } from "./proportions.mjs";

const $ = (id) => document.getElementById(id);
const percent = (value) => `${(100 * value).toFixed(1).replace(/\.0$/, "")}%`;
const methods = new Set(["transport", "coverage", "legacy"]);
const descriptions = {
	transport:
		"Moves the palette’s area into the requested proportions, paying for perceptual color differences and, in target mode, excess requested color.",
	coverage:
		"Measures exclusive color area, then compares it with each requested amount. A simpler proportion-aware alternative.",
	legacy:
		"Previous 32-color palette score: rewards color presence using relative importance. It does not enforce the requested image percentages.",
};
const state = {
	colors: [{ color: "#22c55e", amount: 0.4 }],
	mode: "target",
	tolerance: 0.06,
	left: "transport",
	right: "legacy",
	dataset: "wallpapers",
};
const visible = { left: 12, right: 12 };
let data;
let rankings = {};
let pending;
let rankingGeneration = 0;
let pushNextUrl = false;
let urlWarning = "";

function node(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function safeUrl(value) {
	return /^(https?:\/\/|corpus\/|\.\/)/.test(value ?? "") ? value : "#";
}

function link(text, href, className) {
	const element = node("a", className, text);
	element.href = safeUrl(href);
	element.target = "_blank";
	element.rel = "noopener noreferrer";
	return element;
}

function swatch(color, className = "swatch") {
	const element = node("span", className);
	element.style.backgroundColor = color;
	return element;
}

function readUrl() {
	const params = new URLSearchParams(location.search);
	urlWarning = "";
	state.colors = structuredClone(
		data.presets?.[0]?.colors ?? [{ color: "#22c55e", amount: 0.4 }],
	);
	if (params.has("colors")) {
		try {
			const requested = params
				.get("colors")
				.split(",")
				.map((entry) => {
					const [hex, amount] = entry.split(":");
					return { color: `#${hex}`, amount: Number(amount) / 100 };
				});
			if (requested.length > 10) throw new Error("Use at most 10 colors.");
			state.colors = normalizeQuery(requested);
		} catch (error) {
			urlWarning = `The query in this link is invalid (${error.message}). Showing the first example instead.`;
		}
	}
	state.mode = params.get("mode") === "minimum" ? "minimum" : "target";
	const tolerance = Number(params.get("tolerance"));
	state.tolerance =
		params.has("tolerance") &&
		Number.isFinite(tolerance) &&
		tolerance >= 0.02 &&
		tolerance <= 0.14
			? tolerance
			: 0.06;
	state.left = methods.has(params.get("left"))
		? params.get("left")
		: "transport";
	state.right = methods.has(params.get("right"))
		? params.get("right")
		: "legacy";
	state.dataset =
		params.get("dataset") === "fixtures" && data.fixtures?.length
			? "fixtures"
			: "wallpapers";
}

function queryUrl() {
	const url = new URL(location.href);
	url.searchParams.set(
		"colors",
		normalizeQuery(state.colors)
			.map(
				({ color, amount }) =>
					`${color.replace("#", "")}:${Number((amount * 100).toFixed(4))}`,
			)
			.join(","),
	);
	url.searchParams.set("mode", state.mode);
	url.searchParams.set("tolerance", state.tolerance.toFixed(2));
	url.searchParams.set("left", state.left);
	url.searchParams.set("right", state.right);
	if (state.dataset === "fixtures") url.searchParams.set("dataset", "fixtures");
	else url.searchParams.delete("dataset");
	return url;
}

function saveUrl() {
	const url = queryUrl();
	if (url.href !== location.href) history.pushState(null, "", url);
}

function renderRows() {
	const rows = $("color-rows");
	rows.replaceChildren();
	state.colors.forEach((entry, index) => {
		const row = node("div", "color-row");
		const picker = node("input", "color-picker");
		picker.type = "color";
		picker.value = /^#[\da-f]{6}$/i.test(entry.color) ? entry.color : "#000000";
		picker.setAttribute("aria-label", `Color ${index + 1}`);
		const hex = node("input", "hex-input");
		hex.type = "text";
		hex.value = entry.color;
		hex.maxLength = 7;
		hex.spellcheck = false;
		hex.setAttribute("aria-label", `Color ${index + 1} hex value`);
		const amountWrap = node("div", "amount-wrap");
		const amount = node("input", "amount-input");
		amount.type = "number";
		amount.min = "0";
		amount.max = "100";
		amount.step = "1";
		amount.value = String(Number((entry.amount * 100).toFixed(4)));
		amount.setAttribute("aria-label", `Color ${index + 1} percentage`);
		amountWrap.append(amount, node("span", "", "%"));
		const remove = node("button", "remove-color", "×");
		remove.type = "button";
		remove.setAttribute("aria-label", `Remove color ${index + 1}`);
		remove.disabled = state.colors.length === 1;
		picker.addEventListener("input", () => {
			entry.color = picker.value;
			hex.value = picker.value;
			schedule();
		});
		hex.addEventListener("input", () => {
			entry.color = hex.value.trim();
			if (/^#[\da-f]{6}$/i.test(entry.color)) picker.value = entry.color;
			schedule();
		});
		amount.addEventListener("input", () => {
			entry.amount =
				amount.value === "" ? Number.NaN : Number(amount.value) / 100;
			schedule();
		});
		for (const input of [picker, hex, amount])
			input.addEventListener("change", () => schedule(true));
		remove.addEventListener("click", () => {
			state.colors.splice(index, 1);
			renderRows();
			schedule(true);
		});
		row.append(picker, hex, amountWrap, remove);
		rows.append(row);
	});
	$("add-color").disabled = state.colors.length >= 10;
}

function renderControls() {
	renderRows();
	$("mode").value = state.mode;
	$("tolerance").value = String(state.tolerance);
	$("tolerance-value").value = state.tolerance.toFixed(2);
	$("left-method").value = state.left;
	$("right-method").value = state.right;
	$("dataset").value = state.dataset;
}

function renderComposition() {
	const bar = $("composition-bar");
	const legend = $("query-legend");
	bar.replaceChildren();
	legend.replaceChildren();
	const total = state.colors.reduce(
		(sum, entry) => sum + (Number.isFinite(entry.amount) ? entry.amount : 0),
		0,
	);
	const remainder = Math.max(0, 1 - total);
	const labels = [];
	for (const entry of state.colors) {
		const amount = Number.isFinite(entry.amount)
			? Math.max(0, entry.amount)
			: 0;
		const segment = swatch(entry.color, "");
		segment.style.width = `${(amount / Math.max(1, total)) * 100}%`;
		segment.title = `${entry.color}: ${percent(amount)}`;
		bar.append(segment);
		const label = node("span", "legend-item");
		label.append(
			swatch(entry.color),
			node("span", "", `${entry.color} · ${percent(amount)}`),
		);
		legend.append(label);
		labels.push(`${percent(amount)} ${entry.color}`);
	}
	if (remainder > 1e-8) {
		const segment = node("span", "anything");
		segment.style.width = `${remainder * 100}%`;
		segment.title = `${percent(remainder)} remainder`;
		bar.append(segment);
		const label = node("span", "legend-item");
		label.append(
			node("span", "swatch anything"),
			node("span", "", `${percent(remainder)} remainder`),
		);
		legend.append(label);
		labels.push(`${percent(remainder)} remainder`);
	}
	bar.setAttribute("aria-label", labels.join(", "));
	$("query-total").textContent =
		`${percent(total)} requested · ${percent(remainder)} remainder`;
	$("query-explanation").textContent =
		state.mode === "target"
			? "Match these image percentages as closely as possible. Both too little and too much of each chosen color count against a result. The remainder can be other colors."
			: "Find at least these image percentages. The remainder may include more of the requested colors, or any other color.";
	$("mode-explanation").textContent =
		state.mode === "target"
			? "A request for 40% green prefers 40% over 80% green. The other 60% is unconstrained except for extra green."
			: "A request for at least 40% green also accepts 80% green. Missing requested area still counts against a result.";
	$("tolerance-value").value = state.tolerance.toFixed(2);
	try {
		const colors = normalizeQuery(state.colors);
		if (colors.length === 0)
			throw new Error("Choose at least one color above 0%.");
		$("query-error").hidden = !urlWarning;
		$("query-error").textContent = urlWarning;
		$("share-query").disabled = false;
		return colors;
	} catch (error) {
		$("query-error").textContent = error.message;
		$("query-error").hidden = false;
		$("share-query").disabled = true;
		return null;
	}
}

function matchCard(hit, rank) {
	const { wallpaper, result } = hit;
	const card = node("article", "match");
	const picture = link("", wallpaper.filename, "picture-link");
	const image = node("img");
	image.src = safeUrl(wallpaper.thumbnail ?? wallpaper.filename);
	image.alt = wallpaper.title;
	image.loading = rank <= 3 ? "eager" : "lazy";
	image.width = 280;
	image.height = 158;
	picture.append(image);
	const info = node("div", "match-info");
	info.append(
		node(
			"div",
			"rank",
			`#${rank} · ${wallpaper.synthetic ? "synthetic example" : wallpaper.id}`,
		),
		node("h3", "match-title", wallpaper.title),
	);
	const palette = node("div", "palette");
	palette.setAttribute("role", "img");
	palette.setAttribute("aria-label", "Representative wallpaper palette");
	for (const entry of wallpaper.palette) {
		const color = labToHex(entry.lab);
		const segment = swatch(color, "");
		segment.style.width = `${entry.weight * 100}%`;
		segment.title = `${color}: ${percent(entry.weight)}`;
		palette.append(segment);
	}
	info.append(
		palette,
		node("div", "estimate-heading", "Estimated image area · requested"),
	);
	result.targets.forEach((target, index) => {
		const row = node("div", "estimate-row");
		const estimated = node("strong", "", percent(result.observed[index]));
		const requested = node(
			"span",
			"wanted",
			`${state.mode === "minimum" ? "≥ " : ""}${percent(target.amount)} wanted`,
		);
		row.title = target.color;
		row.append(swatch(target.color), estimated, requested);
		info.append(row);
	});
	info.append(
		node(
			"div",
			"other-estimate",
			`${percent(result.other)} other / less similar shades`,
		),
	);
	info.append(
		node(
			"p",
			"ranking-score",
			`Match cost ${result.cost.toFixed(3)} · 0 is best`,
		),
	);
	if (wallpaper.sourcePage)
		info.append(link("Original source ↗", wallpaper.sourcePage, "source"));
	card.append(picture, info);
	return card;
}

function renderColumn(side) {
	const ranking = rankings[state[side]] ?? [];
	$(`${side}-description`).textContent = descriptions[state[side]];
	$(`${side}-summary`).textContent =
		`Showing ${Math.min(visible[side], ranking.length)} of ${ranking.length} ${state.dataset === "fixtures" ? "synthetic examples" : "wallpapers"}`;
	$(`${side}-results`).replaceChildren(
		...ranking
			.slice(0, visible[side])
			.map((hit, index) => matchCard(hit, index + 1)),
	);
	$(`${side}-more`).hidden = visible[side] >= ranking.length;
}

async function rankAll(colors, generation) {
	const start = performance.now();
	const needed = [...new Set([state.left, state.right])];
	const next = Object.fromEntries(needed.map((method) => [method, []]));
	const options = { mode: state.mode, tolerance: state.tolerance };
	const corpus = state.dataset === "fixtures" ? data.fixtures : data.wallpapers;
	$("dataset-note").textContent =
		state.dataset === "fixtures"
			? "Synthetic color strips with known proportions. These controlled examples help explain the ranking; they are separate from the 100 real wallpapers."
			: "Real wallpaper corpus. Some requested compositions may have no close match.";
	// Yield between small batches so editing remains responsive on slower devices.
	for (let offset = 0; offset < corpus.length; offset += 10) {
		for (const wallpaper of corpus.slice(offset, offset + 10)) {
			for (const method of needed)
				next[method].push({
					wallpaper,
					result: scorePalette(wallpaper.palette, colors, {
						...options,
						method,
					}),
				});
		}
		if (generation !== rankingGeneration) return;
		if (offset + 10 < corpus.length)
			await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (const method of needed)
		next[method].sort(
			(a, b) =>
				b.result.score - a.result.score ||
				a.wallpaper.id.localeCompare(b.wallpaper.id),
		);
	rankings = next;
	renderColumn("left");
	renderColumn("right");
	const closest = next[state.left]?.[0]?.result;
	const differences = closest
		? closest.targets.map((target, index) =>
				state.mode === "minimum"
					? Math.max(0, target.amount - closest.observed[index])
					: Math.abs(target.amount - closest.observed[index]),
			)
		: [];
	const far = differences.some((difference) => difference > 0.15);
	$("status").classList.toggle("weak-match", far);
	$("status").textContent = far
		? "The top result still differs by more than 15 percentage points on a requested color. These are the nearest available images, not confirmed matches."
		: "All images ranked. Compare the estimated image areas with your requested percentages.";
	$("run-meta").textContent =
		`${corpus.length} ${state.dataset === "fixtures" ? "synthetic examples" : "wallpapers"} · ${(performance.now() - start).toFixed(0)} ms local ranking`;
}

function schedule(pushUrl = false) {
	clearTimeout(pending);
	pushNextUrl ||= pushUrl;
	urlWarning = "";
	const generation = ++rankingGeneration;
	const colors = renderComposition();
	visible.left = visible.right = 12;
	if (!colors) {
		for (const side of ["left", "right"]) {
			$(`${side}-results`).replaceChildren();
			$(`${side}-summary`).textContent = "";
			$(`${side}-more`).hidden = true;
		}
		$("status").textContent = "Fix the composition above to rank wallpapers.";
		return;
	}
	pending = setTimeout(async () => {
		try {
			if (pushNextUrl) {
				saveUrl();
				pushNextUrl = false;
			}
			$("status").textContent = "Ranking the wallpaper palettes…";
			await rankAll(colors, generation);
		} catch (error) {
			$("status").textContent = `Cannot rank this query: ${error.message}`;
		}
	}, 120);
}

async function initialize() {
	try {
		const response = await fetch("./proportions-data.json");
		if (!response.ok)
			throw new Error(`Palette data request returned ${response.status}`);
		data = await response.json();
		$("dataset").querySelector('[value="fixtures"]').disabled =
			!data.fixtures?.length;
		readUrl();
		renderControls();
		for (const preset of data.presets ?? []) {
			const button = node("button", "preset", preset.label);
			button.type = "button";
			button.addEventListener("click", () => {
				state.colors = structuredClone(preset.colors);
				state.mode = preset.mode ?? "target";
				renderControls();
				schedule(true);
			});
			$("presets").append(button);
		}
		$("add-color").addEventListener("click", () => {
			if (state.colors.length >= 10) return;
			const remaining = Math.max(
				0,
				1 -
					state.colors.reduce(
						(sum, entry) =>
							sum + (Number.isFinite(entry.amount) ? entry.amount : 0),
						0,
					),
			);
			const suggestions = [
				"#ef4444",
				"#f97316",
				"#eab308",
				"#22c55e",
				"#3b82f6",
				"#a855f7",
				"#ec4899",
				"#000000",
				"#ffffff",
				"#64748b",
			];
			state.colors.push({
				color:
					suggestions.find(
						(color) => !state.colors.some((entry) => entry.color === color),
					) ?? "#808080",
				amount: Math.min(0.2, remaining),
			});
			renderRows();
			schedule(true);
		});
		$("mode").addEventListener("change", () => {
			state.mode = $("mode").value;
			schedule(true);
		});
		$("dataset").addEventListener("change", () => {
			state.dataset = $("dataset").value;
			schedule(true);
		});
		$("tolerance").addEventListener("input", () => {
			state.tolerance = Number($("tolerance").value);
			schedule();
		});
		$("tolerance").addEventListener("change", () => schedule(true));
		for (const side of ["left", "right"]) {
			$(`${side}-method`).addEventListener("change", () => {
				state[side] = $(`${side}-method`).value;
				schedule(true);
			});
			$(`${side}-more`).addEventListener("click", () => {
				visible[side] += 12;
				renderColumn(side);
			});
		}
		$("share-query").addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(queryUrl().href);
				$("share-query").textContent = "Query link copied";
				setTimeout(() => {
					$("share-query").textContent = "Copy query link";
				}, 2000);
			} catch {
				saveUrl();
				$("status").textContent =
					"Copy this page’s address to share the current query.";
			}
		});
		window.addEventListener("popstate", () => {
			clearTimeout(pending);
			pushNextUrl = false;
			readUrl();
			renderControls();
			const colors = renderComposition();
			visible.left = visible.right = 12;
			if (colors) rankAll(colors, ++rankingGeneration);
		});
		const colors = renderComposition();
		if (colors) await rankAll(colors, ++rankingGeneration);
	} catch (error) {
		$("status").textContent =
			`Unable to load the prototype: ${error.message}. Serve this folder over HTTP and generate the proportion data first.`;
		$("run-meta").textContent = "Palette data unavailable";
	}
}

initialize();
