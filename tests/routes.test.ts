// Smoke tests against the built site. Run `npm run build` first (CI does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { p, exists, readJson, htmlToText } from '../scripts/lib/util.ts';

const DIST = p('dist');
const BASE = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const skip = !exists(DIST) && 'dist/ not built';
const page = (path: string) => readFileSync(join(DIST, path, 'index.html'), 'utf8');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);

test('every legacy article path is served at the same path', { skip }, () => {
  const posts = readJson(p('migration/source-inventory.json')).filter((i: any) => i.sourceType === 'post');
  assert.ok(posts.length >= 55);
  for (const post of posts) {
    assert.ok(exists(join(DIST, post.legacyPath, 'index.html')), `missing ${post.legacyPath}`);
    assert.ok(page(post.legacyPath).includes('<h1'), post.legacyPath);
  }
});

test('representative article: headline, byline, date, canonical, structured data, body', { skip }, () => {
  const html = page('/2026/05/14/more-than-free-time-the-real-value-of-senior-spring-term-projects/');
  assert.match(html, /<h1[^>]*>More Than Free Time: The Real Value of Senior Spring Term Projects<\/h1>/);
  assert.match(html, /href="[^"]*\/authors\/maxwell-donahue\/"[^>]*>Maxwell Donahue ’26<\/a>/);
  assert.match(html, /<time datetime="2026-05-14T[^"]+"[^>]*>May 14, 2026<\/time>/);
  assert.match(html, /<link rel="canonical" href="[^"]+\/2026\/05\/14\/more-than-free-time-the-real-value-of-senior-spring-term-projects\/"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
  assert.equal(ld['@type'], 'NewsArticle');
  assert.equal(ld.author[0].name, 'Maxwell Donahue');
  assert.equal(ld.datePublished.slice(0, 10), '2026-05-14');
  const text = htmlToText(html);
  assert.ok(text.includes('Senior spring is the culminating experience of your High School career.'));
  assert.ok(!/>\s*by Maxwell Donahue ‘26\s*</.test(html), 'the byline line is metadata, not a body paragraph');
  assert.match(html, /<li>Making Mugs for the Dining Hall<\/li>/);
});

test('editorials, multi-author bylines and inline images render', { skip }, () => {
  const ed = page('/2026/05/12/reviving-the-weekends-bringing-energy-back-to-govs/');
  assert.match(ed, /Editorial/);
  for (const a of ['adam-krogmeier', 'tyler-passero', 'alex-hughey', 'rhoads-kent']) assert.ok(ed.includes(`/authors/${a}/`), a);
  assert.ok(ed.includes('/issues/2026-spring-issue-4/'));
  assert.ok(JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(ed)![1])['@type'] === 'OpinionNewsArticle');
  const inline = page('/2026/05/12/how-do-you-spend-your-pa-block/');
  assert.match(inline, /<img[^>]+srcset="[^"]*wp-265-[0-9]+\.webp/);
});

test('sections, archives, authors, issues and info pages exist', { skip }, () => {
  for (const path of ['/', '/news/', '/opinion/', '/opinion/2/', '/arts/', '/sports/', '/humor-fun/', '/people/', '/school-culture/', '/archives/', '/archives/2025-2026/',
    '/authors/', '/authors/amber-ding/', '/issues/', '/issues/2026-spring-issue-3/', '/about/', '/masthead/', '/corrections/', '/contact/', '/join/', '/privacy/', '/search/',
    '/category/news/', '/category/humor-fun/', '/news-2/']) {
    assert.ok(exists(join(DIST, path, 'index.html')), `missing ${path}`);
  }
  for (const f of ['404.html', 'rss.xml', 'sitemap-index.xml', 'robots.txt', 'favicon.svg', 'issues/2026-spring-issue-3.pdf', 'pagefind/pagefind.js', 'pagefind/pagefind-ui.js']) assert.ok(exists(join(DIST, f)), `missing ${f}`);
  assert.equal((page('/issues/2026-spring-issue-3/').match(/<figcaption>Page \d<\/figcaption>/g) ?? []).length, 8);
  assert.match(page('/category/news/'), new RegExp(`url=${BASE}news/`));
});

test('navigation, skip link and landmarks are on every full page', { skip }, () => {
  for (const path of ['/', '/news/', '/about/', '/2026/05/12/remembering-fafa/']) {
    const html = page(path);
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main id="main"/);
    assert.match(html, /<nav class="site-nav" aria-label="Sections">/);
    assert.match(html, /<html lang="en">/);
    assert.equal((html.match(/<h1/g) ?? []).length, 1, `${path}: exactly one h1`);
    for (const s of ['news', 'opinion', 'arts', 'sports', 'humor-fun', 'people', 'school-culture']) assert.ok(html.includes(`href="${BASE}${s}/"`), `${path}: nav link ${s}`);
  }
});

test('drafts never reach the site, the feed, the sitemap or the search index', { skip }, () => {
  const canary = 'DRAFT-LEAK-CANARY-7f3a';
  assert.ok(readFileSync(p('src/content/articles/0000-00-00-draft-example-not-published.md'), 'utf8').includes(canary), 'fixture present');
  for (const file of walk(DIST)) {
    if (/\.(png|jpe?g|webp|pdf|woff2?|pf_meta|pf_index|pf_fragment|pagefind|wasm)$/.test(file) && !file.endsWith('.pf_fragment')) continue;
    const buf = readFileSync(file);
    assert.ok(!buf.includes(canary) && !buf.includes('DRAFT EXAMPLE'), `draft content leaked into ${file.slice(DIST.length)}`);
  }
  assert.ok(!walk(DIST).some((f) => f.includes('draft-example')), 'no route was generated for the draft');
  // Pagefind fragments are gzipped: count them instead. 55 articles + issues + about + corrections.
  const fragments = readdirSync(join(DIST, 'pagefind/fragment')).length;
  const articles = readJson(p('migration/source-inventory.json')).filter((i: any) => i.sourceType === 'post').length;
  assert.ok(fragments >= articles, `search index has ${fragments} pages for ${articles} articles`);
});

test('feed and robots behave', { skip }, () => {
  const rss = readFileSync(join(DIST, 'rss.xml'), 'utf8');
  assert.ok((rss.match(/<item>/g) ?? []).length >= 20);
  assert.ok(rss.includes('When Govs Comes Back to Life'));
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  if (process.env.SITE_INDEXABLE === 'true') assert.match(robots, /Sitemap:/);
  else assert.match(robots, /Disallow: \/\n/, 'pre-launch builds must not be indexable');
});

test('nothing on the built site depends on the old WordPress host', { skip }, () => {
  for (const file of walk(DIST).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    assert.ok(!/(src|srcset|href)="[^"]*(wpcomstaging\.com|i\d\.wp\.com)/.test(html), `${file.slice(DIST.length)} loads from WordPress`);
  }
});
