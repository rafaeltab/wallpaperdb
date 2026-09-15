import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '../src/index';

function createTester() {
  const Tester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(S3TesterBuilder)
    .build();
  const tester = new Tester();
  onTestFinished(async () => {
    await tester.destroy();
  });
  return tester;
}

describe('S3TesterBuilder (SeaweedFS S3 compatibility)', () => {
  it('creates requested buckets and is ready for writes immediately after setup', async () => {
    const tester = await createTester()
      .withS3()
      .withS3Bucket('uploads')
      .withS3Bucket('variants')
      .setup();

    const response = await tester.s3.getS3Client().send(new ListBucketsCommand());
    expect(response.Buckets?.map((bucket) => bucket.Name)).toEqual(
      expect.arrayContaining(['uploads', 'variants'])
    );
    await tester.s3.uploadObject('uploads', 'ready.txt', 'ready');
    expect(await tester.s3.objectExists('uploads', 'ready.txt')).toBe(true);
  });

  it('uses a configured SeaweedFS image', async () => {
    const customImage = 'docker.io/chrislusf/seaweedfs:4.47';
    const tester = await createTester()
      .withS3((builder) => builder.withImage(customImage))
      .setup();

    expect(tester.s3.config.options.image).toBe(customImage);
    await expect(tester.s3.getS3Client().send(new ListBucketsCommand())).resolves.toBeDefined();
  });

  it('accepts custom credentials and rejects incorrect or missing credentials', async () => {
    const accessKey = 'mycustomaccesskey';
    const secretKey = 'mycustomsecretkey123';
    const tester = await createTester()
      .withS3((builder) => builder.withAccessKey(accessKey).withSecretKey(secretKey))
      .withS3Bucket('private-bucket')
      .setup();
    const endpoint = tester.s3.config.endpoints.fromHost;

    const response = await tester.s3.getS3Client().send(new ListBucketsCommand());
    expect(response.Buckets?.map((bucket) => bucket.Name)).toContain('private-bucket');

    for (const credentials of [
      { accessKeyId: 'unknown-access-key', secretAccessKey: secretKey },
      { accessKeyId: accessKey, secretAccessKey: 'incorrect-secret-key' },
    ]) {
      const client = new S3Client({
        endpoint,
        region: 'us-east-1',
        credentials,
        forcePathStyle: true,
      });
      try {
        await expect(client.send(new ListBucketsCommand())).rejects.toMatchObject({
          $metadata: { httpStatusCode: 403 },
        });
      } finally {
        client.destroy();
      }
    }

    expect((await fetch(endpoint)).status).toBe(403);
  });

  it('uses the requested Docker network and alias while retaining port 9000', async () => {
    const alias = 'custom-object-storage';
    const tester = await createTester()
      .withNetwork()
      .withS3((builder) => builder.withNetworkAlias(alias))
      .withS3Bucket('network-bucket')
      .setup();
    const { container, endpoints } = tester.s3.config;
    const network = tester.getNetwork();

    expect(container.getNetworkNames()).toContain(network.getName());
    expect(endpoints.networked).toBe(`http://${alias}:9000`);
    expect(endpoints.directIp).toBe(`http://${container.getIpAddress(network.getName())}:9000`);
    expect(endpoints.fromHostDockerInternal).toBe(
      `http://host.docker.internal:${container.getMappedPort(9000)}`
    );
    const result = await container.exec(['wget', '-qO-', `${endpoints.networked}/healthz`]);
    expect(result.exitCode).toBe(0);
  });

  it('exposes a working endpoint without a custom Docker network', async () => {
    const tester = await createTester().withS3().setup();

    expect(tester.s3.config.endpoints.fromHost).toMatch(/^http:\/\/.+:\d+$/);
    await expect(tester.s3.getS3Client().send(new ListBucketsCommand())).resolves.toBeDefined();
  });

  it('stops the container on destroy', async () => {
    const tester = await createTester().withS3().setup();
    const container = tester.s3.config.container;
    expect((await container.exec(['true'])).exitCode).toBe(0);

    await tester.destroy();

    await expect(container.exec(['true'])).rejects.toThrow();
  });

  it('reports uninitialized storage before setup', () => {
    const tester = createTester().withS3();

    expect(() => tester.s3.config).toThrow('S3 not initialized');
  });

  it('supports object uploads, metadata, downloads, prefix listing, and deletion', async () => {
    const tester = await createTester().withS3().withS3Bucket('objects').setup();
    const client = tester.s3.getS3Client();
    await tester.s3.uploadObject('objects', 'images/test.txt', 'Hello, S3!', {
      ContentType: 'text/plain',
      Metadata: { source: 'integration-test' },
    });
    await tester.s3.uploadObject('objects', 'other.txt', 'another object');

    const metadata = await client.send(
      new HeadObjectCommand({ Bucket: 'objects', Key: 'images/test.txt' })
    );
    expect(metadata.ContentType).toBe('text/plain');
    expect(metadata.Metadata).toEqual({ source: 'integration-test' });
    expect(metadata.ContentLength).toBe(10);
    const response = await client.send(
      new GetObjectCommand({ Bucket: 'objects', Key: 'images/test.txt' })
    );
    expect(await response.Body?.transformToString()).toBe('Hello, S3!');
    expect(await tester.s3.listObjects('objects', 'images/')).toEqual(['images/test.txt']);

    await tester.s3.deleteObject('objects', 'images/test.txt');
    expect(await tester.s3.objectExists('objects', 'images/test.txt')).toBe(false);
    expect(await tester.s3.listObjects('objects')).toEqual(['other.txt']);
  });

  it('completes multipart uploads without changing the object bytes', async () => {
    const tester = await createTester().withS3().withS3Bucket('multipart').setup();
    const client = tester.s3.getS3Client();
    const object = { Bucket: 'multipart', Key: 'large-image.bin' };
    const { UploadId } = await client.send(new CreateMultipartUploadCommand(object));
    const bodies = [Buffer.alloc(5 * 1024 * 1024, 7), Buffer.from('final part')];
    const parts = [];
    for (const [index, Body] of bodies.entries()) {
      const PartNumber = index + 1;
      const { ETag } = await client.send(
        new UploadPartCommand({ ...object, UploadId, PartNumber, Body })
      );
      parts.push({ PartNumber, ETag });
    }
    await client.send(
      new CompleteMultipartUploadCommand({ ...object, UploadId, MultipartUpload: { Parts: parts } })
    );

    const response = await client.send(new GetObjectCommand(object));
    const actual = Buffer.from((await response.Body?.transformToByteArray()) ?? []);
    expect(actual.equals(Buffer.concat(bodies))).toBe(true);
  });

  it('requires explicit bucket creation and rejects deleting a nonempty bucket', async () => {
    const tester = await createTester().withS3().withS3Bucket('occupied-bucket').setup();

    await expect(
      tester.s3.uploadObject('missing-bucket', 'object.txt', 'test')
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });

    await tester.s3.uploadObject('occupied-bucket', 'object.txt', 'test');
    await expect(
      tester.s3.getS3Client().send(new DeleteBucketCommand({ Bucket: 'occupied-bucket' }))
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 409 } });
    expect(await tester.s3.objectExists('occupied-bucket', 'object.txt')).toBe(true);
  });

  it('cleans all configured buckets and preserves them for the next test', async () => {
    const tester = await createTester()
      .withS3()
      .withS3Bucket('uploads')
      .withS3Bucket('variants')
      .withS3AutoCleanup()
      .setup();
    await tester.s3.uploadObject('uploads', 'first.txt', 'first');
    await tester.s3.uploadObject('uploads', 'second.txt', 'second');
    await tester.s3.uploadObject('variants', 'variant.txt', 'variant');

    await tester.cleanup();

    expect(await tester.s3.listObjects('uploads')).toEqual([]);
    expect(await tester.s3.listObjects('variants')).toEqual([]);
    await tester.s3.uploadObject('uploads', 'next-test.txt', 'next');
    expect(await tester.s3.objectExists('uploads', 'next-test.txt')).toBe(true);
  });

  it('allows a requested bucket to be registered more than once', async () => {
    const tester = await createTester()
      .withS3()
      .withS3Bucket('repeated-bucket')
      .withS3Bucket('repeated-bucket')
      .setup();

    expect(await tester.s3.listObjects('repeated-bucket')).toEqual([]);
  });
});
