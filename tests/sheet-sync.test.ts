// The website side of publishing from the Google Sheet: turning a Doc's export into an article,
// and bringing a copy of the site in line with what the Sheet lists (add, update, take down).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { readFrontmatter } from '../scripts/lib/util.ts';
import { cleanDocMarkdown, makeSafe, parseWriter, splitWriters, textToMarkdown } from '../scripts/lib/doc-markdown.ts';
import { PROCESSOR, TryAgain, checkSheet, hashId, readIndex, syncSheet } from '../scripts/lib/sheet-sync.ts';

// ---- the Doc's text -------------------------------------------------------------------------
test('headline and byline lines from the Doc are dropped; the opening sentence is not', () => {
  const md = "# Campus Welcomes New Students\n\nBy Jane Doe ’27 and Sam Lee '28\n\nBy the time students arrived, the **Chapel** was full.";
  assert.equal(cleanDocMarkdown(md, { title: 'Campus Welcomes New Students' }).body, 'By the time students arrived, the **Chapel** was full.');
  assert.equal(cleanDocMarkdown('By the end of the week, we knew.', { title: 'X' }).body, 'By the end of the week, we knew.');
});

test('pictures: captions from the italic line below, a leading picture as the cover, missing ones left out', () => {
  const md = '![Team photo][image1]\n\n*The team after the final.*\n\nText.\n\n![Goal][image2]\n\n_A late goal._\n\nMore ![inline][image3] text.\n\n![lost][image9]';
  const images = { image1: '/media/sheet/x/1.jpg', image2: '/media/sheet/x/2.jpg', image3: '/media/sheet/x/3.jpg' };
  const withCover = cleanDocMarkdown(md, { title: 'T', images, leadImage: true });
  assert.deepEqual(withCover.lead, { src: '/media/sheet/x/1.jpg', alt: 'Team photo', caption: 'The team after the final.' });
  assert.equal(withCover.body, 'Text.\n\n![Goal](/media/sheet/x/2.jpg "A late goal.")\n\nMore ![inline](/media/sheet/x/3.jpg) text.');
  assert.deepEqual(withCover.missing, ['image9']);
  const inBody = cleanDocMarkdown(md, { title: 'T', images });
  assert.equal(inBody.lead, null);
  assert.ok(inBody.body.startsWith('![Team photo](/media/sheet/x/1.jpg "The team after the final.")\n\nText.'));
});

test('Doc headings sit below the headline; line breaks become paragraphs', () => {
  const out = cleanDocMarkdown('Intro  \nsecond line\n\n# Part one\n\n## Detail\n\n###### Deep', { title: 'T' }).body;
  assert.equal(out, 'Intro\n\nsecond line\n\n## Part one\n\n### Detail\n\n###### Deep');
});

test('HTML typed into a Doc shows as text; links may not run code', () => {
  assert.equal(makeSafe('Hi <script>alert(1)</script> and <b>bold</b>'), 'Hi &lt;script>alert(1)&lt;/script> and &lt;b>bold&lt;/b>');
  assert.equal(makeSafe('[click](javascript:alert(1)) and ![x](data:image/png;base64,AA)'), 'click) and ');
  assert.equal(makeSafe('[site](https://example.org/a_(b)) <https://example.org> [mail](mailto:a@b.org) [here](/about/)'), '[site](https://example.org/a_(b)) <https://example.org> [mail](mailto:a@b.org) [here](/about/)');
  assert.equal(makeSafe('Use `<div>` and\n```\n<b>code</b>\n```'), 'Use `<div>` and\n```\n<b>code</b>\n```');
  assert.equal(textToMarkdown('First line\r\nSecond <i>line</i>\n\n\nThird'), 'First line\n\nSecond &lt;i>line&lt;/i>\n\nThird');
});

test('writers', () => {
  assert.deepEqual(splitWriters("Jane Doe '27, Sam O’Neil ’28 and Lee Park"), ["Jane Doe '27", 'Sam O’Neil ’28', 'Lee Park']);
  assert.deepEqual(parseWriter('Sam O’Neil ’28'), { name: 'Sam O’Neil', classYear: 2028, slug: 'sam-oneil' });
  assert.deepEqual(parseWriter('Adam Krogmeier 27’'), { name: 'Adam Krogmeier', classYear: 2027, slug: 'adam-krogmeier' });
  assert.deepEqual(parseWriter('DK Rhee'), { name: 'DK Rhee', classYear: null, slug: 'dk-rhee' });
});

// ---- a copy of the site, and a pretend Sheet ----------------------------------------------
const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#9b1b30' } }).png().toBuffer();
const pngAlpha = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();

