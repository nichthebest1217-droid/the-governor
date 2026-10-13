// Phase 0 / 4.1-4.2: read-only inventory of the source WordPress site.
//
//   node scripts/audit-wordpress.ts            fetch from the live site, then write inventories
//   node scripts/audit-wordpress.ts --offline  rebuild inventories from migration/raw only
//   node scripts/audit-wordpress.ts --no-media skip downloading media originals
//
// Never writes to WordPress. Raw API responses and media originals land in migration/raw/,
// which is git-ignored (it includes the administrator's account record).
import { readFileSync, statSync } from 'node:fs';
import {
  SOURCE_ORIGIN, p, readJson, writeJson, writeFile, toCsv, sha256, politeFetch, sleep, exists, htmlToText, decodeEntities,
} from './lib/util.ts';
import { legacyPathOf, parseByline, splitFirstParagraph, withOffset } from './lib/convert.ts';

const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline');
const NO_MEDIA = args.has('--no-media');
const RAW = p('migration/raw');
const ENDPOINTS = ['posts', 'pages', 'categories', 'tags', 'media', 'users', 'comments'];

async function fetchAll(endpoint: string): Promise<{ items: any[]; total: number | null; status: number }> {
  const items: any[] = [];
  let total: number | null = null;
  for (let page = 1; ; page++) {
    const res = await politeFetch(`${SOURCE_ORIGIN}/wp-json/wp/v2/${endpoint}?per_page=100&page=${page}`);
    if (!res.ok) return { items, total, status: res.status };
    total = Number(res.headers.get('x-wp-total'));
    const pages = Number(res.headers.get('x-wp-totalpages')) || 1;
    items.push(...(await res.json()));
    if (page >= pages) return { items, total, status: res.status };
    await sleep(500);
  }
}

async function fetchText(url: string, file: string) {
  const res = await politeFetch(url);
  if (res.ok) writeFile(file, await res.text());
  return res.status;
}

const summary: any = { generatedAt: new Date().toISOString(), source: SOURCE_ORIGIN, mode: OFFLINE ? 'offline (migration/raw)' : 'live', endpoints: {} };

if (!OFFLINE) {
  for (const ep of ENDPOINTS) {
    const { items, total, status } = await fetchAll(ep);
    summary.endpoints[ep] = { status, reportedTotal: total, fetched: items.length };
    writeJson(`${RAW}/api/${ep}.json`, items);
    console.log(`${ep}: HTTP ${status}, X-WP-Total ${total}, fetched ${items.length}`);
    await sleep(500);
  }
  summary.robots = { status: await fetchText(`${SOURCE_ORIGIN}/robots.txt`, `${RAW}/api/robots.txt`) };
  summary.sitemap = { status: await fetchText(`${SOURCE_ORIGIN}/sitemap-1.xml`, `${RAW}/api/sitemap-1.xml`) };
  await fetchText(`${SOURCE_ORIGIN}/image-sitemap-1.xml`, `${RAW}/api/image-sitemap-1.xml`);
  summary.feed = { status: await fetchText(`${SOURCE_ORIGIN}/feed/`, `${RAW}/api/feed.xml`) };
  await fetchText(`${SOURCE_ORIGIN}/`, `${RAW}/html/home.html`);
  writeJson(`${RAW}/api/_fetch-summary.json`, summary);
} else if (exists(`${RAW}/api/_fetch-summary.json`)) {
  Object.assign(summary, readJson(`${RAW}/api/_fetch-summary.json`), { mode: 'offline (migration/raw)', generatedAt: summary.generatedAt });
}

const load = (ep: string): any[] => (exists(`${RAW}/api/${ep}.json`) ? readJson(`${RAW}/api/${ep}.json`) : []);
const posts = load('posts');
const pages = load('pages');
const categories = load('categories');
const tags = load('tags');
const media = load('media');
const users = load('users');
const comments = load('comments');
if (posts.length === 0) {
  console.error('No posts in migration/raw/api/posts.json. Run without --offline first.');
  process.exit(1);
}

