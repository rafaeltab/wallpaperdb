import sharp from 'sharp';

// Recorded #553 input: independently encoded one-pixel frames prevent encoder coalescing.
export async function pictureAnimation(frames = 1850, delayMs = 10000000, loop = 0) {
  const chunk = (tag: string, body: Buffer) => {
    const bytes = Buffer.alloc(8 + body.length + (body.length % 2));
    bytes.write(tag);
    bytes.writeUInt32LE(body.length, 4);
    body.copy(bytes, 8);
    return bytes;
  };
  const stills = await Promise.all(
    ['black', 'white'].map((background) =>
      sharp({ create: { width: 1, height: 1, channels: 3, background } })
        .webp({ lossless: true })
        .toBuffer()
    )
  );
  const extended = Buffer.alloc(10);
  extended[0] = 2;
  const header = Buffer.alloc(16);
  header.writeUIntLE(delayMs, 12, 3);
  header[15] = 2;
  const animation = Buffer.alloc(6);
  animation.writeUInt16LE(loop, 4);
  const payload = Buffer.concat([
    Buffer.from('WEBP'),
    chunk('VP8X', extended),
    chunk('ANIM', animation),
    ...Array.from({ length: frames }, (_, i) => {
      const still = stills[i % 2];
      if (!still) throw new Error('Missing animation frame');
      return chunk('ANMF', Buffer.concat([header, still.subarray(12)]));
    }),
  ]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF');
  riff.writeUInt32LE(payload.length, 4);
  return Buffer.concat([riff, payload]);
}
