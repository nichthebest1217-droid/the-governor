// Turns the Markdown that Google Docs exports into the body of a website article.
//
// Google's export already keeps the words, paragraphs, headings, bold and italics, lists, links,
// tables and pictures. This file only:
//   - drops what the Sheet supplies anyway: a headline and a "By ..." line at the top of the Doc,
//   - turns an italic line right under a picture into that picture's caption,
//   - can take a picture at the very top of the Doc (or pictures side by side there) as the cover,
//   - keeps headings below the article's own headline (a Doc "Heading 1" becomes a subheading),
//   - tidies the export's habits: line breaks become paragraphs, an indented list stays a list,
//   - makes the result safe: HTML typed into a Doc is shown as text, and links may only point
//     to web pages, email addresses or this site.
import { slugify } from './util.ts';

export interface CleanOptions {
  title: string;
  /** Picture reference in the export ("image1") -> its public path on the site. */
  images?: Record<string, string>;
  /** Use a picture that opens the Doc as the cover photo instead of a body picture. */
  leadImage?: boolean;
}
export interface Picture { src: string; alt: string; caption: string | null }
export interface Cleaned {
  body: string;
  /** The cover: a picture that opens the Doc, with the pictures beside it on that first line (if any). */
  lead: (Picture & { beside?: Picture[] }) | null;
  /** Picture references that had no file (they are left out of the article). */
  missing: string[];
}

/** Picture references used in a Doc export, in order of first appearance. */
export function imageRefs(md: string): string[] {
  return [...new Set([...md.matchAll(/!\[(?:[^\]\\]|\\.)*\]\[([^\]\n]+)\]/g)].map((m) => m[1]))];
}

