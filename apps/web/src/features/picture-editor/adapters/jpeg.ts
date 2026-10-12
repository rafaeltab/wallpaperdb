const encode = new TextEncoder();
const isoHeader = encode.encode('urn:iso:std:iso:ts:21496:-1\0');
const mpfHeader = encode.encode('MPF\0');
const xmpHeaders = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'].map(
  (text) => encode.encode(text)
);

function startsWith(bytes: Uint8Array, prefix: Uint8Array) {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function declaresGainMap(marker: number, payload: Uint8Array) {
  if (marker === 226) return startsWith(payload, mpfHeader) || startsWith(payload, isoHeader);
  if (marker !== 225 || !xmpHeaders.some((header) => startsWith(payload, header))) return false;
  return /xmlns(?::[\w.-]+)?\s*=\s*(['"])(?:http:\/\/ns\.adobe\.com\/hdr-gain-map\/1\.0\/|urn:com:apple:photo:2020:aux:hdrgainmap)\1/.test(
    new TextDecoder().decode(payload)
  );
}

/** Inspect all JPEG APP declarations, including between scans, with one bounded byte window. */
export async function validateJpegColor(file: Blob, signal: AbortSignal): Promise<void> {
  const windowSize = 65536;
  let window = new Uint8Array();
  let windowOffset = 0;
  const invalid = () => new Error('Choose a valid JPEG picture.');
  async function read(offset: number, length: number) {
    signal.throwIfAborted();
    if (offset + length > file.size) throw invalid();
    if (offset < windowOffset || offset + length > windowOffset + window.length) {
      windowOffset = offset;
      window = new Uint8Array(await file.slice(offset, offset + windowSize).arrayBuffer());
      signal.throwIfAborted();
    }
    return window.subarray(offset - windowOffset, offset - windowOffset + length);
  }
  async function nextMarker(offset: number) {
    while (offset < file.size) {
      await read(offset, 1);
      const index = window.indexOf(255, offset - windowOffset);
      if (index !== -1) return windowOffset + index;
      offset = windowOffset + window.length;
    }
    throw invalid();
  }
  let offset = 2;
  let entropy = false;
  while (offset < file.size) {
    if (entropy) offset = await nextMarker(offset);
    const bytes = await read(offset, 2);
    if (bytes[0] !== 255) throw invalid();
    const marker = bytes[1];
    if (marker === 255) {
      offset++;
      continue;
    }
    offset += 2;
    if (marker === 217) return;
    if ((marker === 0 && entropy) || marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (marker === 216 || marker === 0) throw invalid();
    const lengthBytes = await read(offset, 2);
    const length = lengthBytes[0] * 256 + lengthBytes[1];
    if (length < 2 || offset + length > file.size) throw invalid();
    if (
      (marker === 225 || marker === 226) &&
      declaresGainMap(marker, await read(offset + 2, length - 2))
    )
      throw new Error(
        "This picture's color interpretation is not supported. Choose another picture."
      );
    offset += length;
    if (marker === 218) entropy = true;
  }
  throw invalid();
}