function site() {
  const root = mkdtempSync(join(tmpdir(), 'governor-sync-'));
  const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('src/content/articles/2026-05-01-archive-story.md', '---\ntitle: "Archive"\npublishedAt: "2026-05-01"\nsection: "news"\npublished: true\n---\n\nOld.\n');
  put('src/content/authors/jane-doe.json', JSON.stringify({ slug: 'jane-doe', name: 'Jane Doe', classYear: 2027, bio: 'Kept as is.' }));
  put('src/content/issues/2026-27-issue-1.json', '{}');
  put('src/data/homepage.json', JSON.stringify({ lead: null, secondary: [], editorsPicks: [], currentIssue: '2026-27-issue-1', alert: null }));
  put('src/data/site.json', JSON.stringify({ name: 'The Governor', contactEmail: 'a@b.org' }));
  put('src/data/masthead.json', JSON.stringify({ academicYear: '2026–27', groups: [] }));
  return { root, read: (rel: string) => readFileSync(join(root, rel), 'utf8'), has: (rel: string) => existsSync(join(root, rel)) };
}

const DOC = '# Big Win\n\n![Team photo][image1]\n\n*The team after the final.*\n\nThe varsity team won the title on Saturday. ' + 'More words about the game. '.repeat(12) + '\n\n![Logo][image2]\n';
const A = { id: '2026-10-16-big-win', revision: 'r1', title: 'Big Win', authors: "Jane Doe '27, Sam Lee '28", section: 'sports', date: '2026-10-16', kind: 'article', description: 'The title, at last.', image: null, issue: '2026-27-issue-1', order: 2, correction: '', source: 'doc' };
const B = { id: '2026-10-16-letter', revision: 'q1', title: 'Letter', authors: 'Lee Park', section: 'opinion', date: '2026-10-16', kind: 'editorial', description: '', image: { alt: 'The quad', caption: 'Fall', credit: 'Photo by L.' }, issue: '', order: '', correction: '', source: 'text' };

function sheet(articles: any[], extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const state = { articles, held: [] as string[], unpublished: [] as string[], settings: {} as any, fingerprint: 'f1', docs: { [A.id]: DOC } as Record<string, string>, changed: new Set<string>(), ...extra };
  const getJson = async (url: string) => {
    const q = new URL(url).searchParams;
    calls.push(q.toString());
    if (!q.get('article')) return { version: 2, fingerprint: state.fingerprint, articles: state.articles, held: state.held.map(hashId), unpublished: state.unpublished.map(hashId), settings: state.settings };
    const id = q.get('article')!;
    const a = state.articles.find((x: any) => x.id === id);
    if (!a) return { ok: false, error: 'not-published' };
    if (state.changed.has(id)) return { ok: false, retry: true, error: 'changed' };
    const image = q.get('image');
    if (image) return { ok: true, ref: image, mime: 'image/png', base64: (image === 'image2' ? pngAlpha : png).toString('base64') };
    return a.source === 'text' ? { ok: true, source: 'text', markdown: 'Dear readers,\n' + 'We have thoughts about the weekend schedule. '.repeat(8) } : { ok: true, source: 'doc', markdown: state.docs[id], images: ['image1', 'image2'] };
  };
  return { state, calls, getJson };
}
const quiet = () => {};
const E = 'https://script.google.com/macros/s/x/exec';