// For comparing a line with the headline: no Markdown, escapes, punctuation or case.
const plain = (s: string) => s
  .replace(/\\(.)/g, '$1')
  .replace(/[*_`#>~]/g, '')
  .replace(/[“”"‘’'.,:;!?()[\]–—-]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// "By Jane Doe ’27 and Sam Lee ’28", but not "By the time students arrived".
const NAME = String.raw`[A-Z][A-Za-z’'.\-]*(?:\s+[A-Z][A-Za-z’'.\-]*){0,3}(?:\s*[’'‘]?\s*\d{2}[’']?)?`;
const BYLINE = new RegExp(String.raw`^(?:[Ww]ritten\s+)?[Bb][Yy]:?\s+${NAME}(?:\s*(?:,|&|\band\b)\s*${NAME})*\.?$`);
// One picture, or pictures side by side, and nothing else.
const IMAGES_ONLY = /^!\[(?:[^\]\\]|\\.)*\]\[[^\]\n]+\](?:[ \t]*!\[(?:[^\]\\]|\\.)*\]\[[^\]\n]+\])*$/;
const IMAGE_REF = /!\[((?:[^\]\\]|\\.)*)\]\[([^\]\n]+)\]/g;
const ITALIC_LINE = /^(?:\*(?!\*)([^\n]+?)\*|_(?!_)([^\n]+?)_)$/;
const LIST_OR_QUOTE = /^[ \t]*(?:>|[-*+][ \t]|\d+[.)][ \t])/;
const LIST_IN_QUOTE = /^>[ \t]*(?:$|[-*+][ \t]|\d+[.)][ \t]|[ \t]{2,}\S)/;
const unescape = (s: string) => s.replace(/\\(.)/g, '$1').trim();
const titleAttr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** The pictures in a block of pictures (one, or several side by side); a picture with no file is left out and reported. */
function picturesIn(block: string, images: Record<string, string>, missing: Set<string>) {
  return [...block.matchAll(IMAGE_REF)]
    .filter((m) => { if (!images[m[2]]) missing.add(m[2]); return !!images[m[2]]; })
    .map((m) => ({ src: images[m[2]], alt: unescape(m[1]), rawAlt: m[1] }));
}

/** The captions under n pictures: an italic line for each, in order, or else a single italic line (or none). */
function captionsUnder(blocks: string[], n: number): string[] {
  const caps: string[] = [];
  for (let i = 0; i < n && i < blocks.length; i++) {
    const m = blocks[i].length <= (i ? 200 : 400) ? ITALIC_LINE.exec(blocks[i]) : null;
    if (!m) break;
    caps.push(unescape(m[1] ?? m[2]));
  }
  return caps.length === n ? caps : caps.slice(0, 1);
}

export function cleanDocMarkdown(md: string, opts: CleanOptions): Cleaned {
  const images = opts.images ?? {};
  const missing = new Set<string>();
  let text = md.replace(/\r\n?/g, '\n');
  // Leftover picture data, if any (the Sheet's script normally strips it out).
  text = text.replace(/^\[[^\]\n]+\]:\s*<?data:[^\n]*$/gm, '');
  // Google ends many lines with a hard line break ("  " or "\"): a line break typed with Shift+Enter,
  // and paragraphs with no space between them. Between two lines of a list or a quote it only
  // continues the list or quote; three or more short lines in a row (a poem's stanza) keep their
  // breaks; anywhere else it starts a new paragraph.
  const lines = text.replace(/<br\s*\/?>/gi, '  \n').split('\n');
  const HARD = /^(.*?)(?:[ \t]{2,}|\\)$/;
  const verse = (l: string | undefined) => l !== undefined && !!l.trim() && l.trim().length <= 72 && !LIST_OR_QUOTE.test(l) && !/^\s*(#|!\[)/.test(l);
  const keep: boolean[] = lines.map(() => false);
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j < lines.length && HARD.test(lines[j]) && verse(lines[j])) j++;
    const end = verse(lines[j]) && !HARD.test(lines[j]) ? j : j - 1; // a stanza's last line has no break
    if (end - i >= 2) for (let k = i; k < end; k++) keep[k] = true;
    i = Math.max(j, i + 1);
  }
  text = lines.map((line, i) => {
    const hard = HARD.exec(line);
    if (!hard) return line;
    if (keep[i]) return hard[1] + '  ';
    return hard[1] + (LIST_OR_QUOTE.test(line) && LIST_OR_QUOTE.test(lines[i + 1] ?? '') ? '' : '\n');
  }).join('\n');
  let blocks = text.split(/\n[ \t]*\n+/).map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim());

  // Google exports an indented paragraph as a quote. Indented paragraphs in a row are one quote,
  // and an indented list (a list pasted from elsewhere often is) is a plain list.
  blocks = blocks.reduce<string[]>((kept, b) => {
    const prev = kept[kept.length - 1];
    if (prev !== undefined && prev.startsWith('>') && b.startsWith('>')) kept[kept.length - 1] = `${prev}\n>\n${b}`;
    else kept.push(b);
    return kept;
  }, []).map((b) => (b.startsWith('>') && b.split('\n').every((l) => LIST_IN_QUOTE.test(l)) ? b.replace(/^>[ \t]?/gm, '') : b));

  // A picture Google exported inside bold or italics (it takes the style of the paragraph before it) is still a picture.
  blocks = blocks.map((b) => {
    const bare = b.trim().replace(/(?:\*{1,3}|_{1,3})(?=!\[)/g, '').replace(/(\]\[[^\]\n]+\])(?:\*{1,3}|_{1,3})/g, '$1');
    return IMAGES_ONLY.test(bare) ? bare : b;
  });

  // The headline and the byline come from the Sheet.
  const title = plain(opts.title);
  if (blocks.length && !blocks[0].includes('\n') && plain(blocks[0]) === title) blocks.shift();
  for (let i = 0; i < Math.min(2, blocks.length); i++) {
    if (!blocks[i].includes('\n') && BYLINE.test(blocks[i].replace(/\\(.)/g, '$1').replace(/[*_]/g, '').trim())) { blocks.splice(i, 1); break; }
  }

  // A picture that opens the Doc, or pictures side by side on its first line, can become the cover.
  let lead: Cleaned['lead'] = null;
  if (opts.leadImage && blocks.length && IMAGES_ONLY.test(blocks[0])) {
    const pics = picturesIn(blocks[0], images, missing);
    if (pics.length) {
      blocks.shift();
      const caps = captionsUnder(blocks, pics.length);
      blocks.splice(0, caps.length);
      const shared = caps.length < pics.length; // one caption for pictures side by side
      lead = Object.assign({ src: pics[0].src, alt: pics[0].alt, caption: caps[0] ?? null }, pics.length > 1 ? { beside: pics.slice(1).map((pic, i) => ({ src: pic.src, alt: pic.alt, caption: shared ? null : caps[i + 1] })) } : {});
    }
  }

  // Pictures: a picture on its own line takes the italic line under it as its caption. Pictures side by
  // side take one italic line each, in order (or a single line for them all, which stays a line under them).
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (IMAGES_ONLY.test(block)) {
      const pics = picturesIn(block, images, missing);
      if (!pics.length) continue;
      const caps = captionsUnder(blocks.slice(i + 1), pics.length);
      const own = caps.length === pics.length;
      if (own) i += caps.length;
      out.push(pics.map((pic, n) => `![${pic.rawAlt}](${pic.src}${own ? ` "${titleAttr(caps[n])}"` : ''})`).join(' '));
      continue;
    }
    const replaced = block.replace(/!\[((?:[^\]\\]|\\.)*)\]\[([^\]\n]+)\]/g, (_m, alt: string, ref: string) => {
      if (images[ref]) return `![${alt}](${images[ref]})`;
      missing.add(ref);
      return '';
    });
    if (replaced.trim()) out.push(replaced);
  }

  // A heading made bold or italic in the Doc: the website's heading style is enough.
  for (let i = 0; i < out.length; i++) out[i] = out[i].replace(/^(#{1,6}[ \t]+)(\*\*|__|\*|_)(?=\S)((?:(?!\2).)+?)\2[ \t]*$/, '$1$3');

  // The article's headline is the page's only top-level heading.
  const levels = out.map((b) => /^(#{1,6})\s/.exec(b)?.[1].length ?? 7);
  if (Math.min(...levels, 7) === 1) {
    for (let i = 0; i < out.length; i++) if (levels[i] < 7) out[i] = '#' + (levels[i] === 6 ? out[i].slice(1) : out[i]);
  }

  return { body: makeSafe(out.join('\n\n')).trim(), lead, missing: [...missing] };
}

/** Text pasted into the Sheet's "Article text" cell: every line is a paragraph. */
export function textToMarkdown(text: string): string {
  return makeSafe(text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('\n\n'));
}

/** Runs `fn` on every part of the Markdown that is not code. */
function outsideCode(md: string, fn: (s: string) => string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; out.push(line); continue; }
    out.push(line.split(/(`+[^`\n]*`+)/).map((part, i) => (i % 2 ? part : fn(part))).join(''));
  }
  return out.join('\n');
}

