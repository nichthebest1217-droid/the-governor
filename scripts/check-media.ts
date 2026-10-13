// Verifies that every image/PDF referenced by content exists under public/, that nothing
// still points at the old WordPress host, and reports the published media weight against
// GitHub Pages' ~1 GB site limit.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { p, exists, readFrontmatter } from './lib/util.ts';

const problems: string[] = [];
const referenced = new Set<string>();
const need = (path: unknown, where: string) => {
  if (typeof path !== 'string' || !path) return;
  if (/wpcomstaging\.com|wp\.com\//.test(path)) { problems.push(`${where}: still points at the WordPress host: ${path}`); return; }
  if (/^https?:\/\//.test(path)) return;
  referenced.add(path);
  if (!exists(p('public' + path))) problems.push(`${where}: missing file public${path}`);
};

for (const f of readdirSync(p('src/content/articles'))) {
  const { data, body } = readFrontmatter(readFileSync(p('src/content/articles', f), 'utf8'));
  need(data.coverImage, f);
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) need(m[1], f);
  for (const m of body.matchAll(/<img[^>]+src="([^"]+)"/g)) need(m[1], f);
  if (/wpcomstaging\.com/.test(body)) problems.push(`${f}: body still links to the WordPress host`);
}
for (const dir of ['authors', 'issues']) {
  for (const f of readdirSync(p('src/content', dir))) {
    const data = JSON.parse(readFileSync(p('src/content', dir, f), 'utf8'));
    need(data.photo, f); need(data.pdf, f);
    for (const img of data.pageImages ?? []) need(img, f);
  }
}

const walk = (dir: string): string[] => (exists(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]) : []);
const files = [...walk(p('public/media')), ...walk(p('public/issues'))];
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
const unused = files.map((f) => f.slice(p('public').length)).filter((f) => !referenced.has(f) && !f.endsWith('.DS_Store'));
const big = files.filter((f) => statSync(f).size > 50 * 1024 * 1024);

console.log(`check-media: ${referenced.size} referenced files, ${files.length} files in public/media + public/issues, ${(bytes / 1048576).toFixed(1)} MB (${(bytes / 10737418.24).toFixed(1)}% of GitHub Pages' ~1 GB limit)`);
if (unused.length) console.log(`  note: ${unused.length} file(s) not referenced by any content:\n    ${unused.join('\n    ')}`);
for (const f of big) problems.push(`${f.slice(p('public').length)} is over 50 MB (GitHub rejects files over 100 MB)`);
if (bytes > 800 * 1048576) problems.push('Published media exceeds 800 MB; move large files to school-approved storage before the site reaches 1 GB.');
if (problems.length) { for (const x of problems) console.error('  PROBLEM ' + x); process.exit(1); }
console.log('check-media: all referenced media present');
