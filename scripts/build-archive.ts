// Builds the archive bundle that the publisher script copies into Google Drive, once:
//   node scripts/build-archive.ts   ->  google-workspace/import/archive.json
//
// Every published article (the WordPress archive and the transcribed print issues) with its text
// rendered to HTML by the same Markdown pipeline the Astro site used, its writers, the print issues,
// the paper's brand images, and the list of picture and PDF files to copy. Pictures are referred to
// as gdrive:<path>?w=<width>; the publisher swaps each for the Drive copy it makes
// (importArchive in google-workspace/publisher/Code.gs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { visit } from 'unist-util-visit';
import sharp from 'sharp';
import { p, exists, readFrontmatter, writeJson } from './lib/util.ts';

type Media = { path: string; w?: number; h?: number; bytes: number };
const media = new Map<string, Media>();
async function use(path: string | null | undefined): Promise<Media | null> {
  if (!path || !path.startsWith('/')) return null;
  if (media.has(path)) return media.get(path)!;
  const file = p('public' + path);
  if (!exists(file)) throw new Error(`missing file public${path}`);
  const entry: Media = { path, bytes: statSync(file).size };
  if (!/\.pdf$/i.test(path)) {
    const meta = await sharp(file).metadata();
    entry.w = meta.autoOrient?.width ?? meta.width;
    entry.h = meta.autoOrient?.height ?? meta.height;
  }
  media.set(path, entry);
  return entry;
}

