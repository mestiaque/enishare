import fsp from 'node:fs/promises';

/** Free bytes available to this user on the filesystem holding `dir`, or null if unknown. */
export async function freeSpace(dir) {
  try {
    const s = await fsp.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