// ---- media originals -------------------------------------------------------
const mediaRows: any[] = [];
for (const m of media) {
  const url: string = m.source_url;
  const rel = decodeURI(new URL(url).pathname).replace(/^\/wp-content\/uploads\//, '');
  const file = `${RAW}/media/${rel}`;
  let status = 'not-downloaded';
  if (!exists(file) && !OFFLINE && !NO_MEDIA) {
    const res = await politeFetch(url);
    if (res.ok) writeFile(file, new Uint8Array(await res.arrayBuffer()));
    else status = `http-${res.status}`;
    await sleep(300);
  }
  let checksum = '';
  let bytes: number | '' = '';
  if (exists(file)) {
    const buf = readFileSync(file);
    checksum = sha256(buf);
    bytes = statSync(file).size;
    const expected = m.media_details?.filesize;
    status = expected && expected !== bytes ? `size-mismatch (api ${expected})` : 'backed-up';
  }
  mediaRows.push({
    legacyWpId: m.id,
    sourceUrl: url,
    mimeType: m.mime_type,
    width: m.media_details?.width ?? '',
    height: m.media_details?.height ?? '',
    bytes,
    sha256: checksum,
    uploadedAt: m.date,
    attachedToPost: m.post ?? '',
    title: decodeEntities(m.title?.rendered ?? ''),
    altText: m.alt_text ?? '',
    caption: htmlToText(m.caption?.rendered ?? ''),
    backupStatus: status,
    backupFile: exists(file) ? `migration/raw/media/${rel}` : '',
  });
}

// ---- inventory -------------------------------------------------------------
const catById = new Map(categories.map((c: any) => [c.id, c]));
const tagById = new Map(tags.map((t: any) => [t.id, t]));
const mediaById = new Map(media.map((m: any) => [m.id, m]));

const inventory: any[] = [];
for (const post of posts) {
  const html: string = post.content.rendered;
  const split = splitFirstParagraph(html);
  const byline = split ? parseByline(htmlToText(split.first)) : null;
  const inlineIds = [...html.matchAll(/data-attachment-id="(\d+)"/g)].map((m) => Number(m[1]));
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
  const text = htmlToText(html);
  inventory.push({
    legacyWpId: post.id,
    sourceType: 'post',
    legacyUrl: post.link,
    legacyPath: legacyPathOf(post.link),
    slug: post.slug,
    title: decodeEntities(post.title.rendered).trim(),
    status: post.status,
    publishedAt: withOffset(post.date, post.date_gmt),
    modifiedAt: withOffset(post.modified, post.modified_gmt),
    bylineText: byline?.original ?? '',
    bylineAuthors: byline?.authors.map((a) => a.printedName) ?? [],
    bylineClassYears: byline?.authors.map((a) => a.classYear ?? '') ?? [],
    categories: post.categories.map((id: number) => catById.get(id)?.slug ?? `unknown-${id}`),
    tags: post.tags.map((id: number) => tagById.get(id)?.slug ?? `unknown-${id}`),
    featuredMediaId: post.featured_media || '',
    featuredMediaUrl: post.featured_media ? mediaById.get(post.featured_media)?.source_url ?? 'MISSING-FROM-MEDIA-API' : '',
    inlineMediaIds: inlineIds,
    attachedMediaIds: media.filter((m: any) => m.post === post.id).map((m: any) => m.id),
    linkCount: links.length,
    links,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    bodySha256: sha256(html),
    hasOriginalExcerpt: false, // the API excerpt is auto-generated from the opening lines on this site
  });
  // Untouched source HTML, kept so editors can audit any conversion.
  writeFile(p(`migration/source-html/${post.id}.html`), html);
}
for (const page of pages) {
  const text = htmlToText(page.content.rendered);
  inventory.push({
    legacyWpId: page.id,
    sourceType: 'page',
    legacyUrl: page.link,
    legacyPath: legacyPathOf(page.link),
    slug: decodeURIComponent(page.slug),
    title: decodeEntities(page.title.rendered).trim(),
    status: page.status,
    publishedAt: withOffset(page.date, page.date_gmt),
    modifiedAt: withOffset(page.modified, page.modified_gmt),
    categories: [], tags: [], links: [],
    wordCount: text ? text.split(/\s+/).length : 0,
    bodySha256: sha256(page.content.rendered),
  });
}
for (const c of categories) {
  inventory.push({
    legacyWpId: c.id, sourceType: 'category', legacyUrl: c.link, legacyPath: legacyPathOf(c.link), slug: c.slug,
    title: decodeEntities(c.name), status: 'publish', postCount: c.count, categories: [], tags: [], links: [],
  });
}
for (const m of mediaRows) {
  inventory.push({
    legacyWpId: m.legacyWpId, sourceType: 'attachment', legacyUrl: m.sourceUrl, legacyPath: new URL(m.sourceUrl).pathname,
    title: m.title, status: m.backupStatus, publishedAt: m.uploadedAt, bodySha256: m.sha256, categories: [], tags: [], links: [],
  });
}

// ---- reconciliation sources ------------------------------------------------
const sitemapUrls = exists(`${RAW}/api/sitemap-1.xml`)
  ? [...readFileSync(`${RAW}/api/sitemap-1.xml`, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeURI(m[1]))
  : [];
const known = new Set(inventory.map((i) => decodeURI(i.legacyUrl)));
known.add(`${SOURCE_ORIGIN}/`);
const feedLinks = exists(`${RAW}/api/feed.xml`)
  ? [...readFileSync(`${RAW}/api/feed.xml`, 'utf8').matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).filter((u) => /\/\d{4}\/\d{2}\/\d{2}\//.test(u))
  : [];

const byYear: Record<string, number> = {};
const byCategory: Record<string, number> = {};
for (const i of inventory.filter((x) => x.sourceType === 'post')) {
  byYear[i.publishedAt.slice(0, 4)] = (byYear[i.publishedAt.slice(0, 4)] ?? 0) + 1;
  for (const c of i.categories) byCategory[c] = (byCategory[c] ?? 0) + 1;
}

Object.assign(summary, {
  totals: {
    posts: posts.length,
    pages: pages.length,
    categories: categories.length,
    tags: tags.length,
    media: media.length,
    mediaImages: media.filter((m: any) => m.mime_type.startsWith('image/')).length,
    mediaPdfs: media.filter((m: any) => m.mime_type === 'application/pdf').length,
    mediaBackedUp: mediaRows.filter((m) => m.backupStatus === 'backed-up').length,
    mediaBytes: mediaRows.reduce((n, m) => n + (Number(m.bytes) || 0), 0),
    wpAccounts: users.length,
    comments: comments.length,
  },
  postsByYear: byYear,
  postsByCategory: byCategory,
  categoryCountsFromApi: Object.fromEntries(categories.map((c: any) => [c.slug, c.count])),
  postsWithParsedByline: inventory.filter((i) => i.sourceType === 'post' && i.bylineText).length,
  postsWithFeaturedImage: inventory.filter((i) => i.sourceType === 'post' && i.featuredMediaId).length,
  reconciliation: {
    sitemapUrls: sitemapUrls.length,
    sitemapUrlsMissingFromInventory: sitemapUrls.filter((u) => !known.has(u)),
    postsMissingFromSitemap: posts.map((x: any) => x.link).filter((u: string) => !sitemapUrls.includes(u)),
    feedItems: feedLinks.length,
    feedItemsMissingFromInventory: feedLinks.filter((u) => !known.has(u)),
    apiTotalsMatchFetched: Object.values(summary.endpoints ?? {}).every((e: any) => e.reportedTotal === null || e.reportedTotal === e.fetched),
  },
});

writeJson(p('migration/source-inventory.json'), inventory);
writeFile(p('migration/source-inventory.csv'), toCsv(inventory, [
  'legacyWpId', 'sourceType', 'legacyUrl', 'legacyPath', 'slug', 'title', 'status', 'publishedAt', 'modifiedAt', 'bylineText',
  'bylineAuthors', 'bylineClassYears', 'categories', 'tags', 'featuredMediaId', 'featuredMediaUrl', 'inlineMediaIds',
  'attachedMediaIds', 'linkCount', 'wordCount', 'postCount', 'bodySha256',
]));
writeFile(p('migration/media-source.csv'), toCsv(mediaRows));
writeJson(p('migration/audit-summary.json'), summary);

console.log(JSON.stringify({ totals: summary.totals, postsByCategory: byCategory, reconciliation: summary.reconciliation }, null, 2));
