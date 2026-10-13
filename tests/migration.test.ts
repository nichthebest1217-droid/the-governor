import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { htmlToMarkdown, legacyPathOf, markdownToText, parseByline, splitFirstParagraph, uniqueSlug, withOffset } from '../scripts/lib/convert.ts';
import { htmlToText, p, parseCsv, readJson, sha256, slugify, toCsv, wordTokens, exists } from '../scripts/lib/util.ts';

const ctx = {
  isInternal: (h: string) => h.includes('govsacademynews.wpcomstaging.com'),
  resolveImage: (_s: string, id: number | null) => (id === 265 ? '/media/2026/05/wp-265.png' : null),
  resolveLink: (h: string) => (h.includes('/2026/05/14/known/') ? '/2026/05/14/known/' : null),
};

test('byline: every real spelling on the source site parses', () => {
  const cases: [string, string[], (number | null)[]][] = [
    ['by Maxwell Donahue ‘26', ['Maxwell Donahue'], [2026]],
    ['by Jayden Padilla ’26', ['Jayden Padilla'], [2026]],
    ['by Adam Krogmeier 27’', ['Adam Krogmeier'], [2027]],
    ['by Henry Loughman ‘ 26', ['Henry Loughman'], [2026]],
    ['by Andrew Melly', ['Andrew Melly'], [null]],
    ['by Trent Digiovanni ’27', ['Trent Digiovanni'], [2027]],
  ];
  for (const [text, names, years] of cases) {
    const b = parseByline(text);
    assert.ok(b, text);
    assert.deepEqual(b.authors.map((a) => a.printedName), names);
    assert.deepEqual(b.authors.map((a) => a.classYear), years);
    assert.equal(b.editorial, false);
  }
});

test('byline: editorial line yields issue, year and every signer', () => {
  const b = parseByline('2026 Spring Issue # 4 Editorial by Adam Krogmeier ’27, Tyler Passero ’26, Alexandra (Alex) Hughey ’27, Rhoads Kent ’27')!;
  assert.equal(b.editorial, true);
  assert.deepEqual([b.issueYear, b.issueSeason, b.issueNumber], [2026, 'Spring', 4]);
  assert.deepEqual(b.authors.map((a) => a.slug), ['adam-krogmeier', 'tyler-passero', 'alexandra-alex-hughey', 'rhoads-kent']);
  const noYear = parseByline('Spring Issue #3 Editorial by Maxwell Donahue ’26, Andrew Melly ’26, Trent DiGiovanni ’25')!;
  assert.deepEqual([noYear.issueYear, noYear.issueNumber], [null, 3]);
});

test('byline: prose that merely starts with "by" is never treated as a byline', () => {
  for (const text of [
    'By the time the bell rang, the dining hall was already full of students waiting.',
    'by now everyone has heard the news',
    'Byfield is quiet in the summer.',
    'by 2026',
    '',
  ]) assert.equal(parseByline(text), null, text);
});

