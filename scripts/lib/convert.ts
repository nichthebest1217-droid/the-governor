// Pure conversion rules: WordPress HTML -> Markdown, byline extraction, URL mapping.
// Everything here is deterministic and unit-tested in tests/migration.test.ts.
import TurndownService from 'turndown';
// @ts-ignore -- no bundled types
import { gfm } from 'turndown-plugin-gfm';
import { decodeEntities, htmlToText, slugify } from './util.ts';

export interface ParsedAuthor {
  /** Name exactly as printed in the source byline. */
  printedName: string;
  /** Four-digit class year when the byline carried one, e.g. 2026. */
  classYear: number | null;
  slug: string;
}

export interface ParsedByline {
  original: string;
  authors: ParsedAuthor[];
  editorial: boolean;
  issueSeason: string | null;
  issueNumber: number | null;
  issueYear: number | null;
}

const QUOTE = "[‘’'`]";
const NAME_PART = "[A-Z][\\p{L}.'’-]*";
const NAME = new RegExp(`^(?:${NAME_PART}|\\(${NAME_PART}\\))(?:\\s+(?:${NAME_PART}|\\(${NAME_PART}\\))){1,3}$`, 'u');

/**
 * Parse a standalone byline paragraph such as
 *   "by Maxwell Donahue ‘26"
 *   "2026 Spring Issue # 4 Editorial by A ’27, B ’26"
 * Returns null unless the WHOLE paragraph is confidently a byline, so prose that
 * merely starts with "by" is never stripped from an article.
 */