const plainText = (markdown: string) => markdown
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
  .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1')
  .replace(/[*_~`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const WIDTHS = [480, 960, 1600];
const token = (path: string, w: number) => `gdrive:${path}?w=${w}`;

/** Pictures point at their future Drive copies; captions become figures; outside links open in a new tab. */
function rehypeBundle() {
  return (tree: any) => {
    visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
        const href = node.properties.href;
        if (/^\s*(javascript|vbscript|data|file):/i.test(href)) delete node.properties.href;
        else if (/^(https?:)?\/\//i.test(href) || /^mailto:/i.test(href)) { node.properties.target = '_blank'; node.properties.rel = ['noopener']; }
      }
      if (node.tagName === 'img' && typeof node.properties?.src === 'string' && node.properties.src.startsWith('/')) {
        const info = media.get(node.properties.src);
        const path = node.properties.src;
        const widths = WIDTHS.filter((w) => !info?.w || w < info.w);
        if (info?.w && (!widths.length || widths[widths.length - 1] < info.w)) widths.push(Math.min(info.w, 2000));
        node.properties.src = token(path, widths[Math.min(1, widths.length - 1)]);
        node.properties.srcSet = widths.map((w) => `${token(path, w)} ${w}w`).join(', ');
        node.properties.sizes = '(min-width: 800px) 720px, 100vw';
        if (info?.w) { node.properties.width = info.w; node.properties.height = info.h; }
        node.properties.loading = 'lazy';
        node.properties.decoding = 'async';
        if (node.properties.alt === undefined) node.properties.alt = '';
        const caption = node.properties.title;
        if (caption && parent && typeof index === 'number') {
          delete node.properties.title;
          const children = [node, { type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: String(caption) }] }];
          if (parent.tagName === 'p' && parent.children.length === 1) { parent.tagName = 'figure'; parent.children = children; }
          else parent.children[index] = { type: 'element', tagName: 'figure', properties: {}, children };
        }
      }
    });
  };
}

const md = await createMarkdownProcessor({ smartypants: false, syntaxHighlight: false, rehypePlugins: [[rehypeBundle, {}]] });

const articles: any[] = [];
for (const f of readdirSync(p('src/content/articles')).filter((x) => x.endsWith('.md')).sort()) {
  const { data, body } = readFrontmatter(readFileSync(p('src/content/articles', f), 'utf8'));
  if (data.published !== true) continue;
  if (data.cmsId) throw new Error(`${f} came from the Sheet; publish it from the Sheet instead`);
  const id = f.replace(/\.md$/, '');
  const date = String(data.publishedAt).slice(0, 10);
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) await use(m[1]);
  const cover = await use(data.coverImage);
  const words = plainText(body).split(' ').filter(Boolean).length;
  const paras: string[] = [];
  let length = 0;
  for (const para of body.split(/\n\s*\n/).map(plainText).filter(Boolean)) {
    if (length >= 420) break;
    paras.push(para.slice(0, 600));
    length += para.length;
  }
  const html = (await md.render(body, { frontmatter: data })).code;
  articles.push({
    id,
    title: data.title,
    publishedAt: String(data.publishedAt),
    date,
    updatedAt: data.updatedAt ?? null,
    section: data.section,
    secondarySections: data.secondarySections ?? [],
    kind: data.kind ?? 'article',
    authors: data.authors ?? [],
    deck: data.excerpt ?? null,
    paras,
    minutes: Math.max(1, Math.round(words / 230)),
    cover: cover ? { path: cover.path, w: cover.w, h: cover.h, alt: data.coverAlt ?? '', caption: data.coverCaption ?? null, credit: data.coverCredit ?? null } : null,
    issueId: data.issueId ?? null,
    printOrder: data.printOrder ?? null,
    correction: data.correction ?? null,
    featured: data.featured === true,
    path: data.legacyPath ?? `/${date.replaceAll('-', '/')}/${id.replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`,
    legacyWpId: data.legacyWpId ?? null,
    text: plainText(body).slice(0, 20000),
    body: html,
  });
}
articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (b.legacyWpId ?? 0) - (a.legacyWpId ?? 0));

const authors: Record<string, any> = {};
for (const f of readdirSync(p('src/content/authors')).filter((x) => x.endsWith('.json'))) {
  const a = JSON.parse(readFileSync(p('src/content/authors', f), 'utf8'));
  const photo = await use(a.photo);
  authors[f.replace(/\.json$/, '')] = { name: a.name, classYear: a.classYear ?? null, bio: a.bio ?? null, photo: photo ? { path: photo.path, w: photo.w, h: photo.h } : null, visible: a.visible !== false };
}

const issues: any[] = [];
for (const f of readdirSync(p('src/content/issues')).filter((x) => x.endsWith('.json'))) {
  const i = JSON.parse(readFileSync(p('src/content/issues', f), 'utf8'));
  const pages = [];
  for (const img of i.pageImages ?? []) { const m = await use(img); if (m) pages.push({ path: m.path, w: m.w, h: m.h }); }
  const pdf = await use(i.pdf);
  issues.push({ id: f.replace(/\.json$/, ''), title: i.title, season: i.season ?? null, year: i.year, number: i.number ?? null, volume: i.volume ?? null, dateLabel: i.dateLabel ?? null, pdf: pdf ? { path: pdf.path } : null, pages, notes: i.notes ?? [] });
}

const brand: Record<string, any> = {};
for (const [key, path] of Object.entries({ nameplate: '/brand/nameplate.webp', wordmark: '/brand/wordmark.webp', seal: '/brand/logo-seal-512.png' })) {
  const m = await use(path);
  brand[key] = { path, w: m!.w, h: m!.h };
}

const site = JSON.parse(readFileSync(p('src/data/site.json'), 'utf8'));
// Pictures first and PDFs last, so a slow PDF never holds up the pictures.
const list = [...media.values()].sort((a, b) => Number(/\.pdf$/i.test(a.path)) - Number(/\.pdf$/i.test(b.path)) || a.bytes - b.bytes);
writeJson(p('google-workspace/import/archive.json'), { version: 1, builtAt: new Date().toISOString(), contactEmail: site.contactEmail ?? null, articles, authors, issues, brand, media: list });
console.log(`archive: ${articles.length} articles, ${Object.keys(authors).length} writers, ${issues.length} print issues, ${list.length} files (${(list.reduce((n, m) => n + m.bytes, 0) / 1048576).toFixed(1)} MB)`);
