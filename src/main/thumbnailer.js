// Image thumbnails using Electron's nativeImage (no native npm modules).
//   * Windows: createThumbnailFromPath uses the Windows shell, so it also covers HEIC/WEBP
//     when the matching Microsoft Store codecs are installed.
//   * Linux: createFromPath decodes JPEG and PNG. HEIC is converted first with
//     `heif-convert` (package libheif-examples) when that tool is installed.
// Formats that cannot be decoded simply get no thumbnail; the file still transfers normally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { nativeImage } from 'electron';

const SIZE = 360;
let heifConvert;

function findHeifConvert() {
  if (heifConvert !== undefined) return heifConvert;
  heifConvert = null;
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, 'heif-convert');
    if (d && fs.existsSync(p)) { heifConvert = p; break; }
  }
  return heifConvert;
}

function convertHeic(src) {
  const tool = findHeifConvert();
  if (!tool) return Promise.resolve(null);
  const out = path.join(os.tmpdir(), `enishare-heic-${process.pid}-${Date.now()}.jpg`);
  return new Promise((resolve) => {
    execFile(tool, ['-q', '80', src, out], { timeout: 30_000 }, (err) => resolve(err ? null : out));
  });
}

export async function makeThumbnail(src, dest) {
  let img;
  let tmp = null;
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      img = await nativeImage.createThumbnailFromPath(src, { width: SIZE, height: SIZE });
    } else {
      let input = src;
      if (/\.(heic|heif)$/i.test(src)) {
        tmp = await convertHeic(src);
        if (!tmp) return false;
        input = tmp;
      }
      img = nativeImage.createFromPath(input);
    }
    if (!img || img.isEmpty()) return false;
    const { width, height } = img.getSize();
    if (width > SIZE || height > SIZE) {
      img = width >= height ? img.resize({ width: SIZE, quality: 'good' }) : img.resize({ height: SIZE, quality: 'good' });
    }
    await fs.promises.writeFile(dest, img.toJPEG(78));
    return true;
  } catch {
    return false;
  } finally {
    if (tmp) fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
}