test('html to markdown keeps structure, text and order', () => {
  const html = `<p class="wp-block-paragraph">First &amp; <strong>bold</strong> <em>word</em>.&nbsp;</p>
<ul class="wp-block-list"><li>One</li><li>Two</li></ul>
<ol><li>A</li></ol>
<blockquote><p>“Quoted,” she said.</p></blockquote>
<h2>Heading</h2>
<p>See <a href="https://example.org/x">this</a> and <a href="https://govsacademynews.wpcomstaging.com/2026/05/14/known/">that</a> and <a href="https://govsacademynews.wpcomstaging.com/2020/01/01/gone/">lost</a>.</p>
<figure class="wp-block-image"><img data-attachment-id="265" src="https://i0.wp.com/govsacademynews.wpcomstaging.com/wp-content/uploads/a.png?w=1" alt="Alt [text]"/><figcaption>Photo by Someone</figcaption></figure>
<figure><img src="https://example.org/unknown.png"/></figure>`;
  const r = htmlToMarkdown(html, ctx);
  assert.match(r.markdown, /^First & \*\*bold\*\* \*word\*\.$/m);
  assert.match(r.markdown, /^- One$/m);
  assert.match(r.markdown, /^1\. A$/m);
  assert.match(r.markdown, /^> “Quoted,” she said\.$/m);
  assert.match(r.markdown, /^## Heading$/m);
  assert.match(r.markdown, /\[this\]\(https:\/\/example\.org\/x\)/);
  assert.match(r.markdown, /\[that\]\(\/2026\/05\/14\/known\/\)/);
  assert.match(r.markdown, /!\[Alt text\]\(\/media\/2026\/05\/wp-265\.png "Photo by Someone"\)/);
  assert.deepEqual(r.images, ['/media/2026/05/wp-265.png']);
  assert.equal(r.unresolvedLinks.length, 1, 'unknown internal link is reported, not guessed');
  assert.equal(r.unresolvedImages.length, 1, 'unknown image is reported');
  assert.deepEqual(wordTokens(markdownToText(r.markdown)), wordTokens(htmlToText(html)));
});

test('embeds are reported as unsupported and kept, not dropped', () => {
  const r = htmlToMarkdown('<p>Watch:</p><iframe src="https://example.org/v"></iframe>', ctx);
  assert.deepEqual(r.unsupported, ['iframe']);
  assert.match(r.markdown, /<iframe/);
});

test('slugs, dates and paths are stable', () => {
  const taken = new Map<string, number>();
  assert.equal(uniqueSlug('story', 10, taken), 'story');
  assert.equal(uniqueSlug('story', 22, taken), 'story-wp22');
  assert.equal(uniqueSlug('story', 10, taken), 'story', 'the first owner keeps its slug on a re-run');
  assert.equal(uniqueSlug('story', 22, taken), 'story-wp22', 'and so does the second');
  assert.equal(withOffset('2026-05-14T15:03:57', '2026-05-14T19:03:57'), '2026-05-14T15:03:57-04:00');
  assert.equal(withOffset('2026-01-10T09:00:00', '2026-01-10T14:00:00'), '2026-01-10T09:00:00-05:00');
  assert.equal(legacyPathOf('https://govsacademynews.wpcomstaging.com/2026/05/14/a-b/'), '/2026/05/14/a-b/');
  assert.equal(slugify('Trent DiGiovanni'), 'trent-digiovanni');
  assert.equal(splitFirstParagraph('<p class="x">by A B</p>\n<p>Body</p>')!.first, 'by A B');
  assert.deepEqual(parseCsv(toCsv([{ a: 'x, "y"', b: 'line\nbreak' }])), [{ a: 'x, "y"', b: 'line\nbreak' }]);
});

test('importer is idempotent: a second run changes no file', { skip: !exists(p('migration/raw/api/posts.json')) && 'needs migration/raw (run npm run audit:wp)' }, () => {
  const state = () => sha256(readFileSync(p('migration/import-state.json')));
  const before = state();
  const out = execFileSync(process.execPath, [p('scripts/import-wordpress.ts')], { encoding: 'utf8' });
  const files = JSON.parse(out.slice(out.indexOf('{'))).files;
  assert.equal(files.created + files.updated, 0, JSON.stringify(files));
  assert.equal(state(), before);
});

test('reconciliation: every source post is imported, word for word', () => {
  const inventory = readJson(p('migration/source-inventory.json')).filter((i: any) => i.sourceType === 'post');
  const rec = readJson(p('migration/reconciliation.json'));
  assert.equal(rec.imported.articles, inventory.length);
  assert.equal(rec.imported.textMatch, inventory.length);
  assert.equal(rec.imported.dateMatch, inventory.length);
  assert.equal(rec.imported.pathMatch, inventory.length);
  assert.equal(rec.imported.bylineMatch, inventory.length);
  assert.deepEqual(rec.errors, []);
});
