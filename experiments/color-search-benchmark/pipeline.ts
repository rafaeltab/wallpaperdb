// PROTOTYPE: run production extraction and event projection on the frozen corpus.
// Only the dedicated local scratch services in compose.yml are used. The file
// reader replaces S3; upload HTTP/auth/validation and the gateway HTTP layer are
// outside this experiment. Production algorithms and NATS handlers are imported.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Config as ExtractorConfig } from "../../apps/color-extractor/src/config.js";
import { ColorExtractionProcessor } from "../../apps/color-extractor/src/services/color-extraction-processor.js";
import { WallpaperUploadedConsumerService } from "../../apps/color-extractor/src/services/consumers/wallpaper-uploaded-consumer.service.js";
import { EventsService } from "../../apps/color-extractor/src/services/events.service.js";
import { HsvEmbeddingStrategy } from "../../apps/color-extractor/src/services/hsv-embedding-strategy.js";
import { SharpHistogramProvider } from "../../apps/color-extractor/src/services/sharp-histogram-provider.js";
import type { Config as GatewayConfig } from "../../apps/gateway/src/config.js";
import { NatsConnectionManager } from "../../apps/gateway/src/connections/nats.js";
import { OpenSearchConnection } from "../../apps/gateway/src/connections/opensearch.js";
import { WallpaperColorsExtractedConsumer } from "../../apps/gateway/src/consumers/wallpaper-colors-extracted.consumer.js";
import { wallpapersIndexMapping } from "../../apps/gateway/src/opensearch/mappings.js";
import { WallpaperRepository } from "../../apps/gateway/src/repositories/wallpaper.repository.js";
import { ColorSortService } from "../../apps/gateway/src/services/color-sort.service.js";
import { IndexManagerService } from "../../apps/gateway/src/services/index-manager.service.js";
import { WallpaperUploadedPublisher } from "../../apps/ingestor/src/services/publishers/wallpaper-uploaded.publisher.js";

interface CorpusEntry {
	id: string;
	filename: string;
	width: number;
	height: number;
	bytes: number;
	format: "jpeg" | "png" | "webp";
	sha256: string;
	[key: string]: unknown;
}

const directory = new URL("./", import.meta.url);
const outputDirectory = new URL("./output/", directory);
const opensearchUrl = "http://127.0.0.1:19215";
const natsUrl = "nats://127.0.0.1:14223";
const cosineIndex = "color-benchmark-cosine";
const l2Index = "color-benchmark-l2";
const stream = "WALLPAPER";
const startedAt = new Date().toISOString();
const started = performance.now();
const manifestBytes = await readFile(
	new URL("./corpus-manifest.json", directory),
);
const manifest = JSON.parse(manifestBytes.toString()) as CorpusEntry[];
assert.equal(manifest.length, 100, "Benchmark requires exactly 100 wallpapers");
assert.equal(new Set(manifest.map((entry) => entry.id)).size, 100);
assert.equal(new Set(manifest.map((entry) => entry.sha256)).size, 100);
const manifestByFile = new Map(
	manifest.map((entry) => [entry.filename, entry]),
);

// Constructors only use these infrastructure properties. Full service config
// validation is intentionally bypassed because HTTP, Redis and S3 are not run.
const gatewayConfig = {
	opensearchUrl,
	natsUrl,
	natsStream: stream,
	otelServiceName: "color-benchmark-gateway",
} as GatewayConfig;
const extractorConfig = {
	natsUrl,
	natsStream: stream,
	otelServiceName: "color-benchmark-extractor",
} as ExtractorConfig;
const searchConnection = new OpenSearchConnection(gatewayConfig);
const natsConnection = new NatsConnectionManager(gatewayConfig);

// Real IndexManagerService with an isolated physical index as its default.
class BenchmarkIndexManager extends IndexManagerService {
	constructor(
		connection: OpenSearchConnection,
		private readonly benchmarkName: string,
		metric: string,
	) {
		super(connection);
		this.unregister("wallpapers");
		this.unregister("profiles");
		const mapping = structuredClone(wallpapersIndexMapping);
		mapping.properties.colorHistogram.method.space_type = metric;
		this.register({ key: benchmarkName, name: benchmarkName, mapping });
	}

