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

test('a real export: hard line breaks, a bold heading and an indented list', () => {
  // What Google exported for the 16 October 2026 test Doc (picture data removed).
  const md = "# **Publishing test: please ignore**\n\nBy Test Writer '27  \n![A red test card][image1]  \n*Test caption for the cover picture.*  \n"
    + 'This is a **test**, with *formatting* and [links](https://www.govsacademy.org/).\n\n## **A subheading from the Doc**\n\n'
    + '> * A first point in plain text.  \n> * A second point with **bold words**.\n\n![A blue test card][image2]  \n'
    + '*Test caption for a picture inside the article.*  \nIf you can read this on the website, the test is still running.';
  const out = cleanDocMarkdown(md, { title: 'Publishing test: please ignore', images: { image1: 'gdrive:id1', image2: 'gdrive:id2' }, leadImage: true });
  assert.deepEqual(out.lead, { src: 'gdrive:id1', alt: 'A red test card', caption: 'Test caption for the cover picture.' });
  assert.equal(out.body, 'This is a **test**, with *formatting* and [links](https://www.govsacademy.org/).\n\n## A subheading from the Doc\n\n'
    + '* A first point in plain text.\n* A second point with **bold words**.\n\n![A blue test card](gdrive:id2 "Test caption for a picture inside the article.")\n\n'
    + 'If you can read this on the website, the test is still running.');
});

test('lists stay lists, a quote stays one quote, and other headings keep their words', () => {
  assert.equal(cleanDocMarkdown('* One  \n* Two  \n1. Three  \nAfter the list.', { title: 'T' }).body, '* One\n* Two\n1. Three\n\nAfter the list.');
  assert.equal(cleanDocMarkdown('> A quoted line.\n\n> Its second paragraph.\n\nAfter.', { title: 'T' }).body, '> A quoted line.\n>\n> Its second paragraph.\n\nAfter.');
  assert.equal(cleanDocMarkdown('> “We won,” she said.  \n> * and a list\n\nAfter.', { title: 'T' }).body, '> “We won,” she said.\n> * and a list\n\nAfter.');
  assert.equal(cleanDocMarkdown('## **Bold** and **more**\n\n## *Whole*', { title: 'T' }).body, '## **Bold** and **more**\n\n## Whole');
});

test('a picture exported in bold or italics (from the paragraph before it) is still a picture with its caption', () => {
  const md = "**Each athlete's favorite memory:**\n\n**![Gracie][image1]**\n\n*Gracie Augustine ’25*\n\nConnor’s highlight was his debut.\n\n*![][image2]*\n\n*Coco Kou ’27*";
  const out = cleanDocMarkdown(md, { title: 'T', images: { image1: 'gdrive:g1', image2: 'gdrive:c2' } });
  assert.equal(out.body, "**Each athlete's favorite memory:**\n\n![Gracie](gdrive:g1 \"Gracie Augustine ’25\")\n\nConnor’s highlight was his debut.\n\n![](gdrive:c2 \"Coco Kou ’27\")");
});

test('a poem keeps its line breaks; stray breaks in prose still make paragraphs', () => {
  const poem = 'With my hand woven through hers,  \nWe wander barefoot through the damp pond-side grass,  \nWhere rays of gold sift through tall trees.\n\nBut the pond keeps what years could not.  \nOpaque water, trapped inside a frame.  \nThe sun, bound by dark wood,';
  assert.equal(cleanDocMarkdown(poem, { title: 'Pond Reflections' }).body, poem);
  const prose = 'A sentence long enough to be prose rather than verse, broken by Shift+Enter in the middle of a thought.  \nIt goes on here.';
  assert.equal(cleanDocMarkdown(prose, { title: 'T' }).body, 'A sentence long enough to be prose rather than verse, broken by Shift+Enter in the middle of a thought.\n\nIt goes on here.');
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