test('publishing: articles, pictures, writers and the record are written', async () => {
  const s = site();
  const g = sheet([A, B]);
  const result = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.deepEqual(result.summary, ['Published: Big Win', 'Published: Letter']);
  const a = readFrontmatter(s.read('src/content/articles/2026-10-16-big-win.md'));
  assert.equal(a.data.cmsId, A.id);
  assert.equal(a.data.title, 'Big Win');
  assert.equal(a.data.section, 'sports');
  assert.deepEqual(a.data.authors, ['jane-doe', 'sam-lee']);
  assert.equal(a.data.excerpt, 'The title, at last.');
  assert.equal(a.data.issueId, '2026-27-issue-1');
  assert.equal(a.data.printOrder, 2);
  assert.match(a.data.coverImage, /^\/media\/sheet\/2026-10-16-big-win\/1-[0-9a-f]{8}\.jpg$/, 'the picture at the top of the Doc became the cover');
  assert.equal(a.data.coverAlt, 'Team photo');
  assert.equal(a.data.coverCaption, 'The team after the final.');
  assert.ok(s.has('public' + a.data.coverImage));
  assert.match(a.body.trim(), /^The varsity team won/);
  assert.match(a.body, /!\[Logo\]\(\/media\/sheet\/2026-10-16-big-win\/2-[0-9a-f]{8}\.png\)/, 'a picture with transparency stays a PNG');
  assert.ok(!a.body.includes('Big Win') && !a.body.includes('data:'));
  const b = readFrontmatter(s.read('src/content/articles/2026-10-16-letter.md'));
  assert.equal(b.data.kind, 'editorial');
  assert.match(b.data.coverImage, /\/cover-[0-9a-f]{8}\.jpg$/);
  assert.deepEqual([b.data.coverAlt, b.data.coverCaption, b.data.coverCredit], ['The quad', 'Fall', 'Photo by L.']);
  assert.match(b.body.trim(), /^Dear readers,\n\nWe have thoughts/);
  assert.equal(JSON.parse(s.read('src/content/authors/jane-doe.json')).bio, 'Kept as is.', 'an existing writer is never overwritten');
  assert.deepEqual(JSON.parse(s.read('src/content/authors/sam-lee.json')), { slug: 'sam-lee', name: 'Sam Lee', classYear: 2028, bio: null, photo: null, visible: true, needsReview: false, sourceEvidence: 'Added from the publication Sheet.' });
  const record = JSON.parse(s.read('src/data/cms-sync.json'));
  assert.equal(record.fingerprint, 'f1');
  assert.equal(record.processor, PROCESSOR);
  assert.deepEqual(Object.keys(record.articles), [A.id, B.id]);
  assert.equal(record.articles[A.id].revision, 'r1');

  // Nothing changed: nothing is fetched again.
  g.calls.length = 0;
  const again = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.equal(again.changed, false);
  assert.deepEqual(g.calls, [''], 'only the list was read');
  assert.deepEqual(await checkSheet({ root: s.root, endpoint: E, getJson: g.getJson }), { changed: false, redeploy: false, reason: 'nothing changed in the Sheet' });

  // An edited Doc: the article is rewritten and pictures it no longer uses are removed.
  g.state.docs[A.id] = '# Big Win\n\nA corrected report. ' + 'Words about the game. '.repeat(14);
  g.state.articles = [{ ...A, revision: 'r2' }, B];
  g.state.fingerprint = 'f2';
  assert.equal((await checkSheet({ root: s.root, endpoint: E, getJson: g.getJson })).changed, true);
  const edited = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.deepEqual(edited.summary, ['Updated: Big Win']);
  assert.match(s.read('src/content/articles/2026-10-16-big-win.md'), /A corrected report/);
  assert.equal(readdirSync(join(s.root, 'public/media/sheet', A.id)).length, 0);

  // Unpublished: taken down, pictures and all. The archive is untouched.
  g.state.articles = [B];
  g.state.unpublished = [A.id];
  g.state.fingerprint = 'f3';
  const down = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.deepEqual(down.summary, ['Taken down: Big Win']);
  assert.ok(!s.has('src/content/articles/2026-10-16-big-win.md') && !s.has(`public/media/sheet/${A.id}`));
  assert.ok(s.has('src/content/articles/2026-05-01-archive-story.md'));
  assert.deepEqual(Object.keys(JSON.parse(s.read('src/data/cms-sync.json')).articles), [B.id]);
});

test('a row with a problem keeps the live version; a row that changed mid-run is tried again', async () => {
  const s = site();
  const g = sheet([A]);
  await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  g.state.articles = [];
  g.state.held = [A.id];
  g.state.fingerprint = 'f2';
  await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.ok(s.has('src/content/articles/2026-10-16-big-win.md'), 'held, not taken down');

  g.state.articles = [{ ...A, revision: 'r2' }];
  g.state.held = [];
  g.state.changed.add(A.id);
  const r = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.equal(r.retryLater, true);
  const record = JSON.parse(s.read('src/data/cms-sync.json'));
  assert.equal(record.fingerprint, null, 'the next run will try again');
  assert.equal(record.articles[A.id].revision, 'r1', 'the live version stays meanwhile');
});

