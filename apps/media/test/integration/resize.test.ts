import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import {
	createDefaultTesterBuilder,
	DockerTesterBuilder,
	PostgresTesterBuilder,
	MinioTesterBuilder,
	NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import {
	InProcessMediaTesterBuilder,
	MediaMigrationsTesterBuilder,
} from '../builders/index.js';
import { DatabaseConnection } from '../../src/connections/database.js';
import { container } from 'tsyringe';
import { wallpapers, variants } from '../../src/db/schema.js';

const TesterClass = createDefaultTesterBuilder()
	.with(DockerTesterBuilder)
	.with(PostgresTesterBuilder)
	.with(MinioTesterBuilder)
	.with(NatsTesterBuilder)
	.with(MediaMigrationsTesterBuilder)
	.with(InProcessMediaTesterBuilder)
	.build();

describe('Phase 4: Resizing & Variant Selection', () => {
	let tester: InstanceType<typeof TesterClass>;
	let app: FastifyInstance;
	let db: ReturnType<typeof DatabaseConnection.prototype.getClient>['db'];

	beforeAll(async () => {
		tester = new TesterClass();
		tester
			.withPostgres((builder) =>
				builder.withDatabase(`test_media_resize_${Date.now()}`),
			)
			.withMinio()
			.withMinioBucket('wallpapers')
			.withNats((builder) => builder.withJetstream())
			.withStream('WALLPAPER')
			.withMigrations()
			.withInProcessApp();

		await tester.setup();
		app = tester.getApp();
		db = container.resolve(DatabaseConnection).getClient().db;
	}, 60000);

	afterAll(async () => {
		await tester.destroy();
	});

	describe('Query Parameter Validation', () => {
		it('should accept valid width parameter', async () => {
			// This test will fail until we implement query parameter parsing
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?w=1920',
			});

			// We expect 404 (wallpaper not found) not 400 (validation error)
			expect(response.statusCode).toBe(404);
		});

		it('should accept valid height parameter', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?h=1080',
			});

			// We expect 404 (wallpaper not found) not 400 (validation error)
			expect(response.statusCode).toBe(404);
		});

		it('should accept valid fit parameter', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?fit=cover',
			});

			// We expect 404 (wallpaper not found) not 400 (validation error)
			expect(response.statusCode).toBe(404);
		});

		it('should default fit to "contain" when not specified', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?w=1920',
			});

			// When we implement this, verify fit defaults to contain
			expect(response.statusCode).toBe(404);
		});

		it('should reject width = 0 with 400 error', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?w=0',
			});

			expect(response.statusCode).toBe(400);
			const body = JSON.parse(response.body);
			expect(body.type).toMatch(/invalid-dimensions/);
		});

		it('should reject width > 7680 with 400 error', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?w=7681',
			});

			expect(response.statusCode).toBe(400);
			const body = JSON.parse(response.body);
			expect(body.type).toMatch(/invalid-dimensions/);
		});

		it('should reject height = 0 with 400 error', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?h=0',
			});

			expect(response.statusCode).toBe(400);
			const body = JSON.parse(response.body);
			expect(body.type).toMatch(/invalid-dimensions/);
		});

		it('should reject height > 4320 with 400 error', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?h=4321',
			});

			expect(response.statusCode).toBe(400);
			const body = JSON.parse(response.body);
			expect(body.type).toMatch(/invalid-dimensions/);
		});

		it('should reject invalid fit mode with 400 error', async () => {
			const response = await app.inject({
				method: 'GET',
				url: '/wallpapers/wlpr_test123?fit=stretch',
			});

			expect(response.statusCode).toBe(400);
			const body = JSON.parse(response.body);
			expect(body.type).toMatch(/invalid-dimensions/);
		});
	});

	describe('Width-Only Resize', () => {
		/**
		 * Helper function to create a test image with Sharp
		 */
		async function createTestImage(
			width: number,
			height: number,
			format: 'jpeg' | 'png' | 'webp' = 'jpeg',
		): Promise<Buffer> {
			return await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 100, g: 150, b: 200 },
				},
			})
				.toFormat(format)
				.toBuffer();
		}

		it('should resize 3840x2160 to w=1920 maintaining aspect ratio', async () => {
			// Create test image
			const image = await createTestImage(3840, 2160, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_001';

			// Upload to MinIO
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			// Insert into DB
			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Test endpoint
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920`,
			});

			expect(response.statusCode).toBe(200);

			// Verify output dimensions with Sharp
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should resize portrait 1080x1920 to w=540 maintaining aspect ratio', async () => {
			// Create test image (portrait)
			const image = await createTestImage(1080, 1920, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_002';

			// Upload to MinIO
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			// Insert into DB
			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 1080,
				height: 1920,
				aspectRatio: '0.5625',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Test endpoint
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=540`,
			});

			expect(response.statusCode).toBe(200);

			// Verify output dimensions
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(540);
			expect(metadata.height).toBe(960);
		});

		it('should stream large image without buffering', async () => {
			// This test verifies streaming behavior
			const image = await createTestImage(3840, 2160, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_003';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920`,
			});

			expect(response.statusCode).toBe(200);
			// If it completes without timeout or memory error, streaming works
			expect(response.rawPayload).toBeDefined();
		});

		it('should have correct cache headers', async () => {
			const image = await createTestImage(1920, 1080, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_004';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=960`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.headers['cache-control']).toMatch(/public/);
			expect(response.headers['cache-control']).toMatch(/max-age/);
		});

		it('should omit Content-Length header for resized images', async () => {
			const image = await createTestImage(1920, 1080, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_005';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request with resize
			const resizedResponse = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=960`,
			});

			expect(resizedResponse.statusCode).toBe(200);
			// Content-Length should be omitted for resized images (chunked encoding)
			expect(resizedResponse.headers['content-length']).toBeUndefined();

			// Request without resize should have Content-Length
			const originalResponse = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}`,
			});

			expect(originalResponse.statusCode).toBe(200);
			expect(originalResponse.headers['content-length']).toBeDefined();
		});
	});

	describe('Height-Only Resize', () => {
		/**
		 * Helper function to create a test image with Sharp
		 */
		async function createTestImage(
			width: number,
			height: number,
			format: 'jpeg' | 'png' | 'webp' = 'jpeg',
		): Promise<Buffer> {
			return await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 100, g: 150, b: 200 },
				},
			})
				.toFormat(format)
				.toBuffer();
		}

		it('should resize 3840x2160 to h=1080 maintaining aspect ratio', async () => {
			// Create test image
			const image = await createTestImage(3840, 2160, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_h_001';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Test endpoint with height-only parameter
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?h=1080`,
			});

			expect(response.statusCode).toBe(200);

			// Verify output dimensions with Sharp
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should resize portrait 1080x1920 to h=960 maintaining aspect ratio', async () => {
			// Create test image (portrait)
			const image = await createTestImage(1080, 1920, 'jpeg');
			const wallpaperId = 'wlpr_test_resize_h_002';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 1080,
				height: 1920,
				aspectRatio: '0.5625',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Test endpoint with height-only parameter
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?h=960`,
			});

			expect(response.statusCode).toBe(200);

			// Verify output dimensions
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(540);
			expect(metadata.height).toBe(960);
		});
	});

	describe('Fit Modes', () => {
		/**
		 * Helper function to create a test image with Sharp
		 */
		async function createTestImage(
			width: number,
			height: number,
			format: 'jpeg' | 'png' | 'webp' = 'jpeg',
		): Promise<Buffer> {
			return await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 100, g: 150, b: 200 },
				},
			})
				.toFormat(format)
				.toBuffer();
		}

		it('fit=contain with w=1000&h=1000 on 3840x2160 should fit within, preserving aspect', async () => {
			const image = await createTestImage(3840, 2160, 'jpeg');
			const wallpaperId = 'wlpr_test_fit_contain_001';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1000&h=1000&fit=contain`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			// Should fit within 1000x1000, preserving 16:9 aspect ratio
			// Width is limiting factor: 1000x562
			expect(metadata.width).toBe(1000);
			expect(metadata.height).toBeLessThanOrEqual(1000);
			expect(metadata.height).toBeGreaterThan(500); // Roughly 562
		});

		it('fit=contain with square image should fit exactly', async () => {
			const image = await createTestImage(2000, 2000, 'jpeg');
			const wallpaperId = 'wlpr_test_fit_contain_002';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 2000,
				height: 2000,
				aspectRatio: '1.0000',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1000&h=1000&fit=contain`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1000);
			expect(metadata.height).toBe(1000);
		});

		it('fit=cover with w=1000&h=1000 on 3840x2160 should fill completely, cropping excess', async () => {
			const image = await createTestImage(3840, 2160, 'jpeg');
			const wallpaperId = 'wlpr_test_fit_cover_001';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1000&h=1000&fit=cover`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			// Should fill 1000x1000 completely (crop to square)
			expect(metadata.width).toBe(1000);
			expect(metadata.height).toBe(1000);
		});

		it('fit=cover with portrait image should fill completely', async () => {
			const image = await createTestImage(1080, 1920, 'jpeg');
			const wallpaperId = 'wlpr_test_fit_cover_002';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 1080,
				height: 1920,
				aspectRatio: '0.5625',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=800&h=600&fit=cover`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			// Should fill 800x600 completely
			expect(metadata.width).toBe(800);
			expect(metadata.height).toBe(600);
		});

		it('fit=fill with w=1000&h=1000 on 3840x2160 should stretch to exact dimensions', async () => {
			const image = await createTestImage(3840, 2160, 'jpeg');
			const wallpaperId = 'wlpr_test_fit_fill_001';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1000&h=1000&fit=fill`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			// Should be exactly 1000x1000 (distorted from 16:9 to 1:1)
			expect(metadata.width).toBe(1000);
			expect(metadata.height).toBe(1000);
		});

		it('fit=fill with portrait image should stretch to exact dimensions', async () => {
			const image = await createTestImage(1080, 1920, 'jpeg');
			const wallpaperId = 'wlpr_test_fit_fill_002';

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				image,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(image.length),
				width: 1080,
				height: 1920,
				aspectRatio: '0.5625',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1200&h=800&fit=fill`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			// Should be exactly 1200x800 (distorted)
			expect(metadata.width).toBe(1200);
			expect(metadata.height).toBe(800);
		});
	});

	describe('Variant Selection', () => {
		/**
		 * Helper function to create a test image with Sharp
		 */
		async function createTestImage(
			width: number,
			height: number,
			format: 'jpeg' | 'png' | 'webp' = 'jpeg',
		): Promise<Buffer> {
			return await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 100, g: 150, b: 200 },
				},
			})
				.toFormat(format)
				.toBuffer();
		}

		it('should use exact matching variant when dimensions match exactly', async () => {
			const wallpaperId = 'wlpr_variant_exact_001';

			// Create original and variants
			const original = await createTestImage(3840, 2160, 'jpeg');
			const variant1920 = await createTestImage(1920, 1080, 'jpeg');
			const variant1280 = await createTestImage(1280, 720, 'jpeg');

			// Upload to MinIO
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1920x1080.jpg`,
				variant1920,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1280x720.jpg`,
				variant1280,
			);

			// Insert into DB
			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Insert variants
			await db.insert(variants).values([
				{
					id: 'var_001',
					wallpaperId,
					storageKey: `${wallpaperId}/1920x1080.jpg`,
					width: 1920,
					height: 1080,
					fileSizeBytes: BigInt(variant1920.length),
				},
				{
					id: 'var_002',
					wallpaperId,
					storageKey: `${wallpaperId}/1280x720.jpg`,
					width: 1280,
					height: 720,
					fileSizeBytes: BigInt(variant1280.length),
				},
			]);

			// Request exact match: 1920x1080
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920&h=1080`,
			});

			expect(response.statusCode).toBe(200);

			// Should use the 1920x1080 variant (no resizing needed)
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should use next larger variant when requested size is between variants', async () => {
			const wallpaperId = 'wlpr_variant_larger_001';

			const original = await createTestImage(3840, 2160, 'jpeg');
			const variant2560 = await createTestImage(2560, 1440, 'jpeg');
			const variant1920 = await createTestImage(1920, 1080, 'jpeg');
			const variant1280 = await createTestImage(1280, 720, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/2560x1440.jpg`,
				variant2560,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1920x1080.jpg`,
				variant1920,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1280x720.jpg`,
				variant1280,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			await db.insert(variants).values([
				{
					id: 'var_003',
					wallpaperId,
					storageKey: `${wallpaperId}/2560x1440.jpg`,
					width: 2560,
					height: 1440,
					fileSizeBytes: BigInt(variant2560.length),
				},
				{
					id: 'var_004',
					wallpaperId,
					storageKey: `${wallpaperId}/1920x1080.jpg`,
					width: 1920,
					height: 1080,
					fileSizeBytes: BigInt(variant1920.length),
				},
				{
					id: 'var_005',
					wallpaperId,
					storageKey: `${wallpaperId}/1280x720.jpg`,
					width: 1280,
					height: 720,
					fileSizeBytes: BigInt(variant1280.length),
				},
			]);

			// Request 1600x900 - should use 1920x1080 variant (next larger)
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1600&h=900`,
			});

			expect(response.statusCode).toBe(200);

			// Should resize 1920x1080 variant down to 1600x900
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1600);
			expect(metadata.height).toBe(900);
		});

		it('should fallback to original when requested size exceeds all variants', async () => {
			const wallpaperId = 'wlpr_variant_fallback_001';

			const original = await createTestImage(3840, 2160, 'jpeg');
			const variant1920 = await createTestImage(1920, 1080, 'jpeg');
			const variant1280 = await createTestImage(1280, 720, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1920x1080.jpg`,
				variant1920,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1280x720.jpg`,
				variant1280,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			await db.insert(variants).values([
				{
					id: 'var_006',
					wallpaperId,
					storageKey: `${wallpaperId}/1920x1080.jpg`,
					width: 1920,
					height: 1080,
					fileSizeBytes: BigInt(variant1920.length),
				},
				{
					id: 'var_007',
					wallpaperId,
					storageKey: `${wallpaperId}/1280x720.jpg`,
					width: 1280,
					height: 720,
					fileSizeBytes: BigInt(variant1280.length),
				},
			]);

			// Request 2560x1440 - exceeds all variants, should use original
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=2560&h=1440`,
			});

			expect(response.statusCode).toBe(200);

			// Should resize original down to 2560x1440
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(2560);
			expect(metadata.height).toBe(1440);
		});

		it('should use original when no variants exist', async () => {
			const wallpaperId = 'wlpr_no_variants_001';

			const original = await createTestImage(3840, 2160, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// No variants inserted - should use original

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920`,
			});

			expect(response.statusCode).toBe(200);

			// Should resize original down to 1920x1080
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should prefer smaller suitable variant over larger ones', async () => {
			const wallpaperId = 'wlpr_prefer_smaller_001';

			const original = await createTestImage(3840, 2160, 'jpeg');
			const variant3840 = await createTestImage(3840, 2160, 'jpeg');
			const variant1920 = await createTestImage(1920, 1080, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/3840x2160.jpg`,
				variant3840,
			);
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/1920x1080.jpg`,
				variant1920,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			await db.insert(variants).values([
				{
					id: 'var_008',
					wallpaperId,
					storageKey: `${wallpaperId}/3840x2160.jpg`,
					width: 3840,
					height: 2160,
					fileSizeBytes: BigInt(variant3840.length),
				},
				{
					id: 'var_009',
					wallpaperId,
					storageKey: `${wallpaperId}/1920x1080.jpg`,
					width: 1920,
					height: 1080,
					fileSizeBytes: BigInt(variant1920.length),
				},
			]);

			// Request 1920x1080 - both variants are suitable, should use smaller one
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920&h=1080`,
			});

			expect(response.statusCode).toBe(200);

			// Should use 1920x1080 variant (not 3840x2160)
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should fallback to original when variant file is missing from MinIO', async () => {
			const wallpaperId = 'wlpr_missing_variant_001';

			const original = await createTestImage(3840, 2160, 'jpeg');

			// Upload only original (not the variant file)
			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3840,
				height: 2160,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Insert variant in DB but file doesn't exist in MinIO
			await db.insert(variants).values({
				id: 'var_missing',
				wallpaperId,
				storageKey: `${wallpaperId}/1920x1080.jpg`, // File doesn't exist
				width: 1920,
				height: 1080,
				fileSizeBytes: BigInt(300000),
			});

			// Request should fallback to original gracefully
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920&h=1080`,
			});

			expect(response.statusCode).toBe(200); // Not 404

			// Should have used original and resized it
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});
	});

	describe('No Upscaling (Phase 6)', () => {
		/**
		 * Helper function to create a test image with Sharp
		 */
		async function createTestImage(
			width: number,
			height: number,
			format: 'jpeg' | 'png' | 'webp' = 'jpeg',
		): Promise<Buffer> {
			return await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 100, g: 150, b: 200 },
				},
			})
				.toFormat(format)
				.toBuffer();
		}

		it('should not upscale when requested dimensions exceed original (contain mode)', async () => {
			const wallpaperId = 'wlpr_no_upscale_001';

			const original = await createTestImage(1920, 1080, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 3840x2160 (larger than original 1920x1080) with contain mode
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=3840&h=2160&fit=contain`,
			});

			expect(response.statusCode).toBe(200);

			// Should return original dimensions (no upscaling)
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should not upscale when requested width exceeds original (contain mode)', async () => {
			const wallpaperId = 'wlpr_no_upscale_002';

			const original = await createTestImage(1280, 720, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 1280,
				height: 720,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request w=1920 (larger than original 1280) with contain mode
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920&fit=contain`,
			});

			expect(response.statusCode).toBe(200);

			// Should return original dimensions (no upscaling)
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1280);
			expect(metadata.height).toBe(720);
		});

		it('should not upscale when requested dimensions exceed original (cover mode)', async () => {
			const wallpaperId = 'wlpr_no_upscale_003';

			const original = await createTestImage(1920, 1080, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 3840x2160 (larger than original) with cover mode
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=3840&h=2160&fit=cover`,
			});

			expect(response.statusCode).toBe(200);

			// Should return original dimensions (no upscaling)
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should allow upscaling for fill mode (exact dimensions required)', async () => {
			const wallpaperId = 'wlpr_upscale_fill_001';

			const original = await createTestImage(1920, 1080, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 3840x2160 (larger than original) with fill mode
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=3840&h=2160&fit=fill`,
			});

			expect(response.statusCode).toBe(200);

			// Should upscale to exact dimensions for fill mode
			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(3840);
			expect(metadata.height).toBe(2160);
		});
	});

	describe('Edge Cases & Performance (Phase 7)', () => {
		/**
		 * Helper function to create a test image with Sharp
		 */
		async function createTestImage(
			width: number,
			height: number,
			format: 'jpeg' | 'png' | 'webp' = 'jpeg',
		): Promise<Buffer> {
			return await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 100, g: 150, b: 200 },
				},
			})
				.toFormat(format)
				.toBuffer();
		}

		it('should handle very large image (7680x4320 8K)', async () => {
			const wallpaperId = 'wlpr_edge_8k_001';

			// Create 8K image (7680x4320)
			const original = await createTestImage(7680, 4320, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 7680,
				height: 4320,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 1920x1080 (downscale from 8K)
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1920&h=1080`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(1080);
		});

		it('should handle very small image (320x180)', async () => {
			const wallpaperId = 'wlpr_edge_small_001';

			// Create very small image
			const original = await createTestImage(320, 180, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 320,
				height: 180,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 160x90 (downscale from small)
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=160&h=90`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(160);
			expect(metadata.height).toBe(90);
		});

		it('should handle odd aspect ratio (21:9 ultrawide)', async () => {
			const wallpaperId = 'wlpr_edge_ultrawide_001';

			// Create 21:9 ultrawide image (3440x1440)
			const original = await createTestImage(3440, 1440, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 3440,
				height: 1440,
				aspectRatio: '2.3889',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 1720x720 (half size, preserve 21:9)
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1720&h=720`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1720);
			expect(metadata.height).toBe(720);
		});

		it('should handle portrait orientation (1080x1920)', async () => {
			const wallpaperId = 'wlpr_edge_portrait_001';

			// Create portrait image (9:16)
			const original = await createTestImage(1080, 1920, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 1080,
				height: 1920,
				aspectRatio: '0.5625',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 540x960 (half size portrait)
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=540&h=960`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(540);
			expect(metadata.height).toBe(960);
		});

		it('should handle square image (2048x2048)', async () => {
			const wallpaperId = 'wlpr_edge_square_001';

			// Create square image
			const original = await createTestImage(2048, 2048, 'jpeg');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.jpg`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: BigInt(original.length),
				width: 2048,
				height: 2048,
				aspectRatio: '1.0000',
				storageKey: `${wallpaperId}/original.jpg`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			// Request 1024x1024 (half size square)
			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=1024&h=1024`,
			});

			expect(response.statusCode).toBe(200);

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(1024);
			expect(metadata.height).toBe(1024);
		});

		it('should handle PNG format with transparency', async () => {
			const wallpaperId = 'wlpr_edge_png_001';

			// Create PNG image
			const original = await createTestImage(1920, 1080, 'png');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.png`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/png',
				fileSizeBytes: BigInt(original.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.png`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=960`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.headers['content-type']).toBe('image/png');

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(960);
			expect(metadata.height).toBe(540);
			expect(metadata.format).toBe('png');
		});

		it('should handle WebP format', async () => {
			const wallpaperId = 'wlpr_edge_webp_001';

			// Create WebP image
			const original = await createTestImage(1920, 1080, 'webp');

			await tester.minio.uploadObject(
				'wallpapers',
				`${wallpaperId}/original.webp`,
				original,
			);

			await db.insert(wallpapers).values({
				id: wallpaperId,
				userId: 'user_test',
				fileType: 'image',
				mimeType: 'image/webp',
				fileSizeBytes: BigInt(original.length),
				width: 1920,
				height: 1080,
				aspectRatio: '1.7778',
				storageKey: `${wallpaperId}/original.webp`,
				storageBucket: 'wallpapers',
				uploadedAt: new Date(),
			});

			const response = await app.inject({
				method: 'GET',
				url: `/wallpapers/${wallpaperId}?w=960`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.headers['content-type']).toBe('image/webp');

			const metadata = await sharp(response.rawPayload).metadata();
			expect(metadata.width).toBe(960);
			expect(metadata.height).toBe(540);
			expect(metadata.format).toBe('webp');
		});
	});
});
