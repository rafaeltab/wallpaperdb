import sharp from 'sharp';

/** Recorded #553 container: tiny lossless frames with independent WebP timings. */
export async function animationWebp(frames = 1850, delayMs = 10000000, loop = 0) {
  function chunk(tag: string, body: Buffer) {
    const out = Buffer.alloc(8 + body.length + (body.length % 2));
    out.write(tag);
    out.writeUInt32LE(body.length, 4);
    body.copy(out, 8);
    return out;
  }
  const stills = await Promise.all(
    ['black', 'white'].map((background) =>
      sharp({ create: { width: 1, height: 1, channels: 3, background } })
        .webp({ lossless: true })
        .toBuffer()
    )
  );
  const vx = Buffer.alloc(10);
  vx[0] = 2;
  const header = Buffer.alloc(16);
  header.writeUIntLE(delayMs, 12, 3);
  header[15] = 2;
  const animation = Buffer.alloc(6);
  animation.writeUInt16LE(loop, 4);
  const payload = Buffer.concat([
    Buffer.from('WEBP'),
    chunk('VP8X', vx),
    chunk('ANIM', animation),
    ...Array.from({ length: frames }, (_, i) =>
      chunk('ANMF', Buffer.concat([header, stills[i % 2].subarray(12)]))
    ),
  ]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF');
  riff.writeUInt32LE(payload.length, 4);
  return Buffer.concat([riff, payload]);
}
