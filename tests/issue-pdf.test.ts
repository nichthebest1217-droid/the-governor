// Reading a print issue's PDF and splitting it into articles (scripts/lib/pdf-read.ts and
// issue-split.ts; the publisher runs the same code as Issue.gs). Checked against Issue I, whose 14
// articles were typed in by hand from the same PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { unzlibSync, zlibSync } from 'fflate';
import { openPdf } from '../scripts/lib/pdf-read.ts';
import { splitIssue, articleHtml, parseByline, guessCategory, coverRow, type IssueArticle, type ArticleImage } from '../scripts/lib/issue-split.ts';
import { p, readJson } from '../scripts/lib/util.ts';

const zlib = { inflate: (d: Uint8Array) => unzlibSync(d), deflate: (d: Uint8Array) => zlibSync(d) };
const bytes = new Uint8Array(readFileSync(p('public/issues/2026-27-issue-1.pdf')));
let reads = 0;
const pdf = openPdf({ size: bytes.length, read: (a, b) => { reads++; return bytes.slice(a, b); } }, zlib);
const split = splitIssue(pdf);
const plain = (a: IssueArticle) => a.blocks.map((b) => (b.type === 'p' ? b.runs.map((r) => r.text).join('') : b.type === 'list' ? b.items.map((i) => i.map((r) => r.text).join('')).join(' ') : b.type === 'lines' ? b.lines.map((l) => l.map((r) => r.text).join('')).join(' ') : '')).join(' ');
const words = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').match(/[a-z0-9']+/g) ?? [];
/** The share of words two texts have in common, in order (longest common subsequence). */
function agreement(a: string[], b: string[]) {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) { const t = row[j]; row[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(row[j], row[j - 1]); prev = t; }
  }
  return row[b.length] / Math.max(a.length, b.length);
}

test('the PDF reader: letters, fonts, pictures and rules, reading the file in pieces', () => {
  assert.equal(pdf.pageCount, 6);
  assert.equal(pdf.info.Title, 'The Governors Issue 1');
  const page = pdf.page(1);
  assert.equal(page.glyphs.length, 5122);
  assert.ok(page.glyphs.some((g) => g.font === 'OldStandard-Bold' && Math.round(g.size) === 16 && g.bold), 'headlines are bold');
  assert.ok(page.glyphs.some((g) => g.font === 'OldStandard-Italic' && g.italic), 'bylines are italic');
  assert.ok(page.rules.some((r) => r.x1 - r.x0 > 600), 'the rules between stacked articles are found');
  assert.ok(reads < 200, 'the file is read in pieces, not all at once');
  const photo = page.images.find((im) => im.width === 435 && im.height === 326)!;
  const file = pdf.image(photo.id)!;
  assert.ok(file.mime === 'image/png' || file.mime === 'image/jpeg');
  assert.deepEqual([file.width, file.height], [435, 326]);
  if (file.mime === 'image/png') assert.deepEqual(Array.from(file.bytes.slice(0, 4)), [137, 80, 78, 71]);
});

