// Turns the Markdown that Google Docs exports into the body of a website article.
//
// Google's export already keeps the words, paragraphs, headings, bold and italics, lists, links,
// tables and pictures. This file only:
//   - drops what the Sheet supplies anyway: a headline and a "By ..." line at the top of the Doc,
//   - turns an italic line right under a picture into that picture's caption,
//   - can take a picture at the very top of the Doc as the cover photo,
//   - keeps headings below the article's own headline (a Doc "Heading 1" becomes a subheading),
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
export interface Cleaned {
  body: string;
  lead: { src: string; alt: string; caption: string | null } | null;
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
const IMAGE_BLOCK = /^!\[((?:[^\]\\]|\\.)*)\]\[([^\]\n]+)\]$/;
const ITALIC_LINE = /^(?:\*(?!\*)([^\n]+?)\*|_(?!_)([^\n]+?)_)$/;
const unescape = (s: string) => s.replace(/\\(.)/g, '$1').trim();
const titleAttr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function cleanDocMarkdown(md: string, opts: CleanOptions): Cleaned {
  const images = opts.images ?? {};
  const missing = new Set<string>();
  let text = md.replace(/\r\n?/g, '\n');
  // Leftover picture data, if any (the Sheet's script normally strips it out).
  text = text.replace(/^\[[^\]\n]+\]:\s*<?data:[^\n]*$/gm, '');
  // A line break typed with Shift+Enter becomes a new paragraph.
  text = text.replace(/[ \t]{2,}\n/g, '\n\n').replace(/\\\n/g, '\n\n').replace(/<br\s*\/?>/gi, '\n\n');
  let blocks = text.split(/\n[ \t]*\n+/).map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim());

  // The headline and the byline come from the Sheet.
  const title = plain(opts.title);
  if (blocks.length && !blocks[0].includes('\n') && plain(blocks[0]) === title) blocks.shift();
  for (let i = 0; i < Math.min(2, blocks.length); i++) {
    if (!blocks[i].includes('\n') && BYLINE.test(blocks[i].replace(/\\(.)/g, '$1').replace(/[*_]/g, '').trim())) { blocks.splice(i, 1); break; }
  }

  // A picture that opens the Doc can become the cover photo.
  let lead: Cleaned['lead'] = null;
  const first = blocks.length ? IMAGE_BLOCK.exec(blocks[0]) : null;
  if (opts.leadImage && first && images[first[2]]) {
    blocks.shift();
    const cap = blocks.length ? ITALIC_LINE.exec(blocks[0]) : null;
    if (cap && blocks[0].length <= 400) blocks.shift();
    lead = { src: images[first[2]], alt: unescape(first[1]), caption: cap ? unescape(cap[1] ?? cap[2]) : null };
  }

  // Pictures: a picture on its own line takes the italic line under it as its caption.
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const solo = IMAGE_BLOCK.exec(block);
    if (solo) {
      const src = images[solo[2]];
      if (!src) { missing.add(solo[2]); continue; }
      const next = blocks[i + 1];
      const cap = next && next.length <= 400 ? ITALIC_LINE.exec(next) : null;
      if (cap) i++;
      out.push(`![${solo[1]}](${src}${cap ? ` "${titleAttr(unescape(cap[1] ?? cap[2]))}"` : ''})`);
      continue;
    }
    const replaced = block.replace(/!\[((?:[^\]\\]|\\.)*)\]\[([^\]\n]+)\]/g, (_m, alt: string, ref: string) => {
      if (images[ref]) return `![${alt}](${images[ref]})`;
      missing.add(ref);
      return '';
    });
    if (replaced.trim()) out.push(replaced);
  }

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

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

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
