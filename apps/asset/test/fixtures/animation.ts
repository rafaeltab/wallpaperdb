import sharp from 'sharp';

/** Repeat actual encoded frames without letting the encoder merge identical frames. */
export async function animatedPicture(frames: number, delayMs: number, loop: number) {
  const gif = Buffer.from(
    '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030102000021f904010a0000002c000000000100010000020244010021f90401140000002c00000000010001000002024c01003b',
    'hex'
  );
  const webp = await sharp(gif, { animated: true }).webp().toBuffer();
  const headers: Buffer[] = [];
  const encodedFrames: Buffer[] = [];
  for (let offset = 12; offset < webp.length; ) {
    const size = webp.readUInt32LE(offset + 4);
    const chunk = Buffer.from(webp.subarray(offset, offset + 8 + size + (size % 2)));
    const kind = chunk.toString('ascii', 0, 4);
    if (kind === 'ANMF') {
      chunk.writeUIntLE(delayMs, 20, 3);
      encodedFrames.push(chunk);
    } else {
      if (kind === 'ANIM') chunk.writeUInt16LE(loop, 12);
      headers.push(chunk);
    }
    offset += chunk.length;
  }
  if (encodedFrames.length !== 2) throw new Error('Expected two encoded fixture frames');
  const result = Buffer.concat([
    webp.subarray(0, 12),
    ...headers,
    ...Array.from({ length: frames }, (_, index) => {
      const frame = encodedFrames[index % 2];
      if (!frame) throw new Error('Missing encoded fixture frame');
      return frame;
    }),
  ]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
