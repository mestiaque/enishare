// CRC-32 (IEEE 802.3, same as zlib/zip). Used to check every upload chunk.
// The phone cannot use crypto.subtle on plain-HTTP pages, so both sides use this
// small table-driven implementation. The browser has its own copy in src/mobile/js/crc32.js.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Feed bytes incrementally: crc = crc32Update(crc, chunk) starting from 0. */
export function crc32Update(crc, bytes) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32(bytes) {
  return crc32Update(0, bytes);
}

export function crc32Hex(value) {
  return (value >>> 0).toString(16).padStart(8, '0');
}
