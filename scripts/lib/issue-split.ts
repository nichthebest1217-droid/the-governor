// Splits a print issue's PDF (read by pdf-read.ts) into its articles: headline, writers, text in
// reading order, and pictures with their captions.
//
// Made for The Governor's layout: a headline in a bold display face, the writers in italic under
// it, the text in columns, long rules between articles stacked on a page. Nothing is tied to a
// particular font: the body size and the styles are measured from the issue itself. What it cannot
// place with confidence (a box without a byline, a picture without an article) is listed, never
// guessed into an article. Runs in Node (tests) and in Apps Script (the publisher).
import type { Glyph, PageImage, PdfPage, Rule } from './pdf-read.ts';

export interface Run { text: string; bold?: boolean; italic?: boolean }
export interface ArticleImage { page: number; id: number; caption: string | null; x0: number; y0: number; x1: number; y1: number; width: number; height: number }
/** 'row': pictures side by side (an article's cover, when no one photo stands out). */
export type Block = { type: 'p'; runs: Run[] } | { type: 'lines'; lines: Run[][] } | { type: 'list'; ordered: boolean; items: Run[][] } | { type: 'image'; image: ArticleImage } | { type: 'row'; images: ArticleImage[] };
export interface IssueArticle {
  title: string; authors: string[]; page: number; order: number;
  editorial: boolean; poem: boolean; gallery: boolean; category: string; words: number; blocks: Block[];
}
export interface IssueSplit {
  id: string | null; title: string | null; label: string | null; number: number | null; date: string | null;
  articles: IssueArticle[]; skipped: string[]; contributors: string[];
}
export interface PageSource { pageCount: number; info?: Record<string, string>; page(n: number): PdfPage }