test('Issue I: every article, its writers and its print order, word for word as typed in by hand', () => {
  assert.deepEqual([split.id, split.title, split.date], ['2026-27-issue-1', 'Issue I, 2026⁠–⁠27', '2026-10-09']);
  const archive = readJson<any>(p('google-workspace/import/archive.json'));
  const typed = archive.articles.filter((a: any) => a.issueId === '2026-27-issue-1');
  assert.equal(split.articles.length, typed.length);
  const files = readdirSync(p('src/content/articles')).filter((f) => f.startsWith('2026-10-09'));
  for (const a of split.articles) {
    const match = typed.find((t: any) => t.title === a.title);
    assert.ok(match, 'found in the archive: ' + a.title);
    assert.deepEqual(a.authors.map((n) => n.replace(/ '\d\d$/, '')), match.authors.map((s: string) => archive.authors[s].name), a.title);
    const file = files.find((f) => readFileSync(p('src/content/articles', f), 'utf8').includes(`title: ${JSON.stringify(a.title)}`))!;
    const md = readFileSync(p('src/content/articles', file), 'utf8').split(/^---$/m).slice(2).join('---').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    assert.ok(agreement(words(plain(a)), words(md)) >= 0.99, a.title + ' matches the typed text');
  }
  assert.deepEqual(split.articles.map((a) => a.order), split.articles.map((_, i) => i + 1));
  assert.equal(split.articles[0].title, 'The New and Improved Weight Room');
  assert.ok(split.articles.find((a) => a.title.startsWith('From the Editors'))!.editorial);
});

test('Issue I: pictures go with their articles, captions included; puzzles and comics stay in the PDF', () => {
  const pics = (title: string) => split.articles.find((a) => a.title === title)!.blocks.flatMap((b) => (b.type === 'image' ? [b.image] : b.type === 'row' ? b.images : []));
  assert.equal(pics('The New and Improved Weight Room')[0].caption, 'Coach KK, class of 2021');
  assert.equal(pics('New Teacher, New Perspective')[0].caption, 'Mr. Adams', 'a caption naming the person ties the photo to the article about him, across a rule');
  assert.match(pics('No Days Off: How Govs Football is Turning The Program Around')[0].caption!, /^Highlights Porter Lalime/, 'a caption beside the photo');
  assert.equal(pics('New Policy on Cellphones').length, 0, 'the meme behind a vertical rule is not the article\'s photo');
  assert.equal(pics('From the Editors: Buzzing First Week Back!').length, 0, 'the comic credited to its artist is not part of the editorial');
  assert.equal(pics('Teachers & Their Summer Breaks').length, 2, 'small photos count; small cut-out decorations do not');
  assert.ok(split.skipped.some((s) => /MAD LIB/.test(s)));
  assert.ok(split.skipped.some((s) => /pictures? not placed/.test(s)));
  assert.ok(split.contributors.includes("DK Rhee '28"));
});

test('photos printed about the same size share the cover, side by side; one clearly larger is the cover alone', () => {
  const first = (title: string) => split.articles.find((a) => a.title === title)!.blocks[0];
  const summer = first('Teachers & Their Summer Breaks');
  assert.equal(summer.type, 'row', 'two small photos printed side by side');
  assert.deepEqual(summer.type === 'row' && summer.images.map((im) => Math.round(im.x0)), [290, 400], 'left to right, as printed');
  const art = first('The Staff Art Show');
  assert.equal(art.type === 'row' && art.images.length, 2, 'the two large photos; the smaller third one stays in the text');
  assert.ok(art.type === 'row' && art.images[0].y0 < art.images[1].y0, 'stacked photos: the top one first');
  assert.equal(first('The New and Improved Weight Room').type, 'image');
  const im = (x0: number, y0: number, w: number, h: number, caption: string | null = null): ArticleImage => ({ page: 1, id: x0 * 1000 + y0, caption, x0, y0, x1: x0 + w, y1: y0 + h, width: w * 3, height: h * 3 });
  const cast = im(522, 255, 226, 151, '26-27 Fall Drama Cast'), tech = im(522, 448, 226, 151, '26-27 Fall Drama Tech');
  assert.deepEqual(coverRow([tech, cast]), [cast, tech], 'equal photos stacked in print: both, the top one on the left');
  assert.deepEqual(coverRow([cast, im(522, 448, 226, 151)]), [cast], 'only one has a caption: no risk of a caption under the wrong photo');
  assert.deepEqual(coverRow([im(80, 700, 160, 160, 'A'), im(310, 700, 170, 160, 'B'), im(550, 700, 180, 160, 'C'), im(80, 900, 160, 160, 'D')]).map((x) => x.caption), ['A', 'B', 'C'], 'at most three');
  const big = im(529, 782, 202, 258);
  assert.deepEqual(coverRow([im(529, 619, 202, 142), big, im(529, 1060, 204, 136)]), [big], 'a photo nearly twice the size of the others leads alone');
});

test('the Doc for an article: headline, byline, paragraphs with bold, pictures with captions', () => {
  const a = split.articles.find((x) => x.title === 'The New and Improved Weight Room')!;
  const html = articleHtml(a, (im) => (im.caption ? 'data:image/png;base64,AAAA' : null));
  assert.match(html, /^<html><head><meta charset="utf-8"><\/head><body><h1>The New and Improved Weight Room<\/h1>\n<p[^>]*>By Parker Baker '27<\/p>/);
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="Coach KK, class of 2021">[\s\S]*<em>Coach KK, class of 2021<\/em>/);
  assert.match(html, /If you’ve been to the weight room this year, you might notice/);
  const behind: IssueArticle = { title: 'Behind the Scenes', authors: ["Nicholas Zhuo '27"], page: 6, order: 12, editorial: false, poem: false, gallery: false, category: 'Arts', words: 3, blocks: [
    { type: 'row', images: [{ page: 6, id: 1, caption: '26-27 Fall Drama Cast', x0: 0, y0: 0, x1: 1, y1: 1, width: 615, height: 411 }, { page: 6, id: 2, caption: '26-27 Fall Drama Tech', x0: 0, y0: 0, x1: 1, y1: 1, width: 1133, height: 756 }] },
    { type: 'p', runs: [{ text: 'This fall, Govs continues its tradition.' }] }] };
  const row = articleHtml(behind, (x) => 'data:image/png;base64,P' + x.id);
  assert.match(row, /<p[^>]*><span style="font-weight:normal;font-style:normal"><img src="data:image\/png;base64,P1" alt="26-27 Fall Drama Cast"> <img src="data:image\/png;base64,P2" alt="26-27 Fall Drama Tech"><\/span><\/p>\n<p[^>]*><em>26-27 Fall Drama Cast<\/em><\/p>\n<p[^>]*><em>26-27 Fall Drama Tech<\/em><\/p>\n<p[^>]*>This fall/, 'together in one paragraph, at full size, then each caption in order');
  const evil: IssueArticle = { title: '<b>x</b>', authors: ['A <i>B</i>'], page: 1, order: 1, editorial: false, poem: false, gallery: false, category: 'News', words: 2, blocks: [{ type: 'p', runs: [{ text: '<script>alert(1)</script>' }] }] };
  assert.ok(!/<script>|<b>x|<i>B/.test(articleHtml(evil, () => null)), 'text from the PDF is escaped');
});

test('names, sections and lists', () => {
  assert.deepEqual(parseByline("LORELAI BLUME ‘27, DK RHEE '28 and MAROFA ’28", {}), ["Lorelai Blume '27", "DK Rhee '28", "Marofa '28"]);
  assert.deepEqual(parseByline('By JAMES MCGONAGILL', {}), ['James McGonagill']);
  assert.deepEqual(parseByline('PARKER BAKER ‘27', { 'parker baker': 'Parker Baker' }), ["Parker Baker '27"]);
  assert.equal(guessCategory('Boys Varsity Soccer Midseason Review', 'the team won'), 'Sports');
  assert.equal(guessCategory('Introducing Mr. Carney', 'he teaches history'), 'People');
  assert.equal(guessCategory('Three Activity Controversy: Is the Rule Outdated?', 'I think we should'), 'Opinion');
});
