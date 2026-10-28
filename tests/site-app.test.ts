// The newspaper's pages as the Google-hosted site draws them (google-workspace/site/app.js), run in
// Node against the real archive bundle with stand-in Drive IDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { p, exists } from '../scripts/lib/util.ts';
import { buildGas } from '../scripts/lib/gas-build.ts';

new Function(readFileSync(p('google-workspace/site/app.js'), 'utf8'))();
const A = (globalThis as any).GovernorApp;
const APP = 'https://script.google.com/macros/s/APP/exec';
const skip = !exists(p('google-workspace/import/archive.json')) && 'run node scripts/build-archive.ts first';
const bundle = skip ? { articles: [], authors: {}, issues: [], brand: {} } : JSON.parse(readFileSync(p('google-workspace/import/archive.json'), 'utf8'));
const ref = (m: any) => (m ? { id: 'id' + m.path.replace(/\W/g, ''), w: m.w, h: m.h } : null);
const data = {
  articles: bundle.articles.map((a: any) => ({ ...a, cover: a.cover ? { ...ref(a.cover), alt: a.cover.alt, caption: a.cover.caption, credit: a.cover.credit } : null })),
  authors: Object.fromEntries(Object.entries<any>(bundle.authors).map(([k, v]) => [k, { ...v, photo: ref(v.photo) }])),
  issues: bundle.issues.map((i: any) => ({ ...i, pdf: i.pdf ? { id: 'pdf' + i.id } : null, pages: i.pages.map(ref) })),
  brand: Object.fromEntries(Object.entries<any>(bundle.brand).map(([k, v]) => [k, ref(v)])),
  settings: {
    homepage: { lead: null, secondary: [], editorsPicks: ['2026-05-12-remembering-fafa'], currentIssue: '2026-27-issue-1', alert: { text: 'Issue II is out <now>', href: '/issues/' } },
    site: { contactEmail: 'nicholas.zhuo@govsacademy.org, trobertson@govsacademy.org', tipsEmail: null, mastheadYear: '2026–27' },
    masthead: [{ group: 'Editors', name: 'Nicholas Zhuo ’27', role: '' }, { group: 'Advisor', name: 'Tom Robertson', role: '' }],
  },
};
const app = A.createApp(data, { appUrl: APP });
const bodies = Object.fromEntries(data.articles.map((a: any) => [a.id, a.body]));
const page = (path: string, extra = {}) => app.render(path, { bodies, ...extra });

test('every page renders: front page, sections, articles, archives, writers, issues, info pages', { skip }, () => {
  const paths = ['/', '/news/', '/opinion/', '/opinion/2/', '/archives/', '/archives/2025-2026/', '/authors/', '/issues/', '/issues/2026-27-issue-1/', '/about/', '/masthead/', '/corrections/', '/contact/', '/join/', '/privacy/', '/search/'];
  for (const path of paths) {
    const out = page(path);
    assert.notEqual(out.kind, 'not-found', path);
    assert.match(out.html, /<header class="site-header">[\s\S]*<main id="main">[\s\S]*<footer class="site-footer">/, path);
  }
  for (const a of data.articles) assert.equal(page(a.path).kind, 'article', a.path);
  assert.equal(data.articles.length, 69);
});

