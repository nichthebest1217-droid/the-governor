import { getCollection, type CollectionEntry } from 'astro:content';
import site from '../data/site.json';
import navigation from '../data/navigation.json';
import { mediaManifest, withBase } from './rehype-media.mjs';

export type Article = CollectionEntry<'articles'>;
export type Author = CollectionEntry<'authors'>;
export type Issue = CollectionEntry<'issues'>;

export const SITE = site;
export const SECTIONS = navigation.sections;
export const BASE = import.meta.env.BASE_URL;
export const INDEXABLE = process.env.SITE_INDEXABLE === 'true';

/** Prefix a root-relative path with the deploy base ("/" locally, "/REPO/" on a project page). */
export const href = (path: string) => withBase(BASE, path) as string;
export const absolute = (path: string) => new URL(href(path), import.meta.env.SITE).toString();
export const sectionLabel = (slug: string) => SECTIONS.find((s) => s.slug === slug)?.label ?? slug;

/** Calendar day exactly as written in the source, e.g. "2026-05-14". */
export const dayOf = (date: string) => date.slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function formatDate(date: string, style: 'long' | 'short' = 'long') {
  const [y, m, d] = dayOf(date).split('-').map(Number);
  const month = style === 'short' ? MONTHS[m - 1].slice(0, 3) + (MONTHS[m - 1].length > 3 ? '.' : '') : MONTHS[m - 1];
  return `${month} ${d}, ${y}`;
}
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Academic year a date falls in: Aug-Dec belong to the year starting then. */
export function academicYear(date: string) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
export const academicYearLabel = (ay: string) => `${ay.slice(0, 4)}–${ay.slice(7, 9)}`;

/** Slug part of an article id such as "2026-05-14-when-govs-comes-back-to-life". */
export const slugOf = (article: Article) => article.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');

/** Legacy articles keep their exact WordPress path; new ones follow the same date/slug pattern. */
export function permalink(article: Article): string {
  if (article.data.legacyPath) return article.data.legacyPath;
  const [y, m, d] = dayOf(article.data.publishedAt).split('-');
  return `/${y}/${m}/${d}/${slugOf(article)}/`;
}

export const isPublished = (article: Article) => article.data.published === true;

let articleCache: Promise<Article[]> | undefined;
/** Published articles only, newest first. Every page, feed and index goes through this. */
export function getArticles(): Promise<Article[]> {
  articleCache ??= getCollection('articles', isPublished).then((list) =>
    list.sort((a, b) =>
      Date.parse(b.data.publishedAt) - Date.parse(a.data.publishedAt) || (b.data.legacyWpId ?? 0) - (a.data.legacyWpId ?? 0)));
  return articleCache;
}

export async function getAuthorMap(): Promise<Map<string, Author>> {
  return new Map((await getCollection('authors')).map((a) => [a.id, a]));
}

export function authorLabel(author: Author) {
  const yy = author.data.classYear ? ` ’${String(author.data.classYear).slice(2)}` : '';
  return `${author.data.name}${yy}`;
}

/** Normalise a CMS reference ("src/content/articles/x.md", "x.md" or "x") to an entry id. */
export const refId = (ref: string | null | undefined) => (ref ?? '').split('/').pop()!.replace(/\.(md|json)$/, '');

export function plainText(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Card summary: the editor's deck when one exists, otherwise the article's own opening
 * words, cut at a word boundary. Never generated text.
 */
export function summary(article: Article, max = 170) {
  if (article.data.excerpt) return article.data.excerpt;
  // Opening paragraphs, joined, so a long card has enough of the article to fill its space.
  const paras = (article.body ?? '').split(/\n\s*\n/).map(plainText).filter((t) => t.length > 0);
  let text = '';
  for (const para of paras) {
    if (text.length >= max || (text.length > 40 && max <= 320)) break;
    text += (text ? ' ' : '') + para;
  }
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\-–—]+$/, '') + '…';
}

export function readingMinutes(article: Article) {
  const words = plainText(article.body ?? '').split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

export interface Picture { src: string; srcset?: string; width?: number; height?: number }
/** Resolve a public image path to its responsive variants. */
export function picture(path: string | null | undefined): Picture | null {
  if (!path) return null;
  const info = (mediaManifest() as Record<string, any>)[path];
  if (!info || !info.variants?.length) return { src: href(path), width: info?.width, height: info?.height };
  return {
    src: href(info.variants[Math.min(1, info.variants.length - 1)].path),
    srcset: info.variants.map((v: any) => `${href(v.path)} ${v.width}w`).join(', '),
    width: info.width,
    height: info.height,
  };
}

export function fileSize(bytes: number | null | undefined) {
  if (!bytes) return '';
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${Math.round(bytes / 1024)} KB`;
}