// gdrive:<id> is a picture the publisher has copied into Drive from the Doc.
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#|gdrive:[A-Za-z0-9_-]+$)/i;

/** HTML becomes visible text; links and pictures may only point somewhere harmless. */
export function makeSafe(md: string): string {
  return outsideCode(md, (s) => s
    .replace(/<(?!(?:https?|mailto):[^\s<>]+>)(?=[A-Za-z!/?])/gi, '&lt;')
    .replace(/(!?)(\[(?:[^\]\\]|\\.)*\])\(\s*<?([^)\s>]*)>?((?:\s+"(?:[^"\\]|\\.)*")?)\s*\)/g,
      (m, bang: string, label: string, url: string) => (SAFE_URL.test(url) ? m : bang ? '' : label.slice(1, -1))));
}

/** "Jane Doe '27, Sam O’Neil ’28 and Lee Park" -> three writers. */
export function splitWriters(s: string): string[] {
  return s.split(/\s*[,;&]\s*|\s+and\s+/i).map((w) => w.trim()).filter(Boolean);
}

/** "Jane Doe '27" -> { name: "Jane Doe", classYear: 2027, slug: "jane-doe" }. */
export function parseWriter(text: string) {
  const m = /^(.*?)[\s,]*['’‘`]?\s*(\d{2})['’]?$/.exec(text.trim());
  const name = (m && m[1].trim() ? m[1] : text).trim();
  return { name, classYear: m && m[1].trim() ? 2000 + Number(m[2]) : null, slug: slugify(name) };
}