test('safety: no archive article is overwritten, no mass take-down, odd answers change nothing', async () => {
  const s = site();
  const clash = { ...B, id: '2026-05-01-archive-story', date: '2026-05-01', revision: 'z' };
  const g = sheet([clash]);
  const r = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  assert.match(r.errors[clash.id].message, /another article already has this web address/);
  assert.equal(r.errors[clash.id].revision, 'z');
  assert.match(s.read('src/content/articles/2026-05-01-archive-story.md'), /Old\./);

  // Rows set to Draft are taken down even when there are many; rows that vanish all at once are not.
  const six = [1, 2, 3, 4, 5, 6].map((n) => ({ ...B, id: `2026-10-1${n}-story-${n}`, date: `2026-10-1${n}`, title: `Story ${n}` }));
  const file = (m: any) => `src/content/articles/${m.date}-story-${m.id.slice(-1)}.md`;
  const g2 = sheet(six);
  await syncSheet({ root: s.root, endpoint: E, getJson: g2.getJson, log: quiet });
  g2.state.articles = six.slice(4);
  g2.state.unpublished = six.slice(0, 4).map((m) => m.id);
  g2.state.fingerprint = 'four-drafts';
  const drafts = await syncSheet({ root: s.root, endpoint: E, getJson: g2.getJson, log: quiet });
  assert.equal(drafts.summary.filter((l) => l.startsWith('Taken down')).length, 4);
  assert.deepEqual(six.map((m) => s.has(file(m))), [false, false, false, false, true, true]);
  g2.state.articles = six.slice(5);
  g2.state.unpublished = six.slice(0, 5).map((m) => m.id);
  g2.state.fingerprint = 'one-more';
  await syncSheet({ root: s.root, endpoint: E, getJson: g2.getJson, log: quiet });
  assert.ok(!s.has(file(six[4])), 'a later single take-down still works');

  const g3 = sheet(six);
  const s3 = site();
  await syncSheet({ root: s3.root, endpoint: E, getJson: g3.getJson, log: quiet });
  g3.state.articles = [];
  g3.state.fingerprint = 'tab-emptied';
  const after = await syncSheet({ root: s3.root, endpoint: E, getJson: g3.getJson, log: quiet });
  assert.match(after.warnings.join(' '), /disappeared from the Sheet/);
  assert.equal(six.filter((m) => s3.has(file(m))).length, 6, 'nothing taken down when every row vanishes at once');
  g3.state.unpublished = [six[0].id];
  g3.state.fingerprint = 'one-draft';
  await syncSheet({ root: s3.root, endpoint: E, getJson: g3.getJson, log: quiet });
  assert.ok(!s3.has(file(six[0])) && s3.has(file(six[1])), 'a row set to Draft is still taken down meanwhile');

  assert.throws(() => readIndex({ version: 2, fingerprint: 'x', articles: [], held: [] }), /unexpected format/);
  assert.throws(() => readIndex({ ok: false, error: 'The Articles tab has no "ID" column.' }), TryAgain);
  const bad = sheet([{ ...A, section: 'gossip' }, { ...B, image: { alt: '', caption: '', credit: '' } }]);
  const r3 = await syncSheet({ root: site().root, endpoint: E, getJson: bad.getJson, log: quiet });
  assert.deepEqual(Object.keys(r3.errors).sort(), [A.id, B.id]);
});

test('settings from the Homepage tab may point at an article published in the same run', async () => {
  const s = site();
  const g = sheet([A], { settings: { homepage: { lead: A.id, secondary: ['2026-01-01-nope'], editorsPicks: [], currentIssue: '2026-27-issue-1', alert: { text: 'Hi', href: '//evil.example/' } }, site: { contactEmail: '', tipsEmail: 'tips@b.org' } } });
  const r = await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  const home = JSON.parse(s.read('src/data/homepage.json'));
  assert.equal(home.lead, A.id);
  assert.deepEqual(home.secondary, []);
  assert.deepEqual(home.alert, { text: 'Hi', href: null });
  assert.match(r.warnings.join(' '), /2026-01-01-nope/);
  const siteData = JSON.parse(s.read('src/data/site.json'));
  assert.equal(siteData.contactEmail, 'a@b.org', 'an empty contact email keeps the current one');
  assert.equal(siteData.tipsEmail, 'tips@b.org');
});

test('a run that finds the website behind the repository publishes again', async () => {
  const s = site();
  const g = sheet([A]);
  await syncSheet({ root: s.root, endpoint: E, getJson: g.getJson, log: quiet });
  const real = globalThis.fetch;
  try {
    let live: any = { sheet: {} };
    globalThis.fetch = (async () => ({ ok: true, json: async () => live })) as any;
    assert.deepEqual(await checkSheet({ root: s.root, endpoint: E, site: 'https://org.github.io/x', getJson: g.getJson }), { changed: true, redeploy: true, reason: 'the website is behind the repository (an earlier publish did not finish)' });
    live = { sheet: { [A.id]: { revision: 'r1', url: 'u' } } };
    assert.equal((await checkSheet({ root: s.root, endpoint: E, site: 'https://org.github.io/x', getJson: g.getJson })).changed, false);
  } finally {
    globalThis.fetch = real;
  }
});