interface Line {
  page: number; text: string; runs: Run[]; x0: number; x1: number; y: number; top: number; bottom: number;
  size: number; font: string; bold: boolean; italic: boolean; cx: number; role: string; indent: number;
}
interface Head { page: number; lines: Line[]; text: string; x0: number; x1: number; top: number; bottom: number; cx: number; size: number; byline: Line[]; body: Line[]; images: PageImage[] }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const YEAR_MARK = /[‘’'`´]\s?\d{2}\b/;
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const roman = (s: string) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]] || 0; const w = ROMAN[s[i + 1]] || 0; n += v < w ? -v : v; }
  return n;
};
const toRoman = (n: number) => {
  const parts: [number, string][] = [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  parts.forEach(([v, s]) => { while (n >= v) { out += s; n -= v; } });
  return out;
};
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
// "1. Apple cider donuts", "2)Cinnamon rolls", "• Free blocks" (but not "35.5% of students").
const LIST_ITEM = /^(?:(\d{1,2})[.)]\s*(?=[A-Za-z“"‘'])|[•●▪]\s*)/;

// ---------------------------------------------------------------------------------------------
// Letters into lines

function linesOf(p: PdfPage): Line[] {
  const gl = p.glyphs.filter((g) => g.size > 3 && g.x > -20 && g.x < p.width + 20 && g.y > 0 && g.y < p.height + 20);
  // Canva writes each line of text as its own text object, so letters of one object form one line
  // however widely a justified line is spaced. PDFs that place every letter in its own object
  // (Canva's Mac app) are split at wide gaps instead.
  const perObject: Record<number, number> = {};
  gl.forEach((g) => { perObject[g.bt] = (perObject[g.bt] || 0) + 1; });
  const byObject = median(Object.keys(perObject).map((k) => perObject[Number(k)])) >= 3;
  gl.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Glyph[][] = [];
  gl.forEach((g) => {
    const row = rows.length ? rows[rows.length - 1] : null;
    if (row && Math.abs(row[0].y - g.y) <= Math.max(1.2, 0.18 * g.size)) row.push(g);
    else rows.push([g]);
  });
  const out: Line[] = [];
  rows.forEach((row) => {
    row.sort((a, b) => a.x - b.x);
    let seg: Glyph[] = [];
    const flush = () => { if (seg.some((g) => g.text.trim())) out.push(makeLine(p.number, seg)); seg = []; };
    row.forEach((g) => {
      const prev = seg[seg.length - 1];
      if (prev) {
        const gap = g.x - (prev.x + prev.w);
        const size = Math.max(prev.size, g.size);
        // Measured on both formats: justified word gaps stay under about 16pt; column gutters are 25pt or more.
        const apart = byObject ? prev.bt !== g.bt && gap > 0.6 * size : gap > (prev.text.trim() ? 0.9 : 2.2) * size;
        if (apart || Math.abs(prev.size - g.size) > 0.35 * size) flush();
      }
      seg.push(g);
    });
    flush();
  });
  return out;
}

function makeLine(page: number, gs: Glyph[]): Line {
  let text = '';
  const runs: Run[] = [];
  gs.forEach((g, i) => {
    const prev = gs[i - 1];
    let t = g.text;
    if (prev && g.x - (prev.x + prev.w) > 0.28 * g.size && !/\s$/.test(text) && !/^\s/.test(t)) t = ' ' + t;
    text += t;
    const style = /^\s+$/.test(t) && runs.length ? { bold: runs[runs.length - 1].bold, italic: runs[runs.length - 1].italic } : { bold: g.bold, italic: g.italic };
    const last = runs[runs.length - 1];
    if (last && !!last.bold === !!style.bold && !!last.italic === !!style.italic) last.text += t;
    else runs.push({ text: t, bold: style.bold, italic: style.italic });
  });
  while (runs.length && !runs[0].text.trim()) runs.shift();
  if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/, '');
  while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  const ink = gs.filter((g) => g.text.trim());
  const size = median(ink.map((g) => g.size));
  const fonts: Record<string, number> = {};
  ink.forEach((g) => { fonts[g.font] = (fonts[g.font] || 0) + 1; });
  const font = Object.keys(fonts).sort((a, b) => fonts[b] - fonts[a])[0] || '';
  const first = ink[0] || gs[0];
  const last = ink[ink.length - 1] || gs[gs.length - 1];
  const x0 = first.x;
  const x1 = last.x + last.w;
  const indent = first.x - gs[0].x;
  const y = median(gs.map((g) => g.y));
  return {
    page, text: text.trim(), runs, x0: x0 - indent, x1, y, top: y - 0.8 * size, bottom: y + 0.25 * size, size, font, indent,
    bold: ink.filter((g) => g.bold).length > 0.6 * ink.length, italic: ink.filter((g) => g.italic).length > 0.6 * ink.length,
    cx: (x0 + x1) / 2, role: '',
  };
}

// ---------------------------------------------------------------------------------------------
// Writers' names

/** "LORELAI BLUME ‘27, DK RHEE '28 and Marofa" -> ["Lorelai Blume '27", "DK Rhee '28", "Marofa"] */
export function parseByline(text: string, known: Record<string, string>): string[] {
  const t = clean(text).replace(/^(written\s+)?by:?\s+/i, '').replace(/\.$/, '');
  return t.split(/\s*,\s*|\s*&\s*|\s+and\s+/i).map((part) => {
    const m = /^(.*?)\s*[‘’'`´]\s?(\d{2})[’']?$/.exec(part.trim());
    const name = clean(m ? m[1] : part);
    if (!/[A-Za-z]/.test(name)) return '';
    const proper = known[name.toLowerCase()] || casing(name);
    return m ? proper + " '" + m[2] : proper;
  }).filter(Boolean);
}

function casing(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.split(/\s+/).map((w) => {
    if (w.length <= 3 && !/[AEIOUY]/.test(w)) return w; // initials such as DK or JT
    return w.toLowerCase().replace(/(^|[-’'])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/^Mc([a-z])/, (_m, b: string) => 'Mc' + b.toUpperCase());
  }).join(' ');
}

// ---------------------------------------------------------------------------------------------
// A guess at the section, for the editors to confirm

const SECTION_WORDS: [string, RegExp][] = [
  ['Sports', /\b(soccer|hockey|football|lacrosse|baseball|softball|basketball|volleyball|tennis|squash|wrestling|crew|track|cross[- ]country|athletes?|athletic|athletics|varsity|playoffs?|rivalry|league|scored?|captains?|weight room|midseason)\b/gi],
  ['Arts', /\b(art|arts|artist|artists|artwork|painting|drawing|poem|poetry|play|playwright|theater|theatre|drama|musical|music|concert|playlist|film|gallery|exhibit|exhibition|cast|rehearsals?)\b/gi],
  ['People', /\b(introducing|profile|meet|new teachers?|teachers?|faculty members?|grew up|alma mater|new faces?)\b/gi],
  ['Opinion', /\b(I think|I believe|in my opinion|we need|we should|should|solution|propose|controversy|controversial|outdated|failed|unfair|argues?)\b/gi],
  ['School Culture', /\b(dance|dances|club|clubs|tradition|traditions|spirit|weekends?|dorm|dorms|res life|residential|chapel|free blocks?|dining hall|student center|campus life|community|dummer cup)\b/gi],
  ['Humor & Fun', /\b(favorite|favorites|fun|quiz|mad lib|crossword|memes?|halloween|top five|ranking|flavors?)\b/gi],
  ['News', /\b(policy|policies|announced|new rule|rules|schedule|construction|renovation|renovated|installed|administration|doors|absences?)\b/gi],
];
/** The section an article probably belongs in: its headline counts most, then its words. Editors confirm it. */
export function guessCategory(title: string, text: string): string {
  let best = 'News';
  let bestScore = 0;
  SECTION_WORDS.forEach(([section, re]) => {
    const inTitle = (title.match(re) || []).length;
    const inText = Math.min(12, (text.match(re) || []).length);
    let score = 8 * inTitle + inText;
    if (section === 'People' && /\b(Mr|Ms|Mrs|Dr|Coach)\.?\s[A-Z]/.test(title)) score += 10;
    if (section === 'Opinion' && /\?/.test(title)) score += 8;
    if (score > bestScore) { best = section; bestScore = score; }
  });
  return best;
}

// ---------------------------------------------------------------------------------------------
// The issue

export function splitIssue(pdf: PageSource, opts: { knownNames?: string[] } = {}): IssueSplit {
  const pages: PdfPage[] = [];
  for (let n = 1; n <= pdf.pageCount; n++) pages.push(pdf.page(n));
  const all: Line[] = [];
  const perPage = pages.map((p) => { const ls = linesOf(p); ls.forEach((l) => all.push(l)); return ls; });

  // The body text's size and font: the most common among regular-weight letters.
  const bySize: Record<string, number> = {};
  all.forEach((l) => { if (!l.bold) { const k = l.size.toFixed(1) + '|' + l.font; bySize[k] = (bySize[k] || 0) + l.text.length; } });
  const bodyKey = Object.keys(bySize).sort((a, b) => bySize[b] - bySize[a])[0] || '11|';
  const bodySize = parseFloat(bodyKey);
  const bodyFont = bodyKey.split('|')[1];

  // The usual headline size; a headline set much larger is a section label such as "Student Arts".
  const headSizes: Record<string, number> = {};
  all.forEach((l) => { if (l.bold && l.size >= 1.3 * bodySize) { const k = l.size.toFixed(0); headSizes[k] = (headSizes[k] || 0) + l.text.length; } });
  const headSize = Number(Object.keys(headSizes).sort((a, b) => headSizes[b] - headSizes[a])[0] || 16);
  const out: IssueSplit = { id: null, title: null, label: null, number: null, date: null, articles: [], skipped: [], contributors: [] };
  const heads: Head[] = [];
  const credits: { line: Line; image: PageImage | null }[] = [];
  const orphanImages: { page: number; image: PageImage }[] = [];
  const orphanText: Record<number, number> = {};
  const mastheadNames: string[][] = [];

  pages.forEach((p, pi) => {
    const lines = perPage[pi];
    // Long rules (merged when drawn twice; not the page's own edges). A rule separates only what lies under it.
    const ruled: Rule[] = [];
    p.rules.filter((r) => r.x1 - r.x0 >= 0.35 * p.width && r.y > 6 && r.y < p.height - 6).sort((a, b) => a.y - b.y).forEach((r) => {
      const twin = ruled.filter((o) => Math.abs(o.y - r.y) <= 5 && Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0) > 0)[0];
      if (twin) { twin.x0 = Math.min(twin.x0, r.x0); twin.x1 = Math.max(twin.x1, r.x1); } else ruled.push({ x0: r.x0, x1: r.x1, y: r.y });
    });
    const rules = ruled.map((r) => r.y);
    const parted = (top: number, bottom: number, cx: number) => ruled.some((r) => r.y > top && r.y < bottom && cx >= r.x0 - 5 && cx <= r.x1 + 5);
    // Vertical rules separate side-by-side boxes (an article and a promotion beside it).
    const walled = (ax: number, bx: number, y: number) => (p.vrules || []).some((v) => v.x > Math.min(ax, bx) + 2 && v.x < Math.max(ax, bx) - 2 && y >= v.y0 - 5 && y <= v.y1 + 5);
    const headerRule = rules.filter((y) => y < 0.15 * p.height)[0];
    const headerBottom = headerRule !== undefined ? headerRule + 2 : 40;
    // Page 1's table of contents: a strip at the bottom with "Page 2", "Page 3" ...
    let footerTop = p.height + 1;
    const lowRules = rules.filter((y) => y > 0.8 * p.height);
    lowRules.forEach((y) => {
      const below = lines.filter((l) => l.top > y);
      if (below.filter((l) => /^Page \d+$/i.test(l.text)).length >= 2) footerTop = Math.min(footerTop, y);
    });
    const header = lines.filter((l) => l.bottom <= headerBottom + 4 || l.top < 40);
    const headerText = header.map((l) => l.text).join(' | ');
    if (!out.label) {
      const m = /(\d{2})\s*[-–]\s*(\d{2})\s+Issue\s+([IVXLC]+|\d+)\b/i.exec(headerText);
      const s = /\b(Spring|Fall|Winter|Summer)\s+Issue\s+(\d+)\b/i.exec(headerText);
      if (m) { out.label = m[0]; out.number = /^\d+$/.test(m[3]) ? Number(m[3]) : roman(m[3].toUpperCase()); out.id = '20' + m[1] + '-' + m[2] + '-issue-' + out.number; out.title = 'Issue ' + toRoman(out.number) + ', 20' + m[1] + '⁠–⁠' + m[2]; }
      else if (s) { out.label = s[0]; out.number = Number(s[2]); }
    }
    if (!out.date) {
      const d = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i.exec(headerText);
      if (d) out.date = d[3] + '-' + String(MONTHS.indexOf(d[1].toLowerCase()) + 1).padStart(2, '0') + '-' + d[2].padStart(2, '0');
    }
    const content = lines.filter((l) => header.indexOf(l) < 0 && l.top < footerTop);

    // The contributors box: its title and everything under it in its column (names, "Editors", "Writers").
    content.filter((l) => l.bold && l.size >= 1.2 * bodySize && /^(contributors|staff|masthead|editorial board)$/i.test(l.text)).forEach((t) => {
      t.role = 'masthead';
      content.filter((l) => !l.role && l.top > t.top && !parted(t.bottom, l.top, l.cx) && Math.abs(l.cx - t.cx) < 120).forEach((l) => {
        l.role = 'masthead';
        const m = /^(.*?)\s*[‘’'`´]\s?(\d{2})$/.exec(clean(l.text));
        if (m && /[a-z]/.test(m[1])) mastheadNames.push([m[1], m[2]]);
      });
    });
    // Pictures: not decorations (small cut-outs with a transparent background, anything off the page,
    // a background), not in the header. A small photo (opaque) still counts.
    const pictures = p.images.filter((im) => {
      const w = im.x1 - im.x0, hgt = im.y1 - im.y0;
      const sized = (w >= 90 && hgt >= 90 && w * hgt >= 12000) || (!im.alpha && Math.min(w, hgt) >= 60 && w * hgt >= 6000);
      return sized && im.x0 >= -3 && im.y0 >= -3 && im.x1 <= p.width + 3 && im.y1 <= p.height + 3
        && w * hgt < 0.6 * p.width * p.height && im.y0 >= headerBottom - 4 && im.y0 < footerTop && Math.min(im.width, im.height) >= 60;
    });
    const pictureUnder = (l: Line) => pictures.filter((x) => x.y0 >= l.bottom - 4 && x.y0 - l.bottom <= 30 && l.cx > x.x0 && l.cx < x.x1)[0] || null;

    // Headlines: bold and clearly larger than the text; lines of one headline are joined.
    const big = content.filter((l) => !l.role && l.bold && l.size >= 1.3 * bodySize).sort((a, b) => a.top - b.top);
    const pageHeads: Head[] = [];
    big.forEach((l) => {
      const h = pageHeads.filter((x) => l.top - x.bottom < 0.9 * l.size && l.top >= x.top && Math.abs(x.cx - l.cx) < 80 && Math.abs(x.size - l.size) < 2)[0];
      if (h) { h.lines.push(l); h.text = clean(h.text + ' ' + l.text); h.x0 = Math.min(h.x0, l.x0); h.x1 = Math.max(h.x1, l.x1); h.bottom = l.bottom; h.cx = (h.x0 + h.x1) / 2; }
      else pageHeads.push({ page: p.number, lines: [l], text: clean(l.text), x0: l.x0, x1: l.x1, top: l.top, bottom: l.bottom, cx: l.cx, size: l.size, byline: [], body: [], images: [] });
      l.role = 'head';
    });
    // Bylines: just under a headline, not bold, italic or "By ...", usually with a class year.
    pageHeads.forEach((h) => {
      const under = content.filter((l) => !l.role && !l.bold && l.top >= h.bottom - 3 && l.top - h.bottom <= 2.2 * h.size
        && l.cx > h.x0 - 60 && l.cx < h.x1 + 60 && l.size <= h.size && l.size >= 0.75 * bodySize
        && (/^(written\s+)?by\s/i.test(l.text) || YEAR_MARK.test(l.text) || (l.italic && l.text === l.text.toUpperCase() && /[A-Z]{2}/.test(l.text) && l.text.length < 90 && !/[_\d]/.test(l.text)))
        && h.size <= 1.25 * headSize).sort((a, b) => a.top - b.top);
      if (under.length) {
        h.byline.push(under[0]);
        under[0].role = 'byline';
        const more = under[1];
        if (more && more.top - under[0].bottom < 0.8 * more.size && more.italic === under[0].italic && YEAR_MARK.test(more.text)) { h.byline.push(more); more.role = 'byline'; }
      }
    });
    // Artists' names: italic with a class year, not under a headline (the Student Arts page).
    content.filter((l) => !l.role && l.italic && !l.bold && YEAR_MARK.test(l.text) && l.size >= bodySize && l.text.length < 60)
      .forEach((l) => { l.role = 'credit'; credits.push({ line: l, image: null }); });

    const offPage = p.images.filter((im) => (im.x1 - im.x0) * (im.y1 - im.y0) >= 20000 && (im.x1 > p.width + 3 || im.x0 < -3) && im.y0 > headerBottom && im.y1 - im.y0 > 0.3 * p.height);
    offPage.forEach((im) => orphanImages.push({ page: p.number, image: im }));
    // Captions: small text right under a picture.
    const captions: Record<number, string> = {};
    pictures.forEach((im) => {
      const under = content.filter((l) => !l.role && l.top >= im.y1 - 2 && l.top - im.y1 <= 16 && l.cx > im.x0 - 10 && l.cx < im.x1 + 10 && (l.size < bodySize * 0.97 || l.font !== bodyFont) && !l.bold)
        .sort((a, b) => a.top - b.top);
      const beside = under.length ? [] : content.filter((l) => !l.role && l.size <= 0.85 * bodySize && l.top < im.y1 && l.bottom > im.y0
        && ((l.x0 >= im.x1 - 2 && l.x0 - im.x1 <= 15) || (l.x1 <= im.x0 + 2 && im.x0 - l.x1 <= 15))).sort((a, b) => a.top - b.top);
      const found = under.length ? under : beside;
      if (found.length) {
        const parts = [found[0]];
        found.slice(1).forEach((l) => { if (l.top - parts[parts.length - 1].bottom < 1.4 * l.size) parts.push(l); });
        parts.forEach((l) => { l.role = 'caption'; });
        captions[im.id * 10000 + Math.round(im.y0)] = clean(parts.map((l) => l.text).join(' '));
      }
    });
    const captionOf = (im: PageImage) => captions[im.id * 10000 + Math.round(im.y0)] || null;
    // Artworks: a picture right under an artist's name.
    credits.filter((c) => c.line.page === p.number).forEach((c) => { c.image = pictureUnder(c.line); });
    const artworks = credits.filter((c) => c.image && c.line.page === p.number).map((c) => c.image);

    // Text: each line goes to the nearest headline above it (or level with it) that no rule cuts off.
    // A column is lines starting at the same left edge; a short line counts at its column's middle.
    const edges: { left: number; rights: number[] }[] = [];
    content.filter((l) => !l.role).forEach((l) => {
      const e = edges.filter((x) => Math.abs(x.left - l.x0) <= 12)[0];
      if (e) e.rights.push(l.x1); else edges.push({ left: l.x0, rights: [l.x1] });
    });
    const middle = (l: Line) => {
      const e = edges.filter((x) => Math.abs(x.left - l.x0) <= 12)[0];
      const right = e && e.rights.length >= 3 ? median(e.rights) : l.x1;
      return l.x1 < right - 2 * l.size ? (l.x0 + right) / 2 : l.cx;
    };
    content.filter((l) => !l.role).forEach((l) => {
      const cands = pageHeads.filter((h) => h.top <= l.top + 0.6 * l.size && !parted(h.bottom - 2, l.top, l.cx) && !walled(l.cx, h.cx, l.y));
      if (!cands.length) { orphanText[p.number] = (orphanText[p.number] || 0) + 1; return; }
      let best = cands[0];
      let bestScore = Infinity;
      const mid = middle(l);
      cands.forEach((h) => {
        const score = Math.abs(mid - h.cx) + 0.3 * Math.max(0, l.top - h.bottom);
        if (score < bestScore) { best = h; bestScore = score; }
      });
      best.body.push(l);
      l.role = 'body';
    });

    // Pictures: to the article whose text (or headline) is nearest, if it reaches that far.
    const dist = (im: PageImage, l: { x0: number; x1: number; top: number; bottom: number }) => {
      const dx = Math.max(0, l.x0 - im.x1, im.x0 - l.x1);
      const dy = Math.max(0, l.top - im.y1, im.y0 - l.bottom);
      return Math.hypot(dx, dy);
    };
    const STOP = ['The', 'And', 'For', 'With', 'From', 'Governor', 'Governors', 'Govs', 'Academy', 'School', 'Class', 'Page', 'Issue', 'Photo', 'Highlights', 'Preview', 'Next', 'Fall', 'Spring', 'Winter', 'Summer'];
    const words = (s: string) => (s.match(/[A-Z][a-z’']{2,}/g) || []).filter((w) => STOP.indexOf(w) < 0);
    // A caption naming someone the article is about ("Mr. Carney", "Coach KK") ties the picture to it.
    const named = (cap: string): Head | null => {
      const cw = words(cap);
      if (!cw.length) return null;
      const scores = pageHeads.filter((h) => h.byline.length).map((h) => {
        const text = h.text + ' ' + h.body.map((l) => l.text).join(' ');
        let n = 0;
        cw.forEach((w) => { n += (text.match(new RegExp('\\b' + w.replace(/[’']/g, ".") + '\\b', 'g')) || []).length; });
        return { h, n };
      }).sort((a, b) => b.n - a.n);
      return scores.length && scores[0].n >= 2 && (scores.length < 2 || scores[0].n > scores[1].n) ? scores[0].h : null;
    };
    const claims: { im: PageImage; head: Head | null; named?: boolean; alone?: boolean }[] = [];
    pictures.filter((im) => artworks.indexOf(im) < 0).forEach((im) => {
      const cap = captionOf(im);
      const centre = (im.x0 + im.x1) / 2;
      let head: Head | null = null;
      // A credited work of its own ("Dumber & G-Dawg by Lana Hardin '27") or a preview of another page stands alone.
      if (cap && ((/\bby\s+[A-Z]/.test(cap) && !/^(photos?|photographs?|images?|graphics?|courtesy)\b/i.test(cap)) || /^(preview|coming up|next issue|see page)\b/i.test(cap))) { claims.push({ im, head: null, alone: true }); return; }
      if (cap) head = named(cap);
      if (head) { claims.push({ im, head, named: true }); return; }
      if (!head) {
        let bestD = Infinity;
        pageHeads.filter((h) => h.top < im.y1 && !parted(h.bottom - 2, im.y0, centre) && !walled(centre, h.cx, (im.y0 + im.y1) / 2)).forEach((h) => {
          const boxes = [h as { x0: number; x1: number; top: number; bottom: number }].concat(h.body);
          const left = Math.min.apply(null, boxes.map((b) => b.x0));
          const right = Math.max.apply(null, boxes.map((b) => b.x1));
          const last = Math.max.apply(null, boxes.map((b) => b.bottom));
          if (!cap && im.y0 > last + 15) return;
          const textArea = (right - left) * (last - h.top);
          if (!cap && (im.x1 - im.x0) * (im.y1 - im.y0) > 1.2 * textArea) return;
          const d = Math.min.apply(null, boxes.map((l) => dist(im, l))) + (centre < left || centre > right ? 100 : 0);
          if (d < bestD) { bestD = d; head = h; }
        });
      }
      claims.push({ im, head });
    });
    // Captioned pictures in a row go together.
    claims.forEach((c) => {
      if (!captionOf(c.im) || c.alone) return;
      const row = claims.filter((o) => captionOf(o.im) && !o.alone && Math.abs(o.im.y0 - c.im.y0) < 8);
      if (row.length < 2) return;
      const votes: Record<string, number> = {};
      row.forEach((o) => { if (o.head) { const k = String(pageHeads.indexOf(o.head)); votes[k] = (votes[k] || 0) + 1; } });
      const top = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
      if (top !== undefined) row.forEach((o) => { if (!o.named) o.head = pageHeads[Number(top)]; });
    });
    claims.forEach((c) => { if (c.head) c.head.images.push(c.im); else orphanImages.push({ page: p.number, image: c.im }); });
    (pageHeads as Head[]).forEach((h) => { (h as Head & { captionOf?: typeof captionOf }).captionOf = captionOf; });
    pageHeads.forEach((h) => heads.push(h));

    // The Student Arts page: one gallery of the artworks, credited to their artists.
    if (artworks.length) {
      const section = pageHeads.filter((h) => !h.byline.length && h.size > 1.25 * headSize).sort((a, b) => b.size - a.size)[0];
      const items = credits.filter((c) => c.image && c.line.page === p.number);
      out.articles.push({
        title: section ? section.text : 'Student Art', authors: [], page: p.number, order: 0, editorial: false, poem: false, gallery: true, category: 'Arts', words: 0,
        blocks: items.map((c) => ({ type: 'image' as const, image: { page: p.number, id: c.image!.id, caption: clean(c.line.text), x0: c.image!.x0, y0: c.image!.y0, x1: c.image!.x1, y1: c.image!.y1, width: c.image!.width, height: c.image!.height } })),
      });
      (out.articles[out.articles.length - 1] as IssueArticle & { creditLines?: string[] }).creditLines = items.map((c) => c.line.text);
      if (section) (section as Head & { gallery?: boolean }).gallery = true;
    }
  });

  // Writers' names in their usual spelling: the issue's contributors box and names already known.
  const known: Record<string, string> = {};
  (opts.knownNames || []).forEach((n) => { known[clean(n).toLowerCase()] = clean(n); });
  mastheadNames.forEach(([name, yy]) => { known[name.toLowerCase()] = name; out.contributors.push(name + " '" + yy); });

  // Articles, in print order: page, then top to bottom in rows, each row left to right.
  heads.sort((a, b) => a.page - b.page || Math.round(a.top / 60) - Math.round(b.top / 60) || a.cx - b.cx);
  heads.forEach((h) => {
    if (!h.byline.length) {
      if ((h as Head & { gallery?: boolean }).gallery) return;
      out.skipped.push('"' + h.text + '" (page ' + h.page + '): no writer is named, so it was not made into an article');
      return;
    }
    const authors = parseByline(h.byline.map((l) => l.text).join(', '), known);
    const art = buildArticle(h, authors, bodyFont, (h as Head & { captionOf?: (im: PageImage) => string | null }).captionOf || (() => null));
    if (art.words < 25 && !art.blocks.some((b) => b.type === 'image' || b.type === 'row')) {
      out.skipped.push('"' + h.text + '" (page ' + h.page + '): almost no text under it');
      return;
    }
    out.articles.push(art);
  });
  // Galleries go after the articles of their page.
  out.articles.sort((a, b) => a.page - b.page || (a.gallery ? 1 : 0) - (b.gallery ? 1 : 0));
  out.articles.forEach((a, i) => { a.order = i + 1; });
  out.articles.forEach((a) => {
    const lines = (a as IssueArticle & { creditLines?: string[] }).creditLines;
    if (a.gallery && lines) {
      const names = lines.map((t) => parseByline(t, known)[0] || clean(t));
      a.blocks.forEach((b, i) => { if (b.type === 'image' && names[i]) b.image.caption = names[i]; });
      a.authors = names.filter((n, i) => names.indexOf(n) === i);
      const art = a.blocks.flatMap((b) => (b.type === 'image' ? [b.image] : []));
      const cover = coverRow(art);
      a.blocks = coverBlocks(cover).concat(art.filter((im) => cover.indexOf(im) < 0).map((image) => ({ type: 'image' as const, image })));
    }
    delete (a as IssueArticle & { creditLines?: string[] }).creditLines;
  });
  const lost = orphanImages.length;
  if (lost) out.skipped.push(lost + (lost === 1 ? ' picture' : ' pictures') + ' not placed in an article (pages ' + Array.from(new Set(orphanImages.map((o) => o.page))).join(', ') + '): see the PDF');
  Object.keys(orphanText).forEach((pg) => { if (orphanText[Number(pg)] > 2) out.skipped.push('Text on page ' + pg + ' that is not under any headline (' + orphanText[Number(pg)] + ' lines): see the PDF'); });
  return out;
}

// ---------------------------------------------------------------------------------------------
// One article: columns, paragraphs, pictures

const area = (im: ArticleImage) => (im.x1 - im.x0) * (im.y1 - im.y0);
const sameRow = (a: ArticleImage, b: ArticleImage) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);

/**
 * The pictures that open an article as its cover: the largest, or, when others are printed about as
 * large (three quarters of its area or more), up to three of them side by side, in reading order
 * (stacked ones top first, a row left to right). Nothing says which of them matters most, so none is
 * pushed down the article. Only when all of them have captions or none has, so that a caption never
 * ends up under the wrong photo.
 */
export function coverRow(imgs: ArticleImage[]): ArticleImage[] {
  const bySize = imgs.slice().sort((a, b) => area(b) - area(a));
  const peers = bySize.filter((im) => area(im) >= 0.75 * area(bySize[0])).sort((a, b) => (sameRow(a, b) ? a.x0 - b.x0 : a.y0 - b.y0)).slice(0, 3);
  const captioned = peers.filter((im) => im.caption).length;
  return peers.length > 1 && (captioned === 0 || captioned === peers.length) ? peers : bySize.slice(0, 1);
}
const coverBlocks = (cover: ArticleImage[]): Block[] => (cover.length > 1 ? [{ type: 'row', images: cover }] : cover.map((image) => ({ type: 'image' as const, image })));

function buildArticle(h: Head, authors: string[], bodyFont: string, captionOf: (im: PageImage) => string | null): IssueArticle {
  const lines = h.body.slice();
  // Columns: lines whose left edges sit together, left to right; each top to bottom.
  const sorted = lines.slice().sort((a, b) => a.x0 - b.x0);
  const cols: Line[][] = [];
  sorted.forEach((l) => {
    const col = cols.filter((c) => Math.abs(Math.min.apply(null, c.map((x) => x.x0)) - l.x0) < 60 || (l.x0 < Math.max.apply(null, c.map((x) => x.x1)) - 40 && l.x1 > Math.min.apply(null, c.map((x) => x.x0)) + 40 && Math.abs(l.x0 - Math.min.apply(null, c.map((x) => x.x0))) < 120))[0];
    if (col) col.push(l); else cols.push([l]);
  });
  cols.forEach((c) => c.sort((a, b) => a.top - b.top));
  cols.sort((a, b) => Math.min.apply(null, a.map((x) => x.x0)) - Math.min.apply(null, b.map((x) => x.x0)));
  const seq: { line: Line; left: number; right: number; col: number }[] = [];
  cols.forEach((c, ci) => {
    const left = Math.min.apply(null, c.map((x) => x.x0));
    const right = Math.max.apply(null, c.map((x) => x.x1));
    c.forEach((line) => seq.push({ line, left, right, col: ci }));
  });
  // A poem: most lines stop short of the column's right edge (prose is justified), or a face other than the articles'.
  const reaching = seq.filter((s) => s.line.x1 >= s.right - 1.5 * s.line.size).length;
  const poem = lines.length > 3 && lines.filter((l) => l.italic).length < 0.5 * lines.length
    && (reaching < 0.5 * lines.length || lines.filter((l) => l.font !== bodyFont).length > 0.6 * lines.length);
  const gaps: number[] = [];
  seq.forEach((s, i) => { const p = seq[i - 1]; if (p && p.col === s.col) gaps.push(s.line.y - p.line.y); });
  const spacing = median(gaps.filter((g) => g > 0)) || 1.3 * (lines[0] ? lines[0].size : 11);

  const blocks: Block[] = [];
  const paraOfLine: number[] = [];
  const boldOnly = (l: Line) => l.runs.every((r) => r.bold || !r.text.trim());
  const ends = (l: Line) => /[.!?:”"’)]$/.test(l.text.trim());
  if (poem) {
    let stanza: Run[][] = [];
    let poemLeft = 0;
    seq.forEach((s, i) => {
      const p = seq[i - 1];
      if (!p || p.col !== s.col) poemLeft = s.left;
      if (p && (p.col !== s.col || s.line.y - p.line.y > 1.6 * spacing) && stanza.length) { blocks.push({ type: 'lines', lines: stanza }); stanza = []; }
      if (stanza.length && (s.line.x0 > poemLeft + 6 || s.line.indent > 6)) {
        const last = stanza[stanza.length - 1];
        if (!/[A-Za-z]-$/.test(last.map((r) => r.text).join(''))) last.push({ text: ' ' });
        s.line.runs.forEach((r) => last.push({ ...r }));
      }
      else stanza.push(s.line.runs.map((r) => ({ ...r })));
      paraOfLine.push(blocks.length);
    });
    if (stanza.length) blocks.push({ type: 'lines', lines: stanza });
  } else {
    let runs: Run[] = [];
    let prevText = '';
    const flush = () => { if (runs.some((r) => r.text.trim())) blocks.push({ type: 'p', runs: tidyRuns(runs) }); runs = []; prevText = ''; };
    seq.forEach((s, i) => {
      const p = seq[i - 1];
      const l = s.line;
      const short = (x: { line: Line; right: number }) => x.line.x1 < x.right - 2.5 * x.line.size;
      const fresh = !p
        || l.x0 > s.left + 0.6 * l.size || l.indent > 0.6 * l.size
        || (p.col === s.col && l.y - p.line.y > 1.6 * spacing)
        || LIST_ITEM.test(l.text.trim())
        || (boldOnly(l) !== boldOnly(p.line))
        || (!!l.runs[0] && !!l.runs[0].bold && !boldOnly(l) && (ends(p.line) || short(p)))
        || (short(p) && ends(p.line) && l.x0 <= s.left + 2);
      if (fresh) flush();
      let text = l.runs.map((r) => r.text).join('');
      let rejoin = false;
      if (/[A-Za-z]-$/.test(prevText) && /^-[a-z]/.test(text)) {
        rejoin = true;
        l.runs[0].text = l.runs[0].text.replace(/^-/, '');
        text = text.slice(1);
        for (let k = runs.length - 1; k >= 0; k--) if (runs[k].text.trim()) { runs[k].text = runs[k].text.replace(/-\s*$/, ''); break; }
        prevText = prevText.slice(0, -1);
      }
      if (runs.length) {
        const joinTight = rejoin || /[A-Za-z]-$/.test(prevText) || /—$/.test(prevText) || /^—/.test(text);
        if (!joinTight) runs.push({ text: ' ' });
      }
      l.runs.forEach((r) => runs.push({ ...r }));
      prevText = text.trim();
      paraOfLine.push(blocks.length);
    });
    flush();
  }

  // Pictures: the cover first (coverRow); the others after the paragraph nearest to them, the largest first.
  const toImage = (im: PageImage): ArticleImage => ({ page: h.page, id: im.id, caption: captionOf(im), x0: im.x0, y0: im.y0, x1: im.x1, y1: im.y1, width: im.width, height: im.height });
  const imgs = h.images.map(toImage).sort((a, b) => area(b) - area(a));
  const cover = coverRow(imgs);
  const after: Record<number, ArticleImage[]> = {};
  imgs.filter((im) => cover.indexOf(im) < 0).forEach((im) => {
    let bestI = -1;
    let bestD = Infinity;
    seq.forEach((s, i) => {
      const d = Math.hypot((im.x0 + im.x1) / 2 - s.line.cx, (im.y0 + im.y1) / 2 - s.line.y);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    const para = bestI >= 0 ? Math.min(paraOfLine[bestI], blocks.length - 1) : blocks.length - 1;
    (after[para] = after[para] || []).push(im);
  });
  const final: Block[] = coverBlocks(cover);
  blocks.forEach((b, i) => { final.push(b); (after[i] || []).forEach((im) => final.push({ type: 'image', image: im })); });

  // Numbered or bulleted lines become a list.
  const grouped: Block[] = [];
  final.forEach((b) => {
    const t = b.type === 'p' ? b.runs.map((r) => r.text).join('') : '';
    const m = b.type === 'p' ? LIST_ITEM.exec(t) : null;
    if (!m || b.type !== 'p') { grouped.push(b); return; }
    const runs = b.runs.map((r) => ({ ...r }));
    let cut = m[0].length;
    while (cut > 0 && runs.length) { const take = Math.min(cut, runs[0].text.length); runs[0].text = runs[0].text.slice(take); cut -= take; if (!runs[0].text) runs.shift(); }
    const prev = grouped[grouped.length - 1];
    const ordered = !!m[1];
    if (prev && prev.type === 'list' && prev.ordered === ordered) prev.items.push(runs);
    else grouped.push({ type: 'list', ordered, items: [runs] });
  });
  final.length = 0;
  grouped.forEach((b) => final.push(b));
  const text = blocks.map((b) => (b.type === 'p' ? b.runs.map((r) => r.text).join('') : b.type === 'lines' ? b.lines.map((l) => l.map((r) => r.text).join('')).join(' ') : '')).join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  const editorial = /^from the editors?\b/i.test(h.text) || (/\beditorial\b/i.test(h.text));
  return {
    title: h.text, authors, page: h.page, order: 0, editorial, poem, gallery: false,
    category: poem ? 'Arts' : editorial ? 'Opinion' : guessCategory(h.text, text), words, blocks: final,
  };
}

/** Joins runs of the same style; a stray bold letter glued to a plain word (a layout slip) becomes plain. */
function tidyRuns(runs: Run[]): Run[] {
  runs = runs.map((r, i) => {
    const a = runs[i - 1], b = runs[i + 1];
    return !r.text.trim() && a && b && !!a.bold === !!b.bold && !!a.italic === !!b.italic ? { text: r.text, bold: a.bold, italic: a.italic } : r;
  });
  const out: Run[] = [];
  runs.forEach((r, i) => {
    const next = runs[i + 1];
    const prev = out[out.length - 1];
    let style = { bold: !!r.bold, italic: !!r.italic };
    if (r.bold && r.text.trim().length <= 2 && /^[A-Za-z]+$/.test(r.text.trim()) && next && !next.bold && /^[a-z]/.test(next.text) && (!prev || /\s$/.test(prev.text))) style = { bold: false, italic: !!r.italic };
    if (prev && !!prev.bold === style.bold && !!prev.italic === style.italic) prev.text += r.text;
    else out.push({ text: r.text, bold: style.bold || undefined, italic: style.italic || undefined });
  });
  if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); }
  return out.filter((r) => r.text);
}

// ---------------------------------------------------------------------------------------------
// The Google Doc for one article

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const runHtml = (r: Run) => {
  let t = esc(r.text);
  if (r.italic) t = '<em>' + t + '</em>';
  if (r.bold) t = '<strong>' + t + '</strong>';
  return t;
};

/** HTML for Google Drive to turn into the article's Doc. `src` gives each picture's data: URL (or null to leave it out). */
export function articleHtml(a: IssueArticle, src: (image: ArticleImage) => string | null): string {
  const p = (inner: string) => '<p style="margin:0 0 10pt 0">' + inner + '</p>';
  const parts = ['<h1>' + esc(a.title) + '</h1>'];
  if (a.authors.length) parts.push(p('By ' + esc(a.authors.length > 1 ? a.authors.slice(0, -1).join(', ') + ' and ' + a.authors[a.authors.length - 1] : a.authors[0])));
  a.blocks.forEach((b) => {
    if (b.type === 'p') parts.push(p(b.runs.map(runHtml).join('')));
    else if (b.type === 'lines') parts.push(p(b.lines.map((l) => l.map(runHtml).join('')).join('<br>')));
    else if (b.type === 'list') parts.push((b.ordered ? '<ol>' : '<ul>') + b.items.map((it) => '<li>' + it.map(runHtml).join('') + '</li>').join('') + (b.ordered ? '</ol>' : '</ul>'));
    else if (b.type === 'row') {
      // Side by side on one line, at one height, together as wide as the page; then each caption, in order.
      const shown = b.images.map((im) => ({ im, url: src(im) })).filter((x) => x.url);
      if (!shown.length) return;
      const height = Math.floor(560 / shown.reduce((sum, x) => sum + x.im.width / x.im.height, 0));
      parts.push(p('<span style="font-weight:normal;font-style:normal">' + shown.map((x) => '<img src="' + x.url + '" alt="' + esc(x.im.caption || '') + '" width="' + Math.round((height * x.im.width) / x.im.height) + '" height="' + height + '">').join(' ') + '</span>'));
      shown.forEach((x) => { if (x.im.caption) parts.push(p('<em>' + esc(x.im.caption) + '</em>')); });
    } else {
      const url = src(b.image);
      if (!url) return;
      // Plain style around the picture, so Google does not carry over the bold or italics before it.
      parts.push(p('<span style="font-weight:normal;font-style:normal"><img src="' + url + '" alt="' + esc(b.image.caption || '') + '"></span>'));
      if (b.image.caption) parts.push(p('<em>' + esc(b.image.caption) + '</em>'));
    }
  });
  return '<html><head><meta charset="utf-8"></head><body>' + parts.join('\n') + '</body></html>';
}
