// Builds responsive WebP derivatives for every publishable image, and a manifest of
// intrinsic sizes. Originals in public/media and public/issues are never modified.
//   public/media/2026/05/wp-298.png  ->  public/_img/media/2026/05/wp-298-{480,960,1600}.webp
// Runs before `astro dev` and `astro build`; output is git-ignored and safe to delete.
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import sharp from 'sharp';
import { p, writeJson, exists } from './lib/util.ts';

const WIDTHS = [480, 960, 1600];
const ROOTS = ['media', 'issues'];
const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

function walk(dir: string): string[] {
  if (!exists(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : EXT.has(extname(d.name).toLowerCase()) ? [join(dir, d.name)] : []);
}

const manifest: Record<string, { width: number; height: number; variants: { width: number; path: string }[] }> = {};
let made = 0;
for (const root of ROOTS) {
  for (const file of walk(p('public', root))) {
    const publicPath = file.slice(p('public').length).split('\\').join('/');
    const meta = await sharp(file).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const entry = { width, height, variants: [] as { width: number; path: string }[] };
    manifest[publicPath] = entry;
    if (!width || extname(file).toLowerCase() === '.gif') continue;
    const targets = WIDTHS.filter((w) => w < width);
    if (targets.length < WIDTHS.length) targets.push(width); // never upscale; keep one full-size variant
    for (const w of targets) {
      const outPublic = `/_img${publicPath.replace(/\.[^.]+$/, '')}-${w}.webp`;
      const out = p('public' + outPublic);
      entry.variants.push({ width: w, path: outPublic });
      if (exists(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) continue;
      mkdirSync(dirname(out), { recursive: true });
      await sharp(file).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
      made++;
    }
  }
}
writeJson(p('src/data/media-manifest.json'), manifest);
console.log(`media: ${Object.keys(manifest).length} images, ${made} derivative(s) written`);
