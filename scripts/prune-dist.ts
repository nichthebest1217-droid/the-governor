// Keeps the published site small. After the build, full-size originals in dist/media and
// dist/issues are removed: every page loads the web-sized WebP copies in dist/_img instead.
// Originals stay in the repository (and should also live in the staff's Drive); PDFs are kept.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { p, readJson, exists } from './lib/util.ts';

const manifest: Record<string, { variants: unknown[] }> = readJson(p('src/data/media-manifest.json'));
let removed = 0;
let freed = 0;
for (const [publicPath, info] of Object.entries(manifest)) {
  if (!info.variants.length) continue; // nothing smaller to serve; keep the original
  const file = p('dist' + publicPath);
  if (!exists(file)) continue;
  freed += statSync(file).size;
  rmSync(file);
  removed++;
}
const walk = (dir: string): number => (exists(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? walk(join(dir, d.name)) : statSync(join(dir, d.name)).size), 0) : 0);
const total = walk(p('dist'));
console.log(`prune: removed ${removed} full-size originals (${(freed / 1048576).toFixed(1)} MB). Published site is ${(total / 1048576).toFixed(1)} MB, ${(total / 10737418.24).toFixed(1)}% of the 1 GB limit.`);
if (total > 900 * 1048576) { console.error('Published site is over 900 MB. Move PDFs to separate storage.'); process.exit(1); }