export function parseByline(paragraphText: string): ParsedByline | null {
  const text = paragraphText.replace(/[ \s]+/g, ' ').trim();
  if (!text || text.length > 200) return null;
  const m = /^(?:(?:(\d{4})\s+)?(Spring|Fall|Winter|Summer)\s+Issue\s*#\s*(\d+)\s+(Editorial)\s+)?by\s+(.+)$/i.exec(text);
  if (!m) return null;
  const parts = m[5].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map((s) => s.trim()).filter(Boolean);
  const authors: ParsedAuthor[] = [];
  for (const part of parts) {
    const ym = new RegExp(`^(.*?)\\s*${QUOTE}?\\s*(\\d{2})\\s*${QUOTE}?$`, 'u').exec(part);
    const printedName = (ym ? ym[1] : part).trim();
    if (!NAME.test(printedName)) return null; // ambiguous: leave in the body and flag it
    authors.push({ printedName, classYear: ym ? 2000 + Number(ym[2]) : null, slug: slugify(printedName) });
  }
  if (authors.length === 0) return null;
  return {
    original: text,
    authors,
    editorial: Boolean(m[4]),
    issueSeason: m[2] ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : null,
    issueNumber: m[3] ? Number(m[3]) : null,
    issueYear: m[1] ? Number(m[1]) : null,
  };
}

/** Split rendered post HTML into its first paragraph and the remainder. */
export function splitFirstParagraph(html: string): { first: string; rest: string } | null {
  const m = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (!m) return null;
  return { first: m[1], rest: html.slice(m[0].length) };
}

export interface ConvertContext {
  /** Map an image URL (or attachment id) found in the source to a local public path. */
  resolveImage: (src: string, attachmentId: number | null) => string | null;
  /** Map an internal WordPress link to its new local path, or null when unknown. */
  resolveLink: (href: string) => string | null;
  isInternal: (href: string) => boolean;
}

export interface ConvertResult {
  markdown: string;
  images: string[];
  unresolvedImages: string[];
  unresolvedLinks: string[];
  unsupported: string[];
}

const UNSUPPORTED = ['iframe', 'video', 'audio', 'embed', 'object', 'form', 'script'];

export function htmlToMarkdown(html: string, ctx: ConvertContext): ConvertResult {
  const result: ConvertResult = { markdown: '', images: [], unresolvedImages: [], unresolvedLinks: [], unsupported: [] };
  for (const tag of UNSUPPORTED) if (new RegExp(`<${tag}\\b`, 'i').test(html)) result.unsupported.push(tag);

  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', hr: '---', codeBlockStyle: 'fenced' });
  td.use(gfm);
  // Keep embeds verbatim rather than dropping them; they are also reported as unsupported.
  td.keep(['iframe', 'video', 'audio', 'sup', 'sub']);

  const imageMd = (img: any, caption: string) => {
    const src = img.getAttribute('data-orig-file') || img.getAttribute('src') || '';
    const id = Number(img.getAttribute('data-attachment-id')) || null;
    const local = ctx.resolveImage(src, id);
    if (!local) result.unresolvedImages.push(src);
    else result.images.push(local);
    const alt = (img.getAttribute('alt') || '').replace(/[\[\]]/g, '');
    const title = caption ? ` "${caption.replace(/"/g, '\\"')}"` : '';
    return `![${alt}](${local ?? src}${title})`;
  };

  td.addRule('figure', {
    filter: 'figure',
    replacement: (content, node: any) => {
      const imgs = Array.from(node.querySelectorAll('img')) as any[];
      if (imgs.length === 0) return `\n\n${content}\n\n`;
      const cap = node.querySelector('figcaption');
      const caption = cap ? htmlToText(cap.innerHTML) : '';
      return '\n\n' + imgs.map((img) => imageMd(img, caption)).join('\n\n') + '\n\n';
    },
  });
  td.addRule('image', { filter: 'img', replacement: (_c, node: any) => imageMd(node, '') });
  td.addRule('link', {
    filter: (node: any) => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node: any) => {
      let href: string = node.getAttribute('href');
      if (ctx.isInternal(href)) {
        const local = ctx.resolveLink(href);
        if (local) href = local;
        else result.unresolvedLinks.push(href);
      }
      return content.trim() ? `[${content}](${href})` : '';
    },
  });
  // Compact list items ("- One", "1. A") instead of Turndown's padded default.
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node: any, options) => {
      const parent = node.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start')) || 1;
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/g, '\n' + ' '.repeat(prefix.length));
      return prefix + body + (node.nextSibling ? '\n' : '');
    },
  });
  // Presentational spans carry no meaning in the source; keep their text.
  td.addRule('span', { filter: 'span', replacement: (content) => content });

  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&nbsp;| /g, ' ')
    // WordPress/Jetpack chrome that is not article content.
    .replace(/<div[^>]+class="[^"]*(sharedaddy|jp-relatedposts|wp-block-jetpack-subscriptions)[^"]*"[\s\S]*$/i, '');

  result.markdown = td
    .turndown(cleaned)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
  // Turndown visits an <img> inside a <figure> twice; report each once.
  result.images = [...new Set(result.images)];
  result.unresolvedImages = [...new Set(result.unresolvedImages)];
  result.unresolvedLinks = [...new Set(result.unresolvedLinks)];
  return result;
}

/** Plain text of generated Markdown, for word-level parity checks against the source. */
export function markdownToText(md: string): string {
  return decodeEntities(
    md
      // An image contributes its caption (stored as the title), never its alt text.
      .replace(/!\[[^\]]*\]\([^)\s]*(?:\s+"((?:[^"\\]|\\.)*)")?\)/g, (_m, cap) => ` ${cap ?? ''} `)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1')
      .replace(/[*_~`]/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

/** ISO timestamp with the site's UTC offset, from WordPress `date` + `date_gmt`. */
export function withOffset(local: string, gmt: string): string {
  const diffMin = Math.round((Date.parse(local + 'Z') - Date.parse(gmt + 'Z')) / 60000);
  const sign = diffMin < 0 ? '-' : '+';
  const abs = Math.abs(diffMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

/** "/2026/05/14/slug/" from a WordPress permalink. */
export function legacyPathOf(link: string): string {
  const u = new URL(link);
  return decodeURI(u.pathname).replace(/\/?$/, '/');
}

/** Stable collision handling: the first claimant keeps the slug, later ones get "-wp<ID>". */
export function uniqueSlug(slug: string, wpId: number, taken: Map<string, number>): string {
  const owner = taken.get(slug);
  if (owner === undefined || owner === wpId) { taken.set(slug, wpId); return slug; }
  const alt = `${slug}-wp${wpId}`;
  taken.set(alt, wpId);
  return alt;
}
