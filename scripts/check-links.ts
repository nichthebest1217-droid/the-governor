// Verifies every internal href/src/srcset in the built site (dist/) resolves to a real file.
// External links are listed, not fetched. Honours BASE_PATH so project-page builds can be checked.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { p, exists, decodeEntities } from './lib/util.ts';

const DIST = p('dist');
const BASE = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
if (!exists(DIST)) { console.error('dist/ not found. Run `npm run build` first.'); process.exit(1); }

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? (d.name === 'pagefind' ? [] : walk(join(dir, d.name))) : d.name.endsWith('.html') ? [join(dir, d.name)] : []);

function resolves(urlPath: string): boolean {
  if (!urlPath.startsWith(BASE)) return false;
  let rel: string;
  try { rel = decodeURIComponent(urlPath.slice(BASE.length)); } catch { return false; }
  const file = join(DIST, rel);
  if (!exists(file)) return false;
  return statSync(file).isDirectory() ? exists(join(file, 'index.html')) : true;
}

const broken: { page: string; ref: string }[] = [];
const external = new Set<string>();
let checked = 0;
const pages = walk(DIST);
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const refs: string[] = [];
  for (const m of html.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) refs.push(...m[1].split(',').map((s) => s.trim().split(/\s+/)[0]));
  for (const raw of refs) {
    const ref = decodeEntities(raw);
    if (!ref || ref.startsWith('#') || /^(mailto:|tel:|data:|javascript:)/.test(ref)) continue;
    if (/^https?:\/\//.test(ref)) { external.add(ref); continue; }
    if (ref.includes('/pagefind/')) continue; // generated after the Astro build
    checked++;
    const path = ref.split(/[?#]/)[0];
    if (!path.startsWith('/')) { broken.push({ page: page.slice(DIST.length), ref: `${ref} (relative link; use a root-relative path)` }); continue; }
    if (!resolves(path)) broken.push({ page: page.slice(DIST.length), ref });
  }
}
console.log(`check-links: ${pages.length} pages, ${checked} internal references, ${external.size} distinct external URLs (not fetched)`);
if (broken.length) {
  for (const b of broken.slice(0, 50)) console.error(`  BROKEN ${b.ref}\n         on ${b.page}`);
  console.error(`${broken.length} broken internal reference(s)`);
  process.exit(1);
}
console.log('check-links: no broken internal references');
