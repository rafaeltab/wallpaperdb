/** Container declarations matter even when a decoder exposes only an SDR primary. */
export function checkEncodedPolicy(bytes: Buffer, picture: boolean): void {
  const isoGainMapHeader = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
  const invalid = () => {
    throw new Error('invalid-image');
  };
  const unsupported = () => {
    throw new Error('unsupported-source-model');
  };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      offset = bytes.indexOf(0xff, offset);
      if (offset < 0) break;
      while (bytes[++offset] === 0xff) {
        /* marker padding */
      }
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        if (offset !== bytes.length) invalid();
        return;
      }
      if (
        marker === 0 ||
        marker === 1 ||
        (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
      )
        continue;
      if (marker === 0xd8 || offset + 2 > bytes.length) invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      const data = bytes.subarray(offset + 2, offset + length);
      if (
        marker === 0xe2 &&
        (data.subarray(0, 4).equals(Buffer.from('MPF\0')) ||
          data.subarray(0, isoGainMapHeader.length).equals(isoGainMapHeader))
      )
        unsupported();
      if (
        marker === 0xe1 &&
        /(?:hdr-gain-map|hdrgainmap|hdrgm:|21496)/i.test(data.toString('utf8'))
      )
        unsupported();
      offset += length;
    }
    invalid();
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      if (size > bytes.length - offset - 12) invalid();
      const kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (kind === 'cICP' || kind === 'acTL') unsupported();
      offset += size + 12;
      if (kind === 'IEND') {
        if (offset !== bytes.length) invalid();
        return;
      }
    }
    invalid();
  }
  if (
    picture &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    if (bytes.readUInt32LE(4) !== bytes.length - 8) invalid();
    const chunks = (start: number, end: number, frame: boolean) => {
      let offset = start;
      while (offset + 8 <= end) {
        const kind = bytes.toString('ascii', offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4);
        const payload = offset + 8;
        const next = payload + size + (size % 2);
        if (next > end) invalid();
        const allowed = frame
          ? ['VP8 ', 'VP8L', 'ALPH']
          : ['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF'];
        if (!allowed.includes(kind)) throw new Error('noncanonical-picture');
        if (
          kind === 'VP8X' &&
          (size !== 10 ||
            (bytes.readUInt8(payload) & ~0x12) !== 0 ||
            bytes[payload + 1] !== 0 ||
            bytes[payload + 2] !== 0 ||
            bytes[payload + 3] !== 0)
        )
          throw new Error('noncanonical-picture');
        if (kind === 'ANIM' && size !== 6) invalid();
        if (kind === 'ANMF') {
          if (size < 16 || (bytes.readUInt8(payload + 15) & ~3) !== 0) invalid();
          chunks(payload + 16, payload + size, true);
        }
        offset = next;
      }
      if (offset !== end) invalid();
    };
    chunks(12, bytes.length, false);
  }
}
