// THROWAWAY PROTOTYPE: independently editable color regions and image proportions.
import {
	RANGE_PRESETS,
	normalizeRangeQuery,
	prepareRangePalette,
	compileRangeQuery,
	scoreRangePalette,
	containsRange,
	rangePreference,
} from "./ranges.mjs";
import { labToHex } from "./proportions.mjs";

const $ = (id) => document.getElementById(id);
const percent = (value) => `${(100 * value).toFixed(1).replace(/\.0$/, "")}%`;
const state = {
	colors: [],
	mode: "target",
	softness: 0.04,
	dataset: "wallpapers",
	left: "graded",
	right: "hard",
};
const visible = { left: 12, right: 12 };
const boundaries = new Set(["graded", "hard", "soft"]);
const descriptions = {
	graded:
		"Match the requested areas first. Among equal area matches, prefer shades closer to the anchor: 100% at the center, 50% at the edge. Literal areas stay unchanged.",
	hard: "Every shade inside a range counts equally, including its boundary. Shades outside receive no matching credit.",
	soft: "Every inside shade counts equally, with partial credit just outside. This optional comparison can trade area accuracy for nearby color support.",
};
const datasets = {};
let rankings = {};
let pending;
let generation = 0;
let pushNextUrl = false;
let urlWarning = "";
const spaces = {
	oklab: "OKLab · perceptual radius",
	rgb: "RGB · channel box",
	hsl: "HSL · hue, saturation, lightness",
	hsv: "HSV · hue, saturation, value",
};
const axes = {
	oklab: [
		{
			key: "distance",
			label: "Radius · OKLab × 100",
			scale: 100,
			max: 150,
			step: 1,
		},
	],
	rgb: [
		{ key: "r", label: "Red ± points", scale: 100, max: 100, step: 1 },
		{ key: "g", label: "Green ± points", scale: 100, max: 100, step: 1 },
		{ key: "b", label: "Blue ± points", scale: 100, max: 100, step: 1 },
	],
	hsl: [
		{ key: "h", label: "Hue ± degrees", scale: 180, max: 180, step: 1 },
		{ key: "s", label: "Saturation ± points", scale: 100, max: 100, step: 1 },
		{ key: "l", label: "Lightness ± points", scale: 100, max: 100, step: 1 },
	],
	hsv: [
		{ key: "h", label: "Hue ± degrees", scale: 180, max: 180, step: 1 },
		{ key: "s", label: "Saturation ± points", scale: 100, max: 100, step: 1 },
		{ key: "v", label: "Value ± points", scale: 100, max: 100, step: 1 },
	],
};
const explanations = {
	oklab:
		"Accept nearby shades in a perceptual color space. Radius 20 is a distance of 0.20, not 20% similarity.",
	rgb: "Each RGB channel must stay within its own limit of the anchor; 20 means ±20 percentage points.",
	hsl: "Hue wraps around the color wheel. For black, gray, or white, use ±180°; saturation controls how gray the shades stay.",
	hsv: "Value controls brightness. With black, all hues, and saturation ±100, this accepts dark colors as well as gray.",
};

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
function rgb(hex) {
	return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
}
function hexOf(channels) {
	return `#${channels
		.map((v) =>
			Math.round(Math.max(0, Math.min(1, v)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}
function isNeutral(color) {
	const channels = rgb(color);
	return Math.max(...channels) - Math.min(...channels) < 1e-8;
}
function defaultRange(space, color) {
	if (space === "oklab") return { space, distance: 0.2 };
	if (space === "rgb") return { space, r: 0.2, g: 0.2, b: 0.2 };
	return {
		space,
		h: isNeutral(color) ? 1 : 0.2,
		s: 0.2,
		[space === "hsl" ? "l" : "v"]: 0.2,
	};
}

function readUrl() {
	const params = new URLSearchParams(location.search);
	state.colors = structuredClone(RANGE_PRESETS[0].colors);
	urlWarning = "";
	if (params.has("q")) {
		try {
			const query = JSON.parse(params.get("q"));
			if (
				!Array.isArray(query) ||
				query.length > 10 ||
				query.some(
					(target) => !Array.isArray(target.ranges) || target.ranges.length > 2,
				)
			)
				throw new Error(
					"The editor supports up to 10 portions and two constraints per portion.",
				);
			state.colors = normalizeRangeQuery(query);
		} catch (error) {
			urlWarning = `Invalid query link (${error.message}). Showing the first example instead.`;
		}
	}
	state.mode = params.get("mode") === "minimum" ? "minimum" : "target";
	const softness = Number(params.get("softness"));
	state.softness =
		params.has("softness") &&
		Number.isFinite(softness) &&
		softness >= 0.005 &&
		softness <= 0.15
			? softness
			: 0.04;
	state.dataset = Object.hasOwn(datasets, params.get("dataset"))
		? params.get("dataset")
		: "wallpapers";
	state.left = boundaries.has(params.get("left"))
		? params.get("left")
		: "graded";
	state.right = boundaries.has(params.get("right"))
		? params.get("right")
		: "hard";
}
function queryUrl() {
	const url = new URL(location.href);
	url.searchParams.set("q", JSON.stringify(normalizeRangeQuery(state.colors)));
	url.searchParams.set("mode", state.mode);
	url.searchParams.set("softness", String(state.softness));
	url.searchParams.set("left", state.left);
	url.searchParams.set("right", state.right);
	if (state.dataset !== "wallpapers")
		url.searchParams.set("dataset", state.dataset);
	else url.searchParams.delete("dataset");
	return url;
}
function saveUrl() {
	const url = queryUrl();
	if (url.href !== location.href) history.pushState(null, "", url);
}

function renderPortions() {
	const container = $("portions");
	container.replaceChildren();
	state.colors.forEach((target, index) => {
		const fieldset = node("fieldset", "portion");
		fieldset.append(node("legend", "", `Portion ${index + 1}`));
		const fields = node("div", "anchor-fields");
		const picker = node("input", "color-picker");
		picker.type = "color";
		picker.value = /^#[\da-f]{6}$/i.test(target.color)
			? target.color
			: "#000000";
		picker.setAttribute("aria-label", `Portion ${index + 1} anchor color`);
		const hexWrap = node("div");
		const hexLabel = node("label", "", "Anchor hex");
		hexLabel.htmlFor = `hex-${index}`;
		const hex = node("input", "hex-input");
		hex.type = "text";
		hex.id = `hex-${index}`;
		hex.value = target.color;
		hex.maxLength = 7;
		hex.spellcheck = false;
		hex.setAttribute("aria-label", `Portion ${index + 1} anchor hex`);
		hexWrap.append(hexLabel, hex);
		const amountWrap = node("div");
		const amountLabel = node("label", "", "Image area %");
		amountLabel.htmlFor = `amount-${index}`;
		const amount = node("input", "amount-input");
		amount.type = "number";
		amount.id = `amount-${index}`;
		amount.min = "0";
		amount.max = "100";
		amount.step = "1";
		amount.value = String(Number((target.amount * 100).toFixed(4)));
		amount.setAttribute("aria-label", `Portion ${index + 1} image percentage`);
		amountWrap.append(amountLabel, amount);
		const remove = node("button", "remove-portion", "×");
		remove.type = "button";
		remove.disabled = state.colors.length === 1;
		remove.setAttribute("aria-label", `Remove portion ${index + 1}`);
		picker.addEventListener("input", () => {
			target.color = picker.value;
			hex.value = picker.value;
			schedule();
		});
		hex.addEventListener("input", () => {
			target.color = hex.value.trim();
			if (/^#[\da-f]{6}$/i.test(target.color)) picker.value = target.color;
			schedule();
		});
		amount.addEventListener("input", () => {
			target.amount =
				amount.value === "" ? Number.NaN : Number(amount.value) / 100;
			schedule();
		});
		for (const input of [picker, hex, amount])
			input.addEventListener("change", () => schedule(true));
		remove.addEventListener("click", () => {
			state.colors.splice(index, 1);
			renderPortions();
			schedule(true);
		});
		fields.append(picker, hexWrap, amountWrap, remove);
		fieldset.append(fields);
		target.ranges.forEach((range, rangeIndex) => {
			const constraint = node("div", "constraint");
			const heading = node("div", "constraint-heading");
			const selectWrap = node("div", "constraint-select-wrap");
			const label = node(
				"label",
				"",
				rangeIndex === 0 ? "Accepted color range" : "AND also satisfy",
			);
			label.htmlFor = `space-${index}-${rangeIndex}`;
			const select = node("select");
			select.id = `space-${index}-${rangeIndex}`;
			select.setAttribute(
				"aria-label",
				`Portion ${index + 1} constraint ${rangeIndex + 1} color space`,
			);
			for (const [space, title] of Object.entries(spaces)) {
				const option = node("option", "", title);
				option.value = space;
				option.disabled = target.ranges.some(
					(entry, i) => i !== rangeIndex && entry.space === space,
				);
				select.append(option);
			}
			select.value = range.space;
			selectWrap.append(label, select);
			heading.append(selectWrap);
			if (rangeIndex > 0) {
				const removeRange = node("button", "remove-constraint", "Remove");
				removeRange.type = "button";
				removeRange.setAttribute(
					"aria-label",
					`Remove portion ${index + 1} second constraint`,
				);
				removeRange.addEventListener("click", () => {
					target.ranges.splice(rangeIndex, 1);
					renderPortions();
					schedule(true);
				});
				heading.append(removeRange);
			}
			select.addEventListener("change", () => {
				target.ranges[rangeIndex] = defaultRange(select.value, target.color);
				renderPortions();
				schedule(true);
			});
			constraint.append(
				heading,
				node("p", "constraint-explanation", explanations[range.space]),
			);
			for (const axis of axes[range.space]) {
				const control = node("div", "axis-control");
				const axisId = `axis-${index}-${rangeIndex}-${axis.key}`;
				const axisLabel = node("label", "", axis.label);
				axisLabel.htmlFor = axisId;
				const slider = node("input", "axis-range");
				slider.type = "range";
				slider.min = "0";
				slider.max = String(axis.max);
				slider.step = String(axis.step);
				slider.value = String(range[axis.key] * axis.scale);
				slider.setAttribute(
					"aria-label",
					`Portion ${index + 1} ${range.space.toUpperCase()} ${axis.label} slider`,
				);
				const number = node("input", "axis-number");
				number.type = "number";
				number.id = axisId;
				number.min = "0";
				number.max = String(axis.max);
				number.step = String(axis.step);
				number.value = String(
					Number((range[axis.key] * axis.scale).toFixed(4)),
				);
				number.setAttribute(
					"aria-label",
					`Portion ${index + 1} ${range.space.toUpperCase()} ${axis.label}`,
				);
				slider.addEventListener("input", () => {
					range[axis.key] = Number(slider.value) / axis.scale;
					number.value = slider.value;
					schedule();
				});
				number.addEventListener("input", () => {
					range[axis.key] =
						number.value === ""
							? Number.NaN
							: Number(number.value) / axis.scale;
					slider.value = number.value;
					schedule();
				});
				for (const input of [slider, number])
					input.addEventListener("change", () => schedule(true));
				control.append(axisLabel, slider, number);
				constraint.append(control);
			}
			fieldset.append(constraint);
		});
		if (target.ranges.length < 2) {
			const add = node(
				"button",
				"small-button add-constraint",
				"+ Add an AND constraint",
			);
			add.type = "button";
			add.setAttribute(
				"aria-label",
				`Add second constraint to portion ${index + 1}`,
			);
			add.addEventListener("click", () => {
				target.ranges.push(
					defaultRange(
						target.ranges[0].space === "rgb" ? "hsv" : "rgb",
						target.color,
					),
				);
				renderPortions();
				schedule(true);
			});
			fieldset.append(add);
		}
		fieldset.append(
			node(
				"div",
				"preview-heading",
				"Accepted shade examples · hover for preference",
			),
		);
		const preview = node("div", "range-preview");
		preview.id = `preview-${index}`;
		preview.setAttribute("role", "img");
		preview.setAttribute(
			"aria-label",
			`Sample shades accepted by portion ${index + 1}`,
		);
		fieldset.append(
			preview,
			node(
				"div",
				"preview-note",
				"Center 100% · edge 50% · each shade still counts fully as image area",
			),
		);
		container.append(fieldset);
	});
	$("add-portion").disabled = state.colors.length >= 10;
}

function renderControls() {
	renderPortions();
	$("mode").value = state.mode;
	$("dataset").value = state.dataset;
	$("softness").value = String(state.softness * 100);
	$("softness-number").value = String(
		Number((state.softness * 100).toFixed(4)),
	);
	$("left-method").value = state.left;
	$("right-method").value = state.right;
}

function renderSummary() {
	const total = state.colors.reduce(
		(sum, target) => sum + (Number.isFinite(target.amount) ? target.amount : 0),
		0,
	);
	const remainder = Math.max(0, 1 - total);
	const bar = $("composition-bar");
	bar.replaceChildren();
	for (const [index, target] of state.colors.entries()) {
		const segment = swatch(target.color, "");
		segment.style.width = `${(Math.max(0, target.amount || 0) / Math.max(1, total)) * 100}%`;
		segment.title = `Portion ${index + 1}: ${percent(target.amount)}`;
		bar.append(segment);
	}
	if (remainder > 1e-8) {
		const segment = node("span", "anything");
		segment.style.width = `${remainder * 100}%`;
		segment.title = `${percent(remainder)} remainder`;
		bar.append(segment);
	}
	$("query-total").textContent =
		`${percent(total)} requested · ${percent(remainder)} remainder`;
	$("query-explanation").textContent =
		state.mode === "target"
			? "Match these distinct portions as closely as possible. Extra accepted color in the remainder also counts against a result."
			: "Fill at least these distinct portions. The remainder may contain more accepted shades or other colors.";
	try {
		const normalized = normalizeRangeQuery(state.colors);
		if (!normalized.length)
			throw new Error("Choose a positive amount for at least one portion.");
		if (
			normalized.length <
			state.colors.filter((target) => target.amount > 0).length
		)
			$("query-explanation").textContent +=
				" Identical anchor and range definitions are combined for ranking.";
		if (
			!Number.isFinite(state.softness) ||
			state.softness < 0.005 ||
			state.softness > 0.15
		)
			throw new Error("Soft boundary falloff must be between 0.5 and 15.");
		$("query-error").textContent = urlWarning;
		$("query-error").hidden = !urlWarning;
		$("share-query").disabled = false;
		return normalized;
	} catch (error) {
		$("query-error").textContent = error.message.includes("achromatic")
			? `${error.message} In this editor, all hues means ±180°.`
			: error.message;
		$("query-error").hidden = false;
		$("share-query").disabled = true;
		return null;
	}
}

const sampleRgb = [];
for (let r = 0; r <= 8; r++)
	for (let g = 0; g <= 8; g++)
		for (let b = 0; b <= 8; b++) sampleRgb.push([r / 8, g / 8, b / 8]);
for (let gray = 0; gray <= 64; gray++)
	sampleRgb.push([gray / 64, gray / 64, gray / 64]);
function renderPreviews() {
	state.colors.forEach((target, index) => {
		const preview = $(`preview-${index}`);
		if (!preview) return;
		const anchor = rgb(target.color);
		const nearby = [];
		for (const delta of [0.02, 0.05, 0.1])
			for (let channel = 0; channel < 3; channel++)
				for (const sign of [-1, 1]) {
					const candidate = [...anchor];
					candidate[channel] = Math.max(
						0,
						Math.min(1, candidate[channel] + sign * delta),
					);
					nearby.push(candidate);
				}
		const colors = [
			...new Set([anchor, ...nearby, ...sampleRgb].map(hexOf)),
		].filter((color) => containsRange(rgb(color), target));
		const selected =
			colors.length <= 36
				? colors
				: Array.from(
						{ length: 36 },
						(_, i) => colors[Math.floor((i * (colors.length - 1)) / 35)],
					);
		preview.replaceChildren(
			...selected.map((color) => {
				const chip = swatch(color, "");
				chip.title = `${color} · ${percent(rangePreference(rgb(color), target))} color preference`;
				return chip;
			}),
		);
		if (!selected.length) preview.append(node("span", "", "—"));
		preview.setAttribute(
			"aria-label",
			`Portion ${index + 1} accepted shade examples: ${selected.join(", ")}`,
		);
	});
}

function matchCard(hit, rank) {
	const { wallpaper, result } = hit;
	const card = node("article", "match");
	const top = node("div", "match-top");
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
	palette.setAttribute("aria-label", "Representative image palette");
	for (const point of wallpaper.palette) {
		const color = labToHex(point.lab);
		const segment = swatch(color, "");
		segment.style.width = `${point.weight * 100}%`;
		segment.title = `${color}: ${percent(point.weight)}`;
		palette.append(segment);
	}
	info.append(
		palette,
		node(
			"p",
			"ranking-cost",
			`${result.boundary === "soft" ? "Soft match cost" : "Area error"} ${result.cost.toFixed(3)} · 0 is best`,
		),
	);
	if (result.boundary === "graded" && Number.isFinite(result.preference))
		info.append(
			node(
				"p",
				"explanation",
				`Color preference ${percent(result.preference)} · breaks area ties`,
			),
		);
	if (wallpaper.sourcePage)
		info.append(link("Original source ↗", wallpaper.sourcePage, "source"));
	top.append(picture, info);
	card.append(top);
	const table = node("table", "area-table");
	table.setAttribute(
		"aria-label",
		"Estimated image areas for requested portions",
	);
	const head = node("thead");
	const heading = node("tr");
	for (const label of [
		"Portion",
		"Wanted",
		"Available",
		"Allocated in range",
	]) {
		const cell = node("th", "", label);
		cell.scope = "col";
		heading.append(cell);
	}
	head.append(heading);
	const body = node("tbody");
	result.targets.forEach((target, index) => {
		const row = node("tr");
		const name = node("th");
		name.scope = "row";
		name.append(
			swatch(target.color),
			document.createTextNode(String(index + 1)),
		);
		row.append(
			name,
			node(
				"td",
				"",
				`${state.mode === "minimum" ? "≥ " : ""}${percent(target.amount)}`,
			),
			node("td", "", percent(result.available[index])),
			node("td", "", percent(result.assigned[index])),
		);
		body.append(row);
	});
	table.append(head, body);
	card.append(table);
	if (result.overlap > 1e-5)
		card.append(
			node(
				"p",
				"overlap-note",
				`${percent(result.overlap)} lies in multiple ranges. Allocations share this area without counting it twice.`,
			),
		);
	card.append(
		node(
			"p",
			"outside-note",
			`${percent(result.outside)} lies outside every accepted range.`,
		),
	);
	return card;
}
function renderColumn(side) {
	const ranking = rankings[state[side]] ?? [];
	$(`${side}-description`).textContent = descriptions[state[side]];
	$(`${side}-summary`).textContent =
		`Showing ${Math.min(visible[side], ranking.length)} of ${ranking.length} ${state.dataset === "wallpapers" ? "wallpapers" : "synthetic examples"}`;
	$(`${side}-results`).replaceChildren(
		...ranking
			.slice(0, visible[side])
			.map((hit, index) => matchCard(hit, index + 1)),
	);
	$(`${side}-more`).hidden = visible[side] >= ranking.length;
}
async function rankAll(colors, token) {
	const started = performance.now();
	const compiled = compileRangeQuery(colors);
	const corpus = datasets[state.dataset];
	const options = { mode: state.mode, softness: state.softness };
	const needed = [...new Set([state.left, state.right])];
	const next = Object.fromEntries(needed.map((boundary) => [boundary, []]));
	$("dataset-note").textContent =
		state.dataset === "wallpapers"
			? "100 real wallpapers, with all areas estimated from 32-color palettes."
			: "Separate synthetic examples with known colors and areas. These are not part of the real-wallpaper benchmark.";
	for (let offset = 0; offset < corpus.length; offset += 10) {
		for (const wallpaper of corpus.slice(offset, offset + 10))
			for (const boundary of needed)
				next[boundary].push({
					wallpaper,
					result: scoreRangePalette(wallpaper.prepared, compiled, {
						...options,
						boundary,
					}),
				});
		if (token !== generation) return;
		if (offset + 10 < corpus.length)
			await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (const boundary of needed)
		next[boundary].sort((a, b) => {
			const primary = a.result.cost - b.result.cost;
			if (Math.abs(primary) > 1e-10) return primary;
			if (boundary === "graded") {
				const secondary = a.result.colorCost - b.result.colorCost;
				if (Math.abs(secondary) > 1e-10) return secondary;
			}
			return a.wallpaper.id.localeCompare(b.wallpaper.id);
		});
	rankings = next;
	renderColumn("left");
	renderColumn("right");
	const best = next[state.left][0]?.result;
	const weak =
		best &&
		best.targets.some(
			(target, index) => target.amount - best.assigned[index] > 0.15,
		);
	$("status").classList.toggle("weak-match", Boolean(weak));
	$("status").textContent = weak
		? "Even the preferred method’s best result lacks more than 15 percentage points inside a requested portion. These are the nearest available images, not confirmed matches."
		: "All images ranked. Inspect both the available area and the amount allocated inside each accepted range.";
	$("run-meta").textContent =
		`${corpus.length} ${state.dataset === "wallpapers" ? "wallpapers" : "synthetic examples"} · ${(performance.now() - started).toFixed(0)} ms local ranking`;
}
function schedule(pushUrl = false) {
	clearTimeout(pending);
	pushNextUrl ||= pushUrl;
	urlWarning = "";
	const token = ++generation;
	const colors = renderSummary();
	visible.left = visible.right = 12;
	if (!colors) {
		for (const side of ["left", "right"]) {
			$(`${side}-results`).replaceChildren();
			$(`${side}-summary`).textContent = "";
			$(`${side}-more`).hidden = true;
		}
		$("status").textContent = "Fix the query above to rank images.";
		return;
	}
	$("status").textContent = "Ranking the image palettes…";
	pending = setTimeout(async () => {
		try {
			if (pushNextUrl) {
				saveUrl();
				pushNextUrl = false;
			}
			renderPreviews();
			await rankAll(colors, token);
		} catch (error) {
			$("status").textContent = `Cannot rank this query: ${error.message}`;
		}
	}, 150);
}

async function initialize() {
	try {
		const responses = await Promise.allSettled([
			fetch("./proportions-data.json").then(async (response) => {
				if (!response.ok)
					throw new Error(`Palette data returned ${response.status}`);
				return response.json();
			}),
			fetch("./ranges-fixtures.json").then(async (response) =>
				response.ok ? response.json() : null,
			),
		]);
		if (responses[0].status !== "fulfilled") throw responses[0].reason;
		const data = responses[0].value;
		datasets.wallpapers = data.wallpapers;
		if (data.fixtures?.length) datasets.ratios = data.fixtures;
		if (responses[1].status === "fulfilled" && responses[1].value) {
			const extra = responses[1].value;
			const fixtures = Array.isArray(extra)
				? extra
				: (extra.fixtures ?? extra.wallpapers);
			if (fixtures?.length) datasets.ranges = fixtures;
		}
		for (const corpus of Object.values(datasets))
			for (const wallpaper of corpus)
				wallpaper.prepared = prepareRangePalette(wallpaper.palette);
		for (const option of $("dataset").options)
			option.disabled = !Object.hasOwn(datasets, option.value);
		readUrl();
		renderControls();
		for (const preset of RANGE_PRESETS) {
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
		$("add-portion").addEventListener("click", () => {
			if (state.colors.length >= 10) return;
			const remaining = Math.max(
				0,
				1 -
					state.colors.reduce(
						(sum, target) =>
							sum + (Number.isFinite(target.amount) ? target.amount : 0),
						0,
					),
			);
			state.colors.push({
				color: "#008040",
				amount: Math.min(0.2, remaining),
				ranges: [{ space: "oklab", distance: 0.2 }],
			});
			renderPortions();
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
		$("softness").addEventListener("input", () => {
			state.softness = Number($("softness").value) / 100;
			$("softness-number").value = $("softness").value;
			schedule();
		});
		$("softness-number").addEventListener("input", () => {
			state.softness =
				$("softness-number").value === ""
					? Number.NaN
					: Number($("softness-number").value) / 100;
			$("softness").value = $("softness-number").value;
			schedule();
		});
		for (const id of ["softness", "softness-number"])
			$(id).addEventListener("change", () => schedule(true));
		for (const side of ["left", "right"]) {
			$(`${side}-more`).addEventListener("click", () => {
				visible[side] += 12;
				renderColumn(side);
			});
			$(`${side}-method`).addEventListener("change", () => {
				state[side] = $(`${side}-method`).value;
				schedule(true);
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
			const colors = renderSummary();
			visible.left = visible.right = 12;
			if (colors) {
				renderPreviews();
				rankAll(colors, ++generation);
			}
		});
		const colors = renderSummary();
		if (colors) {
			renderPreviews();
			await rankAll(colors, ++generation);
		}
	} catch (error) {
		$("status").textContent =
			`Unable to load the range prototype: ${error.message}`;
		$("run-meta").textContent = "Range data unavailable";
	}
}
initialize();
