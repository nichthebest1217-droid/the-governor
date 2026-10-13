// Collects articles that editors have marked Approved in the Google Sheet and writes them into
// the repository. Run by .github/workflows/sync-docs.yml; safe to run by hand:
//   node scripts/sync-docs.ts            fetch and write
//   node scripts/sync-docs.ts --dry-run  fetch and report only
//
// The Sheet's answer is treated as untrusted data: only article, writer and photo files in
// their expected folders are accepted, and files this sync did not create are never replaced.
import { readFileSync } from 'node:fs';
import { p, exists, readJson, writeFile, readFrontmatter } from './lib/util.ts';

const DRY = process.argv.includes('--dry-run');
const configFile = p('google-workspace/endpoint.json');
if (!exists(configFile)) { console.log('sync-docs: google-workspace/endpoint.json not found; nothing to do.'); process.exit(0); }
const { url } = readJson<{ url: string }>(configFile);
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url ?? '')) { console.error('sync-docs: endpoint.json does not hold a Google Apps Script web address.'); process.exit(1); }

const ARTICLE = /^src\/content\/articles\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const AUTHOR = /^src\/content\/authors\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
const PHOTO = /^public\/media\/\d{4}\/\d{2}\/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/;
const MAX_TEXT = 400_000;
const MAX_PHOTO = 6_000_000;

const res = await fetch(url, { redirect: 'follow' });
const text = await res.text();
if (!res.ok || !text.trim().startsWith('{')) { console.error(`sync-docs: the Sheet did not answer with data (HTTP ${res.status}). Is the web app deployed for "Anyone"?`); process.exit(1); }
const data = JSON.parse(text) as { articles: { row: number; title: string; files: { path: string; content: string; isBase64?: boolean; onlyIfMissing?: boolean }[] }[]; problems: { row: number; headline: string; message: string }[] };

let written = 0;
const skipped: string[] = [];
for (const article of data.articles ?? []) {
  for (const file of article.files ?? []) {
    const path = String(file.path);
    const kind = ARTICLE.test(path) ? 'article' : AUTHOR.test(path) ? 'author' : PHOTO.test(path) ? 'photo' : null;
    if (!kind || path.includes('..')) { skipped.push(`row ${article.row}: refused unexpected path ${path}`); continue; }
    const bytes = file.isBase64 ? Buffer.from(String(file.content), 'base64') : Buffer.from(String(file.content), 'utf8');
    if ((kind === 'photo') !== Boolean(file.isBase64) || bytes.length > (kind === 'photo' ? MAX_PHOTO : MAX_TEXT) || bytes.length === 0) { skipped.push(`row ${article.row}: refused ${path} (wrong type or size)`); continue; }
    if (kind === 'photo' && !(bytes[0] === 0xff && bytes[1] === 0xd8)) { skipped.push(`row ${article.row}: ${path} is not a JPEG`); continue; }
    const target = p(path);
    if (exists(target)) {
      if (kind === 'author') continue; // writer records are created once, then edited by hand
      if (kind === 'article' && !readFrontmatter(readFileSync(target, 'utf8')).data.sourceDoc) { skipped.push(`row ${article.row}: ${path} already exists and did not come from the Sheet; left alone`); continue; }
      if (Buffer.compare(readFileSync(target), bytes) === 0) continue;
    }
    if (kind === 'article') {
      const { data: fm } = readFrontmatter(bytes.toString('utf8'));
      if (!fm.title || !fm.sourceDoc || fm.published !== true) { skipped.push(`row ${article.row}: ${path} is missing required fields`); continue; }
    }
    if (kind === 'author') { try { JSON.parse(bytes.toString('utf8')); } catch { skipped.push(`row ${article.row}: ${path} is not valid JSON`); continue; } }
    if (!DRY) writeFile(target, bytes);
    written++;
    console.log(`${DRY ? 'would write' : 'wrote'} ${path}`);
  }
}
for (const s of skipped) console.warn('skipped: ' + s);
for (const pr of data.problems ?? []) console.warn(`sheet row ${pr.row} ("${pr.headline}") is not ready: ${pr.message}`);
console.log(`sync-docs: ${data.articles?.length ?? 0} approved row(s), ${written} file(s) ${DRY ? 'to write' : 'written'}, ${skipped.length} skipped, ${data.problems?.length ?? 0} row(s) with problems.`);
