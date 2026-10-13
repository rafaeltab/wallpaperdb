import sharp from "sharp";

/** Deterministic native-codec input, generated instead of storing a multi-megabyte GIF. */
export async function fittingPicture() {
  const width = 256;
  const height = 256;
  const frameCount = 132;
  const parts: Buffer[] = [
    Buffer.from("GIF89a", "ascii"),
    Buffer.from([0, 1, 0, 1, 0, 0, 0]),
    Buffer.from("21ff0b4e45545343415045322e300301020000", "hex"),
  ];
  const encodedFrames: Buffer[][] = [];
  for (let frame = 0; frame < 4; frame++) {
    const pixels = Buffer.alloc(width * height * 4);
    let state = 13579 + frame * 891;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        pixels[offset] = state >>> 24;
        pixels[offset + 1] = state >>> 16;
        pixels[offset + 2] = state >>> 8;
        pixels[offset + 3] = y < 64 ? 0 : 255;
      }
    }
    // Keep native LZW data and palette unchanged, with explicit independent-frame controls.
    const gif = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .gif({ colours: 256, dither: 0 })
      .toBuffer();
    const paletteSize = 3 * (1 << ((gif[10] & 7) + 1));
    const palette = gif.subarray(13, 13 + paletteSize);
    let offset = 13 + paletteSize;
    let transparent = 0;
    while (gif[offset] === 0x21) {
      const label = gif[offset + 1];
      offset += 2;
      if (label === 0xf9) transparent = gif[offset + 4];
      while (gif[offset]) offset += 1 + gif[offset];
      offset++;
    }
    if (gif[offset] !== 0x2c || gif[offset + 9] & 128)
      throw new Error("Unexpected native single-frame GIF structure");
    const descriptor = Buffer.from(gif.subarray(offset, offset + 10));
    descriptor[9] = 128 | (gif[10] & 7);
    encodedFrames.push([
      Buffer.from([0x21, 0xf9, 4, 9, 10, 0, transparent, 0]),
      descriptor,
      palette,
      gif.subarray(offset + 10, gif.length - 1),
    ]);
  }
  for (let frame = 0; frame < frameCount; frame++)
    parts.push(...encodedFrames[frame % 4]);
  parts.push(Buffer.from([0x3b]));
  return {
    name: "profile-fitting.gif",
    mimeType: "image/gif",
    buffer: Buffer.concat(parts),
    frameCount,
    duration: 100000,
    repetitions: 2,
  };
}
