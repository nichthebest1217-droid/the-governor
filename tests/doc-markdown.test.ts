// Turning a Google Doc's Markdown export into an article body (scripts/lib/doc-markdown.ts). The
// publisher runs the same code in Apps Script (google-workspace/publisher/Doc.gs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDocMarkdown, makeSafe, parseWriter, splitWriters, textToMarkdown } from '../scripts/lib/doc-markdown.ts';

// ---- the Doc's text -------------------------------------------------------------------------
test('headline and byline lines from the Doc are dropped; the opening sentence is not', () => {
  const md = "# Campus Welcomes New Students\n\nBy Jane Doe ’27 and Sam Lee '28\n\nBy the time students arrived, the **Chapel** was full.";
  assert.equal(cleanDocMarkdown(md, { title: 'Campus Welcomes New Students' }).body, 'By the time students arrived, the **Chapel** was full.');
  assert.equal(cleanDocMarkdown('By the end of the week, we knew.', { title: 'X' }).body, 'By the end of the week, we knew.');
});

test('pictures: captions from the italic line below, a leading picture as the cover, missing ones left out', () => {
  const md = '![Team photo][image1]\n\n*The team after the final.*\n\nText.\n\n![Goal][image2]\n\n_A late goal._\n\nMore ![inline][image3] text.\n\n![lost][image9]';
  const images = { image1: 'gdrive:id1', image2: 'gdrive:id2', image3: 'gdrive:id3' };
  const withCover = cleanDocMarkdown(md, { title: 'T', images, leadImage: true });
  assert.deepEqual(withCover.lead, { src: 'gdrive:id1', alt: 'Team photo', caption: 'The team after the final.' });
  assert.equal(withCover.body, 'Text.\n\n![Goal](gdrive:id2 "A late goal.")\n\nMore ![inline](gdrive:id3) text.');
  assert.deepEqual(withCover.missing, ['image9']);
  const inBody = cleanDocMarkdown(md, { title: 'T', images });
  assert.equal(inBody.lead, null);
  assert.ok(inBody.body.startsWith('![Team photo](gdrive:id1 "The team after the final.")\n\nText.'));
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
  assert.equal(makeSafe('![a](gdrive:abc_D-1) ![b](gdrive:../x) [c](gdrive:abc)'), '![a](gdrive:abc_D-1)  [c](gdrive:abc)', 'only plain Drive IDs; the renderer shows Drive links as text');
});

test('writers', () => {
  assert.deepEqual(splitWriters("Jane Doe '27, Sam O’Neil ’28 and Lee Park"), ["Jane Doe '27", 'Sam O’Neil ’28', 'Lee Park']);
  assert.deepEqual(parseWriter('Sam O’Neil ’28'), { name: 'Sam O’Neil', classYear: 2028, slug: 'sam-oneil' });
  assert.deepEqual(parseWriter('Adam Krogmeier 27’'), { name: 'Adam Krogmeier', classYear: 2027, slug: 'adam-krogmeier' });
  assert.deepEqual(parseWriter('DK Rhee'), { name: 'DK Rhee', classYear: null, slug: 'dk-rhee' });
});

