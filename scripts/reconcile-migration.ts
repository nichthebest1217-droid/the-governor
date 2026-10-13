// Phase 4.4: reconcile the source inventory against imported content and (if built) dist/.
// Exits 1 on any unexplained gap. Writes migration/reconciliation.json for the reports.
import { readFileSync, readdirSync } from 'node:fs';
import { p, exists, readJson, writeJson, readFrontmatter, parseCsv, htmlToText, wordTokens } from './lib/util.ts';
import { markdownToText, parseByline, splitFirstParagraph } from './lib/convert.ts';

const inventory: any[] = readJson(p('migration/source-inventory.json'));
const urlMap = parseCsv(readFileSync(p('migration/url-map.csv'), 'utf8'));
const review = parseCsv(readFileSync(p('migration/review-queue.csv'), 'utf8'));
const audit = readJson(p('migration/audit-summary.json'));
const BASE = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');

const articles = readdirSync(p('src/content/articles')).filter((f) => f.endsWith('.md')).map((f) => ({ file: f, ...readFrontmatter(readFileSync(p('src/content/articles', f), 'utf8')) }));
const byWpId = new Map(articles.filter((a) => a.data.legacyWpId).map((a) => [a.data.legacyWpId, a]));
const srcPosts = inventory.filter((i) => i.sourceType === 'post');
const errors: string[] = [];
const rows: any[] = [];

for (const src of srcPosts) {
  const a = byWpId.get(src.legacyWpId);
  const row: any = { legacyWpId: src.legacyWpId, title: src.title, imported: Boolean(a) };
  if (!a) { errors.push(`post ${src.legacyWpId} "${src.title}" was not imported`); rows.push(row); continue; }
  row.titleMatch = a.data.title === src.title;
  row.dateMatch = a.data.publishedAt === src.publishedAt;
  row.pathMatch = a.data.legacyPath === src.legacyPath;
  row.sectionMatch = src.categories.includes(a.data.section);
  row.bylineMatch = (a.data.originalByline ?? '') === src.bylineText && (a.data.authors ?? []).length === src.bylineAuthors.length;
  row.coverMatch = Boolean(a.data.coverImage) === Boolean(src.featuredMediaId);
  // Word-for-word: the untouched source HTML (minus its byline line) vs the Markdown on disk.
  let html = readFileSync(p(`migration/source-html/${src.legacyWpId}.html`), 'utf8');
  const split = splitFirstParagraph(html);
  if (split && parseByline(htmlToText(split.first))) html = split.rest;
  const want = wordTokens(htmlToText(html));
  const got = wordTokens(markdownToText(a.body));
  row.sourceWords = want.length;
  row.importedWords = got.length;
  row.textMatch = want.join(' ') === got.join(' ');
  if (exists(p('dist'))) {
    const page = p('dist' + src.legacyPath + 'index.html');
    row.built = exists(page);
    if (row.built) {
      const built = readFileSync(page, 'utf8');
      const prose = /<div class="prose">([\s\S]*?)<\/div>\s*<\/div>\s*<footer class="article-foot"/.exec(built)?.[1] ?? '';
      row.renderedTextMatch = wordTokens(htmlToText(prose)).join(' ') === want.join(' ');
    }
  }
  for (const [k, v] of Object.entries(row)) if (v === false) errors.push(`post ${src.legacyWpId} "${src.title}": ${k} failed`);
  rows.push(row);
}

// Every inventoried URL must appear in the URL map with a decided status.
const mapped = new Map(urlMap.map((r) => [decodeURI(r.legacyUrl), r]));
for (const item of inventory) {
  const r = mapped.get(decodeURI(item.legacyUrl));
  if (!r) errors.push(`${item.sourceType} ${item.legacyWpId} (${item.legacyUrl}) is missing from url-map.csv`);
  else if (r.status === 'blocked') errors.push(`${item.sourceType} ${item.legacyWpId} is blocked: ${r.note}`);
}
if (exists(p('dist'))) {
  for (const r of urlMap.filter((x) => ['migrated', 'redirect', 'replaced', 'rebuilt'].includes(x.status) && x.newPath)) {
    const target = p('dist' + r.newPath);
    if (!exists(target) && !exists(target + 'index.html')) errors.push(`url-map target not in build: ${r.newPath} (from ${r.legacyUrl})`);
  }
  // Old /category/<slug>/ and /news-2/ paths must still answer.
  for (const r of urlMap.filter((x) => x.status === 'redirect')) {
    const oldPath = decodeURI(new URL(r.legacyUrl).pathname);
    if (!exists(p('dist' + oldPath + 'index.html'))) errors.push(`redirect stub missing for ${oldPath}`);
  }
}

const reviewErrors = review.filter((r) => r.severity === 'error');
const count = (rowsIn: any[], key: string) => rowsIn.filter((r) => r[key]).length;
const bySection = (list: { data: any }[]) => list.reduce((acc: Record<string, number>, a) => ({ ...acc, [a.data.section]: (acc[a.data.section] ?? 0) + 1 }), {});
const result = {
  generatedAt: new Date().toISOString(),
  basePath: BASE,
  source: {
    posts: srcPosts.length, pages: inventory.filter((i) => i.sourceType === 'page').length,
    categories: inventory.filter((i) => i.sourceType === 'category').length, attachments: inventory.filter((i) => i.sourceType === 'attachment').length,
    postsByCategory: audit.postsByCategory, categoryCountsFromApi: audit.categoryCountsFromApi, sitemapUrls: audit.reconciliation.sitemapUrls,
  },
  imported: {
    articles: byWpId.size,
    articlesBySection: bySection([...byWpId.values()]),
    titleMatch: count(rows, 'titleMatch'), dateMatch: count(rows, 'dateMatch'), pathMatch: count(rows, 'pathMatch'),
    bylineMatch: count(rows, 'bylineMatch'), coverMatch: count(rows, 'coverMatch'), textMatch: count(rows, 'textMatch'),
    built: exists(p('dist')) ? count(rows, 'built') : null,
    renderedTextMatch: exists(p('dist')) ? count(rows, 'renderedTextMatch') : null,
    authors: readdirSync(p('src/content/authors')).length,
    issues: readdirSync(p('src/content/issues')).length,
  },
  urlMap: urlMap.reduce((acc: Record<string, number>, r) => ({ ...acc, [`${r.sourceType}:${r.status}`]: (acc[`${r.sourceType}:${r.status}`] ?? 0) + 1 }), {}),
  reviewQueue: review.reduce((acc: Record<string, number>, r) => ({ ...acc, [`${r.severity}:${r.type}`]: (acc[`${r.severity}:${r.type}`] ?? 0) + 1 }), {}),
  openSourceDiscrepancies: reviewErrors.map((r) => `${r.item}: ${r.detail}`),
  errors,
  completeness: errors.length === 0 && reviewErrors.length === 0
    ? 'complete against the public API, sitemap and feed'
    : errors.length === 0
      ? 'every publicly readable item is migrated; source discrepancies remain open (see openSourceDiscrepancies). NOT yet verifiable as complete.'
      : 'INCOMPLETE',
};
writeJson(p('migration/reconciliation.json'), result);
writeJson(p('migration/reconciliation-rows.json'), rows);
const { errors: _e, ...print } = result;
console.log(JSON.stringify(print, null, 2));
if (errors.length) { console.error(`\n${errors.length} reconciliation error(s):`); for (const e of errors) console.error('  ' + e); process.exit(1); }
console.log('\nreconcile: every public source post is imported and matches its source.');