	override getIndexName(key = this.benchmarkName): string {
		return super.getIndexName(key);
	}
}

const cosineManager = new BenchmarkIndexManager(
	searchConnection,
	cosineIndex,
	"cosinesimil",
);
const l2Manager = new BenchmarkIndexManager(searchConnection, l2Index, "l2");
const cosineRepository = new WallpaperRepository(
	searchConnection,
	cosineManager,
);
const l2Repository = new WallpaperRepository(searchConnection, l2Manager);
const gatewayConsumer = new WallpaperColorsExtractedConsumer(
	natsConnection,
	cosineRepository,
);
const histograms = new Map<string, number[]>();
const readChecksums = new Map<string, string>();
const provider = new SharpHistogramProvider(
	{
		async read(bucket, key) {
			assert.equal(bucket, "color-benchmark-local-files");
			const entry = manifestByFile.get(key);
			assert.ok(entry, `Unknown corpus file: ${key}`);
			const bytes = await readFile(new URL(key, directory));
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			assert.equal(
				sha256,
				entry.sha256,
				`Source checksum mismatch: ${entry.id}`,
			);
			readChecksums.set(entry.id, sha256);
			return bytes;
		},
	},
	new HsvEmbeddingStrategy(),
);
const recordingProvider = {
	async extractHistogram(bucket: string, key: string) {
		const histogram = await provider.extractHistogram(bucket, key);
		const entry = manifestByFile.get(key)!;
		assert.equal(histogram.length, 64);
		assert.ok(histogram.every((value) => Number.isFinite(value) && value >= 0));
		assert.ok(Math.abs(histogram.reduce((a, b) => a + b, 0) - 1) < 1e-10);
		histograms.set(entry.id, histogram);
		return histogram;
	},
};
const events = new EventsService(natsConnection, extractorConfig);
const processor = new ColorExtractionProcessor(recordingProvider, events);
const extractorConsumer = new WallpaperUploadedConsumerService(
	processor,
	natsConnection,
	extractorConfig,
);

function cosine(a: number[], b: number[]): number {
	return (
		a.reduce((sum, value, i) => sum + value * b[i], 0) /
		Math.sqrt(
			a.reduce((sum, value) => sum + value * value, 0) *
				b.reduce((sum, value) => sum + value * value, 0),
		)
	);
}

