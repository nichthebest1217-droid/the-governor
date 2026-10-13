// Collects articles that editors have marked Approved in the Google Sheet and writes them into
// the repository. Run by .github/workflows/sync-docs.yml; safe to run by hand:
//   node scripts/sync-docs.ts            fetch and write
//   node scripts/sync-docs.ts --dry-run  fetch and report only
//
// The Sheet's answer is treated as untrusted data: only article, writer and photo files in
// their expected folders are accepted, and files this sync did not create are never replaced.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
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
const data = JSON.parse(text) as { settings?: any; articles: { row: number; title: string; files: { path: string; content: string; isBase64?: boolean; onlyIfMissing?: boolean }[] }[]; problems: { row: number; headline: string; message: string }[] };

let written = 0;
const skipped: string[] = [];
for (const article of data.articles ?? []) {
  for (const file of article.files ?? []) {
    const path = String(file.path);
    const kind = ARTICLE.test(path) ? 'article' : AUTHOR.test(path) ? 'author' : PHOTO.test(path) ? 'photo' : null;
    if (!kind || path.includes('..')) { skipped.push(`row ${article.row}: refused unexpected path ${path}`); continue; }
    let bytes = file.isBase64 ? Buffer.from(String(file.content), 'base64') : Buffer.from(String(file.content), 'utf8');
    if ((kind === 'photo') !== Boolean(file.isBase64) || bytes.length > (kind === 'photo' ? MAX_PHOTO : MAX_TEXT) || bytes.length === 0) { skipped.push(`row ${article.row}: refused ${path} (wrong type or size)`); continue; }
    if (kind === 'photo') {
      // Whatever Drive sent (JPEG, PNG, WebP...), re-encode it as a plain JPEG no wider than
      // 2000 pixels. This proves it is a real image and drops camera metadata such as GPS location.
      try { bytes = await sharp(bytes).rotate().resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer(); }
      catch { skipped.push(`row ${article.row}: ${path} is not a readable image`); continue; }
    }
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
// ---- settings tabs: front page, masthead, contact details -------------------
// Each value is checked; anything that does not fit is ignored and the current setting kept.
const writeJsonIfChanged = (rel: string, value: unknown) => {
  const next = JSON.stringify(value, null, 2) + '\n';
  if (exists(p(rel)) && readFileSync(p(rel), 'utf8') === next) return;
  if (!DRY) writeFile(p(rel), next);
  written++;
  console.log(`${DRY ? 'would update' : 'updated'} ${rel}`);
};
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const articleExists = (id: unknown) => typeof id === 'string' && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(id) && exists(p(`src/content/articles/${id}.md`));
const settings = data.settings ?? {};
if (settings.homepage && typeof settings.homepage === 'object') {
  const h = settings.homepage;
  const current = readJson<any>(p('src/data/homepage.json'));
  const ids = (list: unknown, max: number) => (Array.isArray(list) ? list : []).filter((id) => { const ok = articleExists(id); if (!ok) skipped.push(`Homepage tab: "${id}" is not an article on the site`); return ok; }).slice(0, max);
  if (h.lead && !articleExists(h.lead)) skipped.push(`Homepage tab: lead story "${h.lead}" is not an article on the site`);
  const issue = str(h.currentIssue, 80);
  const issueOk = issue && /^[a-z0-9-]+$/.test(issue) && exists(p(`src/content/issues/${issue}.json`));
  if (issue && !issueOk) skipped.push(`Homepage tab: print issue "${issue}" does not exist`);
  const bannerText = str(h.alert?.text, 200);
  const bannerLink = str(h.alert?.href, 300);
  writeJsonIfChanged('src/data/homepage.json', {
    lead: articleExists(h.lead) ? h.lead : null,
    secondary: ids(h.secondary, 5),
    editorsPicks: ids(h.editorsPicks, 4),
    currentIssue: issueOk ? issue : current.currentIssue ?? null,
    alert: bannerText ? { text: bannerText, href: bannerLink && /^(https:\/\/|\/)/.test(bannerLink) ? bannerLink : null } : null,
  });
}
if (settings.site && typeof settings.site === 'object') {
  const current = readJson<any>(p('src/data/site.json'));
  // One address, or several separated by commas.
  const email = (v: unknown, label: string) => {
    const raw = str(v, 300);
    if (!raw) return null;
    const list = raw.split(/[,;\s]+/).filter(Boolean);
    const bad = list.filter((e) => !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e));
    if (bad.length || list.length > 5) { skipped.push(`Site tab: ${label} "${raw}" is not a list of email addresses`); return null; }
    return list.join(', ');
  };
  writeJsonIfChanged('src/data/site.json', { ...current, contactEmail: email(settings.site.contactEmail, 'contact email'), tipsEmail: email(settings.site.tipsEmail, 'tips email') });
}
if (Array.isArray(settings.masthead) && settings.masthead.length > 0) {
  // An empty Masthead tab changes nothing, so the page is never wiped by accident.
  const current = readJson<any>(p('src/data/masthead.json'));
  const groups: { title: string; members: { name: string; role: string | null }[] }[] = [];
  for (const row of settings.masthead.slice(0, 300)) {
    const title = str(row?.group, 60); const name = str(row?.name, 80);
    if (!title || !name) continue;
    let g = groups.find((x) => x.title === title);
    if (!g) { g = { title, members: [] }; groups.push(g); }
    g.members.push({ name, role: str(row?.role, 80) });
  }
  if (groups.length) writeJsonIfChanged('src/data/masthead.json', { academicYear: str(settings.site?.mastheadYear, 20) ?? current.academicYear ?? null, groups });
}

for (const s of skipped) console.warn('skipped: ' + s);
for (const pr of data.problems ?? []) console.warn(`sheet row ${pr.row} ("${pr.headline}") is not ready: ${pr.message}`);
console.log(`sync-docs: ${data.articles?.length ?? 0} approved row(s), ${written} file(s) ${DRY ? 'to write' : 'written'}, ${skipped.length} skipped, ${data.problems?.length ?? 0} row(s) with problems.`);
