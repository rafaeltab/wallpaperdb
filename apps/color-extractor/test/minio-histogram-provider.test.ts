import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { container } from 'tsyringe';
import { InProcessColorExtractorTesterBuilder } from './builders/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(MinioTesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessColorExtractorTesterBuilder)
  .build();

describe('MinioHistogramProvider', () => {
  let tester: InstanceType<typeof TesterClass>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester
      .withMinio()
      .withMinioBucket('wallpapers')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withInProcessApp();

    await tester.setup();
  }, 120000);

  afterAll(async () => {
    await tester.destroy();
  });

  async function createTestImage(
    width: number,
    height: number,
    options?: { r?: number; g?: number; b?: number; a?: number },
  ): Promise<Buffer> {
    const { r = 255, g = 0, b = 0, a } = options ?? {};
    const channels = a !== undefined ? 4 : 3;
    const background: Record<string, number> = { r, g, b };
    if (a !== undefined) background.a = a;

    return sharp({
      create: { width, height, channels, background },
    })
      .raw()
      .toBuffer();
  }

  it('should extract a 64-dim normalized histogram from a solid red image', async () => {
    const { MinioHistogramProvider } = await import(
      '../src/services/minio-histogram-provider.js'
    );
    const provider = container.resolve(MinioHistogramProvider);

    const wallpaperId = `wlpr_red_${Date.now()}`;
    const imageBuffer = await createTestImage(100, 100, { r: 255, g: 0, b: 0 });
    await tester.minio.uploadObject(
      'wallpapers',
      `${wallpaperId}/original.jpg`,
      imageBuffer,
    );

    const result = await provider.extractHistogram(
      'wallpapers',
      `${wallpaperId}/original.jpg`,
    );

    expect(result).toHaveLength(64);
    expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 5);
  });

  it('should produce correct bin distribution for pure red', async () => {
    const { MinioHistogramProvider } = await import(
      '../src/services/minio-histogram-provider.js'
    );
    const provider = container.resolve(MinioHistogramProvider);

    const wallpaperId = `wlpr_purered_${Date.now()}`;
    const imageBuffer = await createTestImage(50, 50, { r: 255, g: 0, b: 0 });
    await tester.minio.uploadObject(
      'wallpapers',
      `${wallpaperId}/original.png`,
      imageBuffer,
    );

    const result = await provider.extractHistogram(
      'wallpapers',
      `${wallpaperId}/original.png`,
    );

    const redBin = 0 * 4 + 1 * 2 + 1;
    expect(result[redBin]).toBeCloseTo(1.0, 3);

    for (let i = 0; i < 64; i++) {
      if (i !== redBin) {
        expect(result[i]).toBeCloseTo(0, 3);
      }
    }
  });

  it('should handle images with alpha transparency', async () => {
    const { MinioHistogramProvider } = await import(
      '../src/services/minio-histogram-provider.js'
    );
    const provider = container.resolve(MinioHistogramProvider);

    const wallpaperId = `wlpr_alpha_${Date.now()}`;
    const imageBuffer = await createTestImage(100, 100, { r: 255, g: 0, b: 0, a: 128 });
    await tester.minio.uploadObject(
      'wallpapers',
      `${wallpaperId}/original.png`,
      imageBuffer,
    );

    const result = await provider.extractHistogram(
      'wallpapers',
      `${wallpaperId}/original.png`,
    );

    expect(result).toHaveLength(64);
    expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 5);
  });

  it('should downscale large images before processing', async () => {
    const { MinioHistogramProvider } = await import(
      '../src/services/minio-histogram-provider.js'
    );
    const provider = container.resolve(MinioHistogramProvider);

    const wallpaperId = `wlpr_large_${Date.now()}`;
    const imageBuffer = await createTestImage(3840, 2160, { r: 0, g: 0, b: 255 });
    await tester.minio.uploadObject(
      'wallpapers',
      `${wallpaperId}/original.png`,
      imageBuffer,
    );

    const result = await provider.extractHistogram(
      'wallpapers',
      `${wallpaperId}/original.png`,
    );

    expect(result).toHaveLength(64);
    expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 5);

    const blueBin = 8 * 4 + 1 * 2 + 1;
    expect(result[blueBin]).toBeCloseTo(1.0, 3);
  });
});