try {
	await searchConnection.initialize();
	await natsConnection.initialize();
	const client = searchConnection.getClient();
	const nc = natsConnection.getClient();
	const jsm = await nc.jetstreamManager();

	// Reset only the dedicated scratch indexes/stream, allowing deterministic runs.
	for (const index of [cosineIndex, l2Index]) {
		if ((await client.indices.exists({ index })).body)
			await client.indices.delete({ index });
	}
	if (
		(await jsm.streams.list().next()).some(
			(item) => item.config.name === stream,
		)
	) {
		await jsm.streams.delete(stream);
	}
	await jsm.streams.add({ name: stream, subjects: ["wallpaper.>"] });
	await cosineManager.createIndex();
	await l2Manager.createIndex();

	// Seed the same base documents the uploaded-wallpaper gateway projection
	// would supply. Keep the real repository writes and color update path.
	for (let offset = 0; offset < manifest.length; offset += 10) {
		await Promise.all(
			manifest.slice(offset, offset + 10).map(async (entry) => {
				await cosineRepository.upsert({
					wallpaperId: entry.id,
					userId: "color-benchmark",
					variants: [
						{
							width: entry.width,
							height: entry.height,
							aspectRatio: entry.width / entry.height,
							format: `image/${entry.format}`,
							fileSizeBytes: entry.bytes,
							createdAt: startedAt,
						},
					],
					uploadedAt: startedAt,
					updatedAt: startedAt,
				});
			}),
		);
	}

	await gatewayConsumer.start();
	await extractorConsumer.start();
	const uploads = new WallpaperUploadedPublisher({
		natsConnection: nc,
		serviceName: "color-benchmark-ingestor",
	});
	for (const entry of manifest) {
		await uploads.publishNew({
			wallpaper: {
				id: entry.id,
				userId: "color-benchmark",
				fileType: "image",
				mimeType: `image/${entry.format}`,
				fileSizeBytes: entry.bytes,
				width: entry.width,
				height: entry.height,
				aspectRatio: entry.width / entry.height,
				storageBucket: "color-benchmark-local-files",
				storageKey: entry.filename,
				originalFilename: entry.filename.split("/").at(-1)!,
				uploadedAt: startedAt,
			},
		});
	}

	const deadline = Date.now() + 300_000;
	let projected = 0;
	let lastReported = -1;
	while (Date.now() < deadline) {
		projected = (
			await client.count({
				index: cosineIndex,
				body: { query: { exists: { field: "colorHistogram" } } },
			})
		).body.count;
		if (Math.floor(projected / 10) !== lastReported) {
			console.log(
				`Color pipeline: ${histograms.size}/100 extracted, ${projected}/100 projected`,
			);
			lastReported = Math.floor(projected / 10);
		}
		if (projected === manifest.length) break;
		assert.ok(
			gatewayConsumer.isRunning(),
			"Gateway color consumer stopped unexpectedly",
		);
		assert.ok(
			extractorConsumer.isRunning(),
			"Extractor upload consumer stopped unexpectedly",
		);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.equal(projected, 100, "Timed out waiting for NATS color projection");
	assert.equal(histograms.size, 100);
	assert.equal(readChecksums.size, 100);

	const features = [];
	for (let offset = 0; offset < manifest.length; offset += 10) {
		const batch = await Promise.all(
			manifest.slice(offset, offset + 10).map(async (entry) => {
				const document = await cosineRepository.findById(entry.id);
				assert.ok(document);
				assert.equal(document.colorSpace, "hsv");
				assert.deepEqual(
					document.colorHistogram,
					histograms.get(entry.id),
					`Projection differs: ${entry.id}`,
				);
				await l2Repository.upsert(document);
				const l2Document = await l2Repository.findById(entry.id);
				assert.deepEqual(l2Document?.colorHistogram, document.colorHistogram);
				return { ...entry, histogram: document.colorHistogram };
			}),
		);
		features.push(...batch);
	}

	await nc.flush();
	const streamInfo = await jsm.streams.info(stream);
	assert.equal(
		streamInfo.state.messages,
		200,
		"Expected 100 upload events and 100 color events",
	);
	const consumerInfo = await Promise.all([
		jsm.consumers.info(stream, "color-extractor-wallpaper-uploaded-consumer"),
		jsm.consumers.info(stream, "gateway-wallpaper-colors-extracted"),
	]);
	for (const info of consumerInfo) {
		assert.equal(info.num_pending, 0);
		assert.equal(info.num_ack_pending, 0);
		assert.equal(info.num_redelivered, 0);
		assert.equal(info.delivered.consumer_seq, 100);
	}

	// Execute the exact production repository request (including k=10000 and
	// score/id sorting) and compare every native score to exact local arithmetic.
	const colorService = new ColorSortService({ spreadStrategy: "linear" });
	const nativeChecks = [];
	for (const color of [
		"#FF0000",
		"#FFFF00",
		"#00FFFF",
		"#0000FF",
		"#000000",
		"#FFFFFF",
	]) {
		const query = colorService.buildQueryVector({
			colors: [{ color, amount: 1 }],
		});
		const mass = query.reduce((a, b) => a + b, 0);
		for (const [variant, repository, vector] of [
			["cosinesimil", cosineRepository, query],
			["l2-raw-query", l2Repository, query],
			["l2-normalized-query", l2Repository, query.map((value) => value / mass)],
		] as const) {
			const result = await repository.search({
				colorVector: vector,
				size: 100,
				sortOrder: "desc",
			});
			assert.equal(result.total, 100);
			assert.equal(result.documents.length, 100);
			assert.equal(
				new Set(result.documents.map((document) => document.wallpaperId)).size,
				100,
			);
			const errors = result.documents.map((document, index) => {
				const histogram = histograms.get(document.wallpaperId)!;
				const expected =
					variant === "cosinesimil"
						? (1 + cosine(vector, histogram)) / 2
						: 1 /
							(1 +
								vector.reduce(
									(sum, value, i) => sum + (value - histogram[i]) ** 2,
									0,
								));
				return Math.abs(Number(result.cursorValues[index][0]) - expected);
			});
			const maxScoreError = Math.max(...errors);
			assert.ok(
				maxScoreError < 2e-6,
				`Native ${variant} score mismatch for ${color}: ${maxScoreError}`,
			);
			nativeChecks.push({
				color,
				variant,
				total: result.total,
				maxScoreError,
				topFive: result.documents.slice(0, 5).map((document, index) => ({
					id: document.wallpaperId,
					score: result.cursorValues[index][0],
				})),
			});
		}
	}

	const firstPage = await cosineRepository.search({
		colorVector: colorService.buildQueryVector({
			colors: [{ color: "#FFFF00", amount: 1 }],
		}),
		size: 10,
		sortOrder: "desc",
	});
	const nextPage = await cosineRepository.search({
		colorVector: colorService.buildQueryVector({
			colors: [{ color: "#FFFF00", amount: 1 }],
		}),
		size: 10,
		sortOrder: "desc",
		searchAfter: firstPage.cursorValues.at(-1),
	});
	assert.equal(
		new Set(
			[...firstPage.documents, ...nextPage.documents].map(
				(item) => item.wallpaperId,
			),
		).size,
		20,
	);

	const info = (await client.info()).body;
	const evidence = {
		startedAt,
		completedAt: new Date().toISOString(),
		durationMs: performance.now() - started,
		corpusManifestSha256: createHash("sha256")
			.update(manifestBytes)
			.digest("hex"),
		opensearchVersion: info.version.number,
		natsVersion: nc.info?.version,
		opensearchUrl,
		natsUrl,
		indexes: { cosine: cosineIndex, l2: l2Index },
		wallpapers: manifest.length,
		extracted: histograms.size,
		projected,
		checksumVerified: readChecksums.size,
		streamMessages: streamInfo.state.messages,
		consumers: consumerInfo.map((consumer) => ({
			name: consumer.name,
			delivered: consumer.delivered.consumer_seq,
			pending: consumer.num_pending,
			ackPending: consumer.num_ack_pending,
			redelivered: consumer.num_redelivered,
		})),
		extractionMatchesProjection: true,
		cosineAndL2DocumentsIdentical: true,
		productionRepositoryNativeScoreChecks: nativeChecks,
		forwardPaginationUniqueDocumentsAcrossTwoPages: 20,
		boundaries: {
			real: [
				"SharpHistogramProvider",
				"HsvEmbeddingStrategy",
				"WallpaperUploadedPublisher",
				"WallpaperUploadedConsumerService",
				"ColorExtractionProcessor",
				"EventsService",
				"WallpaperColorsExtractedPublisher",
				"NATS JetStream",
				"WallpaperColorsExtractedConsumer",
				"WallpaperRepository",
				"ColorSortService",
				"IndexManagerService",
				"OpenSearch 2.11.0",
			],
			substituted: [
				"ImageReader reads checksum-verified local files instead of S3",
				"Isolated physical index names",
			],
			bypassed: [
				"Upload HTTP/auth/validation",
				"Gateway uploaded-event base projection (seeded via real repository)",
				"Gateway HTTP/GraphQL transport",
				"Redis",
				"OpenTelemetry exporter",
			],
		},
	};
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(
		new URL("features.json", outputDirectory),
		`${JSON.stringify(features, null, 2)}\n`,
	);
	await writeFile(
		new URL("pipeline-evidence.json", outputDirectory),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	await writeFile(
		new URL("pipeline-evidence.json", directory),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(
		`Production pipeline verified: ${manifest.length} wallpapers, 200 real NATS events, both native OpenSearch mappings.`,
	);
	console.log(`Artifacts: ${fileURLToPath(outputDirectory)}`);
} finally {
	await extractorConsumer.stop();
	await gatewayConsumer.stop();
	await natsConnection.close();
	await searchConnection.close();
}