test('the front page keeps the approved layout', { skip }, () => {
  const html = page('/').html;
  for (const part of ['class="issue-strip"', 'class="package"', 'class="hero"', 'class="rail"', 'id="latest-head"', 'id="picks-head"', 'class="print-callout"', 'class="join"', 'class="site-nav"', 'class="np np-full"', 'class="alert-banner"']) assert.ok(html.includes(part), part);
  assert.ok(html.includes('Issue II is out &lt;now&gt;'), 'banner text is escaped');
  assert.equal((html.match(/class="wrap band" aria-labelledby="band-/g) ?? []).length, 7, 'one band per section');
  assert.match(html, /src="https:\/\/lh3\.googleusercontent\.com\/d\/[^"=]+=w\d+"/, 'pictures come from Drive');
});

test('links work inside the page and as shared addresses', { skip }, () => {
  const html = page('/').html;
  const links = [...html.matchAll(/<a href="([^"]*)" data-route="([^"]*)" target="_top"/g)];
  assert.ok(links.length > 50);
  for (const [, href, route] of links) assert.equal(href.replace(/&amp;/g, '&'), `${APP}?p=${encodeURIComponent(route)}`);
  const article = page('/2026/05/14/more-than-free-time-the-real-value-of-senior-spring-term-projects/');
  assert.match(article.html, /<h1>More Than Free Time: The Real Value of Senior Spring Term Projects<\/h1>/);
  assert.match(article.html, /data-copy="https:\/\/script\.google\.com\/macros\/s\/APP\/exec\?p=%2F2026%2F05%2F14%2F/);
  assert.match(article.html, /<a href="[^"]+" data-route="\/authors\/maxwell-donahue\/" target="_top">Maxwell Donahue ’26<\/a>/);
  assert.ok(article.html.includes('Senior spring is the culminating experience'), 'the article text is in the page');
});

test('articles: picture, caption and credit, editorials, print issue, related stories', { skip }, () => {
  const ed = page('/2026/05/12/reviving-the-weekends-bringing-energy-back-to-govs/').html;
  assert.match(ed, /· Editorial/);
  assert.ok(ed.includes('data-route="/issues/2026-spring-issue-4/"'));
  assert.match(ed, /id="related-head"/);
  const withCover = data.articles.find((a: any) => a.cover && a.cover.caption);
  if (withCover) assert.match(page(withCover.path).html, /<figure class="article-cover"[\s\S]*<figcaption class="caption">/);
  const loading = app.render(data.articles[0].path, {}).html;
  assert.match(loading, /Loading the article…/, 'before its text arrives, the page says so');
});

test('sections paginate twelve to a page; unknown pages are 404s; old addresses redirect', { skip }, () => {
  const opinion = data.articles.filter((a: any) => a.section === 'opinion').length;
  const last = Math.ceil(opinion / 12);
  assert.match(page('/opinion/').html, new RegExp(`${opinion} articles · Page 1 of ${last}`));
  assert.equal(page(`/opinion/${last + 1}/`).kind, 'not-found');
  assert.equal(page('/nothing-here/').kind, 'not-found');
  assert.equal(page('/category/news/').path, '/news/');
  assert.equal(page('/news-2/').path, '/news/');
  assert.equal(page('/authors/nobody/').kind, 'not-found');
});

test('print issues link to their PDF and page images in Drive', { skip }, () => {
  const html = page('/issues/2026-27-issue-1/').html;
  assert.ok(html.includes('https://drive.google.com/file/d/pdf2026-27-issue-1/view'));
  assert.equal((html.match(/<figcaption>Page \d<\/figcaption>/g) ?? []).length, 6);
  assert.match(page('/issues/2026-spring-issue-1/').html, /no PDF or page scans are in the archive yet/);
});

test('contact, masthead and search pages use the Sheet\'s settings', { skip }, () => {
  const contact = page('/contact/').html;
  assert.ok(contact.includes('mailto:nicholas.zhuo@govsacademy.org,trobertson@govsacademy.org?subject=News%20tip'));
  assert.match(page('/masthead/').html, /Editorial board and staff, 2026–27\.[\s\S]*Nicholas Zhuo ’27[\s\S]*Tom Robertson/);
  assert.match(page('/search/').html, /Type a headline, a writer or a phrase/);
  assert.match(page('/search/?q=dorms').html, /Searching…/);
  const results = page('/search/?q=dorms', { results: { dorms: [{ id: '2026-05-12-a-century-of-governors-academy-dorms', snippet: 'the first dorms' }] } }).html;
  assert.match(results, /1 article matches <strong>dorms<\/strong>[\s\S]*A Century of/);
  assert.match(page('/search/?q=zzz', { results: { zzz: [] } }).html, /No articles match <strong>zzz<\/strong>/);
});

test('text from the Sheet is escaped everywhere', () => {
  const evil = { id: '2026-10-16-x', title: '<img src=x onerror=alert(1)>', publishedAt: '2026-10-16', section: 'news', kind: 'article', authors: ['w'], deck: '"><script>alert(1)</script>', paras: [], minutes: 1, cover: null, issueId: null, printOrder: null, correction: '<b>x</b>', path: '/2026/10/16/x/' };
  const small = A.createApp({ articles: [evil], authors: { w: { name: '<i>Writer</i>', classYear: 2027 } }, issues: [], settings: {}, brand: {} }, { appUrl: APP });
  for (const path of ['/', '/news/', '/2026/10/16/x/', '/archives/', '/authors/w/']) {
    const html = small.render(path, { bodies: { [evil.id]: '<p>ok</p>' } }).html;
    assert.ok(!html.includes('<img src=x') && !html.includes('<script>alert') && !html.includes('<i>Writer') && !html.includes('<b>x</b>'), path);
  }
});

test('a print issue from the Sheet: Drive draws its cover from the PDF, and its page shows the PDF', () => {
  const issue = { id: '2026-27-issue-2', title: 'Issue II, 2026–27', season: 'Fall', year: 2026, number: 2, volume: null, dateLabel: 'October 30, 2026', notes: [], pdf: { id: 'pdfcopy' }, pages: [], cover: { id: 'pdfcopy', w: 1200, h: 1855 } };
  const small = A.createApp({ articles: [], authors: {}, issues: [issue], settings: {}, brand: {} }, { appUrl: APP });
  const page = small.render('/issues/2026-27-issue-2/', {}).html;
  assert.match(page, /<section aria-label="The issue" class="issue-front">.*<a href="https:\/\/drive\.google\.com\/file\/d\/pdfcopy\/view"[^>]*><img src="https:\/\/lh3\.googleusercontent\.com\/d\/pdfcopy=w960"[^>]*alt="Issue II, 2026–27, front page"/s, 'the front page, opening the PDF');
  assert.match(page, />Read the whole issue</);
  assert.ok(!page.includes('<iframe'), 'no embedded viewer: Google will not show one inside the site');
  assert.match(small.render('/issues/', {}).html, /<span class="cover"><img src="https:\/\/lh3\.googleusercontent\.com\/d\/pdfcopy=w960"/);
  // The issue's articles are listed in print order.
  const art = (n: number, title: string) => ({ id: '2026-10-30-a' + n, title, publishedAt: '2026-10-30', section: 'news', kind: 'article', authors: [], paras: ['x'], minutes: 1, cover: null, issueId: '2026-27-issue-2', printOrder: n, path: '/2026/10/30/a' + n + '/' });
  const listed = A.createApp({ articles: [art(2, 'An article second in print'), art(1, 'The article first in print')], authors: {}, issues: [issue], settings: {}, brand: {} }, { appUrl: APP }).render('/issues/2026-27-issue-2/', {}).html;
  assert.ok(listed.indexOf('The article first in print') < listed.indexOf('An article second in print'), 'not alphabetical');
});

test('photos that share a cover sit side by side: on the article page each over its caption, in cards and the lead filling the frame', () => {
  const pic = (id: string, w: number, h: number, caption: string) => ({ id, w, h, alt: caption, caption });
  const a = { id: '2026-10-30-behind', title: 'Behind the Scenes', publishedAt: '2026-10-30', section: 'arts', kind: 'article', authors: [], paras: ['x'], minutes: 2, issueId: null, printOrder: null, path: '/2026/10/30/behind/',
    cover: { ...pic('cast', 615, 411, '26-27 Fall Drama Cast'), credit: null, beside: [pic('tech', 1133, 756, '26-27 Fall Drama Tech')] } };
  const small = A.createApp({ articles: [a], authors: {}, issues: [], settings: {}, brand: {} }, { appUrl: APP });
  const art = small.render(a.path, { bodies: { [a.id]: '<p>x</p>' } }).html;
  assert.match(art, /<figure class="article-cover" style="margin-inline:auto;max-width:min\(60rem, 960px\)"><div class="pic-row"><figure style="flex:1\.496 1 0%"><img src="https:\/\/lh3\.googleusercontent\.com\/d\/cast=w[^"]*"[^>]*sizes="\(min-width: 960px\) 480px, 50vw"[^>]*alt="26-27 Fall Drama Cast"[^>]*><figcaption class="caption">26-27 Fall Drama Cast<\/figcaption><\/figure><figure style="flex:1\.499 1 0%"><img src="https:\/\/lh3\.googleusercontent\.com\/d\/tech=[^>]*><figcaption class="caption">26-27 Fall Drama Tech<\/figcaption><\/figure><\/div><\/figure>/);
  const home = small.render('/', {}).html;
  assert.match(home, /<a class="hero-photo zoom"[^>]*><span class="pics"><span style="flex:1\.496 1 0%"><img src="https:\/\/lh3\.googleusercontent\.com\/d\/cast=[^>]*sizes="\(min-width: 1024px\) 360px, 50vw"[^>]*><\/span><span style="flex:1\.499 1 0%"><img src="https:\/\/lh3\.googleusercontent\.com\/d\/tech=/, 'the lead');
  assert.match(small.render('/arts/', {}).html, /<article class="story[^"]*shape-pano[^"]*" style="--ar:2\.600"><a class="media"[^>]*><span class="pics">/, 'a card: both photos, in a wide frame');
  const one = A.createApp({ articles: [{ ...a, cover: { ...a.cover, beside: undefined } }], authors: {}, issues: [], settings: {}, brand: {} }, { appUrl: APP }).render(a.path, { bodies: { [a.id]: '' } }).html;
  assert.ok(!one.includes('pic-row') && one.includes('<figure class="article-cover"'), 'a single photo as before');
});

test('while the latest print issue has its own nameplate (a Halloween one), the website wears it; the next issue brings the usual one back', () => {
  const brand = { nameplate: { id: 'usual', w: 3794, h: 357 }, wordmark: { id: 'usualword', w: 2539, h: 322 }, seal: { id: 'seal', w: 512, h: 512 } };
  const issue = (n: number, extra = {}) => ({ id: '2026-27-issue-' + n, title: 'Issue ' + n, season: 'Fall', year: 2026, number: n, volume: null, dateLabel: 'x', notes: [], pdf: { id: 'pdf' + n }, pages: [], cover: { id: 'pdf' + n, w: 1200, h: 1855 }, ...extra });
  const issues = [issue(2, { nameplate: { id: 'halloween', w: 3794, h: 464 } }), issue(3)];
  const header = (current: string) => A.createApp({ articles: [], authors: {}, issues, settings: { homepage: { currentIssue: current } }, brand }, { appUrl: APP }).render('/', {}).html.split('</header>')[0];
  const now = header('2026-27-issue-2');
  assert.match(now, /<div class="nameplate special">.*<img class="np np-full" src="https:\/\/lh3\.googleusercontent\.com\/d\/halloween=w2000" width="3794" height="464"/s);
  assert.match(now, /<img class="np np-word" src="https:\/\/lh3\.googleusercontent\.com\/d\/halloween=w2000"/, 'phones show it too');
  const next = header('2026-27-issue-3');
  assert.match(next, /<div class="nameplate">.*d\/usual=w2000" width="3794" height="357".*d\/usualword=w2000" width="2539" height="322"/s);
});

test('pictures: Drive sizes never exceed the original', () => {
  const pic = A.picture({ id: 'abc', w: 1200, h: 800 });
  assert.equal(pic.srcset, 'https://lh3.googleusercontent.com/d/abc=w480 480w, https://lh3.googleusercontent.com/d/abc=w960 960w, https://lh3.googleusercontent.com/d/abc=w1200 1200w');
  assert.equal(A.picture(null), null);
  assert.equal(A.summary({ deck: null, paras: ['A short opening.', 'Then more words follow here to fill the card.'] }, 170), 'A short opening. Then more words follow here to fill the card.');
});

test('the generated Page.html, Doc.gs and Issue.gs are up to date', () => {
  const built = buildGas();
  assert.equal(readFileSync(p('google-workspace/publisher/Page.html'), 'utf8'), built.page, 'run node scripts/build-gas.ts');
  assert.equal(readFileSync(p('google-workspace/publisher/Doc.gs'), 'utf8'), built.doc, 'run node scripts/build-gas.ts');
  assert.equal(readFileSync(p('google-workspace/publisher/Issue.gs'), 'utf8'), built.issue, 'run node scripts/build-gas.ts');
});
