// Phase 3: turn the audited WordPress snapshot (migration/raw) into site content.
//
//   node scripts/import-wordpress.ts            import; never overwrites hand-edited files
//   node scripts/import-wordpress.ts --force    also overwrite files edited since the last import
//   node scripts/import-wordpress.ts --dry-run  report only
//
// Idempotent: each generated file's hash is remembered in migration/import-state.json. On a
// re-run a file is rewritten only if it is still byte-identical to what the importer last
// wrote; anything an editor has touched is left alone and reported.
import { copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { extname } from 'node:path';
import {
  SOURCE_ORIGIN, p, readJson, writeJson, writeFile, toCsv, sha256, exists, htmlToText, decodeEntities, frontmatter, wordTokens,
} from './lib/util.ts';
import { htmlToMarkdown, legacyPathOf, markdownToText, parseByline, splitFirstParagraph, uniqueSlug, withOffset } from './lib/convert.ts';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY = args.has('--dry-run');
const RAW = p('migration/raw');

if (!exists(`${RAW}/api/posts.json`)) {
  console.error('migration/raw/api/posts.json not found. Run `npm run audit:wp` first.');
  process.exit(1);
}
const posts: any[] = readJson(`${RAW}/api/posts.json`);
const pages: any[] = readJson(`${RAW}/api/pages.json`);
const categories: any[] = readJson(`${RAW}/api/categories.json`);
const tags: any[] = readJson(`${RAW}/api/tags.json`);
const media: any[] = readJson(`${RAW}/api/media.json`);
const aliasFile = readJson(p('migration/curation/author-aliases.json'));
const issueFile = readJson(p('migration/curation/issues.json'));
const statePath = p('migration/import-state.json');
const state: Record<string, string> = exists(statePath) ? readJson(statePath) : {};

const SECTIONS = ['news', 'opinion', 'arts', 'sports', 'humor-fun', 'people', 'school-culture'];
const review: any[] = [];
const flag = (type: string, severity: 'error' | 'review' | 'info', item: string, detail: string, action: string) =>
  review.push({ type, severity, item, detail, action });

const written = { created: 0, updated: 0, unchanged: 0, skippedEdited: 0 };
function emit(rel: string, content: string) {
  const file = p(rel);
  const hash = sha256(content);
  if (exists(file)) {
    const current = sha256(readFileSync(file));
    if (current === hash) { written.unchanged++; state[rel] = hash; return; }
    if (state[rel] && state[rel] !== current && !FORCE) {
      written.skippedEdited++;
      flag('edited-since-import', 'info', rel, 'File was edited after it was imported; the importer left it alone.', 'None. Use --force only to discard those edits.');
      return;
    }
    if (!state[rel] && !FORCE) {
      written.skippedEdited++;
      flag('edited-since-import', 'info', rel, 'File exists but was not created by the importer; left alone.', 'None.');
      return;
    }
    written.updated++;
  } else written.created++;
  if (!DRY) writeFile(file, content);
  state[rel] = hash;
}

// ---- media -----------------------------------------------------------------
const mediaById = new Map<number, any>(media.map((m) => [m.id, m]));
const rawFileOf = (m: any) => `${RAW}/media/${decodeURI(new URL(m.source_url).pathname).replace(/^\/wp-content\/uploads\//, '')}`;
const normUrl = (u: string) => {
  try {
    const x = new URL(decodeEntities(u));
    return decodeURI(x.pathname).replace(/^\/govsacademynews\.wpcomstaging\.com/, '');
  } catch { return u; }
};
const mediaByPath = new Map<string, any>(media.map((m) => [normUrl(m.source_url), m]));
const published = new Map<number, { path: string; usedBy: Set<string>; role: Set<string> }>();

function publishMedia(id: number, usedBy: string, role: string, target?: string): string | null {
  const m = mediaById.get(id);
  if (!m || !exists(rawFileOf(m))) return null;
  const ext = extname(new URL(m.source_url).pathname).toLowerCase();
  const [yyyy, mm] = m.date.split('-');
  // ASCII-safe, stable names: several originals are untitled screenshots with non-Latin filenames.
  const rel = target ?? `/media/${yyyy}/${mm}/wp-${m.id}${ext}`;
  const entry = published.get(id) ?? { path: rel, usedBy: new Set(), role: new Set() };
  entry.usedBy.add(usedBy);
  entry.role.add(role);
  published.set(id, entry);
  const dest = p('public' + entry.path);
  if (!DRY && (!exists(dest) || sha256(readFileSync(dest)) !== sha256(readFileSync(rawFileOf(m))))) {
    writeFile(dest, '');
    copyFileSync(rawFileOf(m), dest);
  }
  return entry.path;
}

// ---- authors ---------------------------------------------------------------
const aliases: Record<string, { canonical: string; evidence: string }> = aliasFile.aliases;
interface AuthorAcc { names: Map<string, number>; years: Map<number, number>; posts: number[]; aliasNotes: string[] }
const authors = new Map<string, AuthorAcc>();
function creditAuthor(slug: string, printedName: string, classYear: number | null, wpId: number): string {
  let canonical = slug;
  let aliasNote = '';
  if (aliases[slug]) {
    canonical = aliases[slug].canonical;
    aliasNote = `"${printedName}" (post ${wpId}) treated as ${canonical}: ${aliases[slug].evidence}`;
  }
  const acc = authors.get(canonical) ?? { names: new Map(), years: new Map(), posts: [], aliasNotes: [] };
  if (!aliasNote) acc.names.set(printedName, (acc.names.get(printedName) ?? 0) + 1);
  if (classYear) acc.years.set(classYear, (acc.years.get(classYear) ?? 0) + 1);
  acc.posts.push(wpId);
  if (aliasNote) acc.aliasNotes.push(aliasNote);
  authors.set(canonical, acc);
  return canonical;
}

// ---- issues ----------------------------------------------------------------
const issues: any[] = issueFile.issues;
const issueByKey = new Map(issues.map((i) => [`${i.year}-${i.season}-${i.number}`, i]));
const issueByPost = new Map<number, string>();
for (const i of issues) for (const id of i.articleWpIds) issueByPost.set(id, i.id);

// ---- articles --------------------------------------------------------------
const catById = new Map(categories.map((c) => [c.id, c]));
const tagById = new Map(tags.map((t) => [t.id, t]));
const postByPath = new Map(posts.map((x) => [legacyPathOf(x.link), x]));
const isInternal = (href: string) => /^https?:\/\/(i\d\.wp\.com\/)?govsacademynews\.wpcomstaging\.com/i.test(href);
const takenSlugs = new Map<string, number>();
const articleRows: any[] = [];
const urlMap: any[] = [];
const titleSeen = new Map<string, number>();
const summary: any = { parity: [], unresolvedLinks: 0, unresolvedImages: 0, unsupportedEmbeds: 0 };

// Oldest first so slug collisions resolve the same way on every run.
for (const post of [...posts].sort((a, b) => a.id - b.id)) {
  const item = `post ${post.id}`;
  const title = decodeEntities(post.title.rendered).trim();
  const legacyPath = legacyPathOf(post.link);
  const date = post.date.slice(0, 10);
  const slug = uniqueSlug(decodeURIComponent(post.slug), post.id, takenSlugs);
  if (slug !== decodeURIComponent(post.slug)) flag('slug-collision', 'review', item, `Slug "${post.slug}" was already taken; using "${slug}".`, 'Confirm.');

  const dup = titleSeen.get(title.toLowerCase());
  if (dup) flag('duplicate-candidate', 'review', item, `Same headline as post ${dup}: "${title}".`, 'Check whether one is a duplicate.');
  titleSeen.set(title.toLowerCase(), post.id);

  // Sections
  const cats = post.categories.map((id: number) => catById.get(id)?.slug).filter((s: string) => s && s !== 'uncategorized');
  const known = cats.filter((c: string) => SECTIONS.includes(c));
  let needsReview = false;
  if (known.length === 0) {
    flag('section-unknown', 'error', item, `No recognised section (source categories: ${cats.join(', ') || 'none'}).`, 'Assign a section.');
    needsReview = true;
  }
  if (cats.length !== known.length) flag('section-unmapped', 'review', item, `Unmapped source categories: ${cats.filter((c: string) => !known.includes(c)).join(', ')}.`, 'Add the section or recategorise.');

  // Byline
  let html: string = post.content.rendered;
  const split = splitFirstParagraph(html);
  const byline = split ? parseByline(htmlToText(split.first)) : null;
  let authorSlugs: string[] = [];
  let authorNeedsReview = false;
  let issueId: string | null = issueByPost.get(post.id) ?? null;
  if (byline && split) {
    html = split.rest;
    authorSlugs = byline.authors.map((a) => creditAuthor(a.slug, a.printedName, a.classYear, post.id));
    for (const a of byline.authors) if (!a.classYear) flag('class-year-missing', 'info', item, `Byline "${byline.original}" gives no class year for ${a.printedName}.`, 'None needed unless the author page shows the wrong year.');
    if (byline.issueNumber) {
      const year = byline.issueYear ?? Number(date.slice(0, 4));
      const found = issueByKey.get(`${year}-${byline.issueSeason}-${byline.issueNumber}`);
      if (found) issueId = found.id;
      else flag('issue-unknown', 'review', item, `Byline names "${byline.original}" but no matching issue record exists.`, 'Add the issue to migration/curation/issues.json.');
      if (!byline.issueYear) flag('issue-year-inferred', 'info', item, `"${byline.original}" gives no year; ${year} taken from the post date.`, 'Confirm.');
    }
  } else {
    authorNeedsReview = true;
    flag('byline-unresolved', 'review', item, `No standalone byline found. Opening text: "${htmlToText(split?.first ?? html).slice(0, 90)}"`, 'Add the author by hand; the article is published without a byline.');
  }

  // Body
  const conv = htmlToMarkdown(html, {
    isInternal,
    resolveImage: (src, attachmentId) => {
      const m = (attachmentId && mediaById.get(attachmentId)) || mediaByPath.get(normUrl(src));
      return m ? publishMedia(m.id, item, 'inline') : null;
    },
    resolveLink: (href) => {
      const path = legacyPathOf(decodeEntities(href));
      return postByPath.has(path) ? path : null;
    },
  });
  for (const u of conv.unresolvedLinks) flag('link-unresolved', 'error', item, `Internal link has no migrated target: ${u}`, 'Fix the link by hand.');
  for (const u of conv.unresolvedImages) flag('image-unresolved', 'error', item, `Inline image not found in the media backup: ${u}`, 'Supply the image.');
  for (const t of conv.unsupported) flag('embed-unsupported', 'review', item, `Source contains <${t}>; kept as raw HTML.`, 'Check how it renders.');
  summary.unresolvedLinks += conv.unresolvedLinks.length;
  summary.unresolvedImages += conv.unresolvedImages.length;
  summary.unsupportedEmbeds += conv.unsupported.length;
  for (const img of conv.images) flag('alt-text-missing', 'review', item, `Inline image ${img} has no alternative text on the source site.`, 'Write alt text in the CMS.');

  // Word-for-word parity between source HTML (minus the byline line) and generated Markdown.
  const srcWords = wordTokens(htmlToText(html));
  const outWords = wordTokens(markdownToText(conv.markdown));
  const parityOk = srcWords.join(' ') === outWords.join(' ');
  summary.parity.push({ legacyWpId: post.id, sourceWords: srcWords.length, importedWords: outWords.length, match: parityOk });
  if (!parityOk) {
    needsReview = true;
    flag('content-diff', 'error', item, `Imported text differs from source (${srcWords.length} vs ${outWords.length} words).`, 'Compare with migration/source-html.');
  }
  if (srcWords.length < 120) flag('short-article', 'review', item, `Only ${srcWords.length} words.`, 'Confirm the source is complete.');

  // Cover
  let coverImage: string | null = null;
  if (post.featured_media) {
    coverImage = publishMedia(post.featured_media, item, 'cover');
    if (!coverImage) flag('image-unresolved', 'error', item, `Featured image ${post.featured_media} is missing from the media backup.`, 'Supply the image.');
    else {
      const m = mediaById.get(post.featured_media);
      if (!m.alt_text) flag('alt-text-missing', 'review', item, `Cover image ${coverImage} has no alternative text on the source site.`, 'Write alt text in the CMS.');
      flag('photo-credit-missing', 'review', item, `Cover image ${coverImage} has no photographer or source credit on the source site.`, 'Add the credit, or confirm none is needed.');
    }
  }
  const coverMedia = post.featured_media ? mediaById.get(post.featured_media) : null;

  const data: Record<string, unknown> = {
    title,
    publishedAt: withOffset(post.date, post.date_gmt),
    updatedAt: null,
    section: known[0] ?? 'news',
    secondarySections: known.slice(1),
    kind: byline?.editorial ? 'editorial' : 'article',
    tags: post.tags.map((id: number) => tagById.get(id)?.name).filter(Boolean),
    authors: authorSlugs,
    originalByline: byline?.original ?? null,
    excerpt: null,
    coverImage,
    coverAlt: coverMedia?.alt_text || null,
    coverCaption: coverMedia ? htmlToText(coverMedia.caption?.rendered ?? '') || null : null,
    coverCredit: null,
    featured: false,
    published: true,
    issueId,
    legacyWpId: post.id,
    legacyUrl: post.link,
    legacyPath,
    sourceModifiedAt: withOffset(post.modified, post.modified_gmt),
    authorNeedsReview,
    migrationNeedsReview: needsReview,
  };
  const rel = `src/content/articles/${date}-${slug}.md`;
  emit(rel, `---\n${frontmatter(data)}\n---\n\n${conv.markdown}`);
  articleRows.push({ wpId: post.id, rel, section: data.section, year: date.slice(0, 4) });
  urlMap.push({ legacyUrl: post.link, sourceType: 'post', legacyWpId: post.id, newPath: legacyPath, status: 'migrated', note: 'Same path as on WordPress.' });
}

// Attachments that belong to a post but were never shown in it on the source site.
for (const m of media) {
  if (m.post && posts.some((x) => x.id === m.post) && !published.has(m.id) && m.mime_type.startsWith('image/')) {
    flag('attachment-unused', 'review', `media ${m.id}`, `Uploaded to post ${m.post} but not displayed there on the source site (${m.source_url}).`, 'Kept in the backup only. Add it to the article if it was meant to appear.');
  }
}

// ---- author files ----------------------------------------------------------
for (const [slug, acc] of [...authors].sort()) {
  const name = [...acc.names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? slug;
  const years = [...acc.years].sort((a, b) => b[1] - a[1]);
  const conflict = years.length > 1;
  const variants = [...acc.names.keys()];
  if (conflict) flag('class-year-conflict', 'review', `author ${slug}`, `Bylines give different class years: ${years.map(([y, n]) => `${y} (${n}x)`).join(', ')}. Using ${years[0][0]}.`, 'Confirm the class year.');
  if (variants.length > 1) flag('name-variant', 'info', `author ${slug}`, `Byline spellings: ${variants.join(' / ')}. Displaying "${name}".`, 'Confirm the spelling.');
  for (const note of acc.aliasNotes) flag('author-alias-inferred', 'review', `author ${slug}`, note, 'Confirm these are the same person, or remove the alias from migration/curation/author-aliases.json.');
  emit(`src/content/authors/${slug}.json`, JSON.stringify({
    slug,
    name,
    classYear: years[0]?.[0] ?? null,
    bio: null,
    photo: null,
    visible: true,
    needsReview: conflict || acc.aliasNotes.length > 0,
    sourceEvidence: `Byline text in WordPress posts ${[...new Set(acc.posts)].sort((a, b) => a - b).join(', ')}.`,
  }, null, 2) + '\n');
}

// ---- issue files -----------------------------------------------------------
for (const issue of issues) {
  let pdf: string | null = null;
  let pdfBytes: number | null = null;
  const pageImages: string[] = [];
  if (issue.pdfMediaId) {
    pdf = publishMedia(issue.pdfMediaId, `issue ${issue.id}`, 'issue-pdf', `/issues/${issue.id}.pdf`);
    pdfBytes = mediaById.get(issue.pdfMediaId)?.media_details?.filesize ?? null;
    for (const dupId of issue.duplicatePdfMediaIds ?? []) {
      flag('media-duplicate', 'info', `media ${dupId}`, `Byte-identical re-upload of media ${issue.pdfMediaId}; published once.`, 'None.');
    }
  } else {
    flag('issue-pdf-missing', 'review', `issue ${issue.id}`, `${issue.title} is known only from an editorial's byline; no PDF or page images exist on the source site.`, 'Upload the PDF if the staff still has it.');
  }
  issue.pageMediaIds.forEach((id: number, i: number) => {
    const ext = extname(new URL(mediaById.get(id).source_url).pathname).toLowerCase();
    const path = publishMedia(id, `issue ${issue.id}`, 'issue-page', `/issues/${issue.id}/page-${i + 1}${ext}`);
    if (path) pageImages.push(path);
  });
  emit(`src/content/issues/${issue.id}.json`, JSON.stringify({
    slug: issue.id,
    title: issue.title,
    season: issue.season,
    year: issue.year,
    number: issue.number,
    volume: issue.volume,
    dateLabel: issue.dateLabel,
    publishedOn: null,
    academicYear: issue.season === 'Fall' ? `${issue.year}-${issue.year + 1}` : `${issue.year - 1}-${issue.year}`,
    pdf,
    pdfBytes,
    pageImages,
    notes: issue.notInWebArchive ?? [],
    sourceEvidence: issue.evidence,
  }, null, 2) + '\n');
}

// ---- pages, categories, attachments in the URL map ---------------------------
urlMap.push({ legacyUrl: `${SOURCE_ORIGIN}/`, sourceType: 'home', legacyWpId: '', newPath: '/', status: 'rebuilt', note: 'New homepage. The old "Spring Issue #3" slideshow now lives at /issues/2026-spring-issue-3/.' });
const PAGE_TARGETS: Record<string, [string, string, string]> = {
  'news-2': ['/news/', 'redirect', 'Empty WordPress page titled "News"; a redirect stub at /news-2/ points to the News section.'],
  sports: ['/sports/', 'replaced', 'Empty WordPress page; the same path now serves the Sports section.'],
  news: ['/news/', 'replaced', 'Empty WordPress page at /news/ that was titled "Opinion". The path now serves the News section; Opinion is at /opinion/.'],
  people: ['/people/', 'replaced', 'Empty WordPress page; the same path now serves the People section.'],
  'school-culture': ['/school-culture/', 'replaced', 'Empty WordPress page; the same path now serves the School Culture section.'],
};
for (const page of pages) {
  const slug = decodeURIComponent(page.slug);
  const target = PAGE_TARGETS[slug];
  const words = htmlToText(page.content.rendered);
  if (target) {
    if (words) flag('page-has-content', 'error', `page ${page.id}`, `Page /${slug}/ was expected to be empty but has content.`, 'Migrate its content by hand.');
    urlMap.push({ legacyUrl: decodeURI(page.link), sourceType: 'page', legacyWpId: page.id, newPath: target[0], status: target[1], note: target[2] });
  } else if (page.id === 1) {
    urlMap.push({ legacyUrl: decodeURI(page.link), sourceType: 'page', legacyWpId: page.id, newPath: '/about/', status: 'not-migrated', note: 'WordPress\'s untouched default sample page (Chinese-language boilerplate). Not Governor content; a new About page replaces it.' });
    flag('page-not-migrated', 'info', `page ${page.id}`, 'WordPress default sample page (boilerplate text, never edited). Not migrated.', 'None.');
  } else {
    urlMap.push({ legacyUrl: decodeURI(page.link), sourceType: 'page', legacyWpId: page.id, newPath: '', status: 'blocked', note: 'Unrecognised page; needs a manual decision.' });
    flag('page-unmapped', 'error', `page ${page.id}`, `Page /${slug}/ ("${decodeEntities(page.title.rendered)}") has no mapping.`, 'Decide where it goes.');
  }
}
let categoryPostTotal = 0;
for (const c of categories) {
  const imported = articleRows.filter((a) => posts.find((x) => x.id === a.wpId).categories.includes(c.id)).length;
  categoryPostTotal += c.count;
  if (c.slug === 'uncategorized') {
    urlMap.push({ legacyUrl: c.link, sourceType: 'category', legacyWpId: c.id, newPath: '', status: 'not-migrated', note: 'Default WordPress category with 0 posts.' });
  } else {
    urlMap.push({ legacyUrl: c.link, sourceType: 'category', legacyWpId: c.id, newPath: `/${c.slug}/`, status: 'redirect', note: `Section page; /category/${c.slug}/ redirects to it.` });
  }
  if (c.count !== imported) {
    flag('category-count-mismatch', 'error', `category ${c.slug}`, `WordPress reports ${c.count} posts in "${decodeEntities(c.name)}" but only ${imported} are publicly readable.`, 'Ask the WordPress administrator to check Posts for a draft, private, scheduled or trashed item in this category, or supply the full export (Tools > Export > All content).');
  }
}
for (const m of media) {
  const pub = published.get(m.id);
  urlMap.push({
    legacyUrl: m.source_url, sourceType: 'attachment', legacyWpId: m.id, newPath: pub?.path ?? '',
    status: pub ? 'migrated' : 'backup-only',
    note: pub ? `Used by ${[...pub.usedBy].join(', ')}.` : 'Not displayed in any migrated article; original kept in migration/raw/media.',
  });
}

// ---- media manifest --------------------------------------------------------
const sourceRows = new Map<number, any>();
if (exists(p('migration/media-source.csv'))) {
  const { parseCsv } = await import('./lib/util.ts');
  for (const r of parseCsv(readFileSync(p('migration/media-source.csv'), 'utf8'))) sourceRows.set(Number(r.legacyWpId), r);
}
const manifest = media.map((m) => {
  const pub = published.get(m.id);
  const src = sourceRows.get(m.id) ?? {};
  const isLogo = /govslogo|\/2026\/04\/image-2\.png$/.test(m.source_url);
  return {
    legacyWpId: m.id,
    sourceUrl: m.source_url,
    mimeType: m.mime_type,
    width: m.media_details?.width ?? '',
    height: m.media_details?.height ?? '',
    bytes: src.bytes ?? '',
    sha256: src.sha256 ?? '',
    uploadedAt: m.date,
    attachedToPost: m.post ?? '',
    publicPath: pub?.path ?? '',
    role: pub ? [...pub.role].join('; ') : isLogo ? 'old-site-identity' : 'unused',
    usedBy: pub ? [...pub.usedBy].join('; ') : '',
    altText: m.alt_text ?? '',
    caption: htmlToText(m.caption?.rendered ?? ''),
    credit: '',
    preservation: pub ? 'published + original in backup' : src.backupStatus === 'backed-up' ? 'original in backup only' : 'MISSING',
  };
});
for (const m of manifest) {
  if (m.role === 'old-site-identity') flag('identity-asset', 'info', `media ${m.legacyWpId}`, `School logo / old site branding (${m.sourceUrl}). Not reused until the school approves logo use.`, 'Get identity approval.');
  if (m.preservation === 'MISSING') flag('media-missing', 'error', `media ${m.legacyWpId}`, `No backup copy of ${m.sourceUrl}.`, 'Re-run the audit or obtain the file.');
}

// ---- write reports ---------------------------------------------------------
const bySection: Record<string, number> = {};
const byYear: Record<string, number> = {};
for (const a of articleRows) {
  bySection[a.section] = (bySection[a.section] ?? 0) + 1;
  byYear[a.year] = (byYear[a.year] ?? 0) + 1;
}
Object.assign(summary, {
  generatedAt: new Date().toISOString(),
  files: written,
  articles: articleRows.length,
  articlesBySection: bySection,
  articlesByYear: byYear,
  authors: authors.size,
  issues: issues.length,
  issuesWithPdf: issues.filter((i) => i.pdfMediaId).length,
  mediaPublished: published.size,
  mediaTotal: media.length,
  parityMatches: summary.parity.filter((x: any) => x.match).length,
  categoryCountSumFromWordPress: categoryPostTotal,
  reviewItems: review.length,
  reviewBySeverity: review.reduce((acc: any, r) => ({ ...acc, [r.severity]: (acc[r.severity] ?? 0) + 1 }), {}),
  reviewByType: review.reduce((acc: any, r) => ({ ...acc, [r.type]: (acc[r.type] ?? 0) + 1 }), {}),
});

if (!DRY) {
  writeFile(p('migration/url-map.csv'), toCsv(urlMap, ['legacyUrl', 'sourceType', 'legacyWpId', 'newPath', 'status', 'note']));
  writeFile(p('migration/media-manifest.csv'), toCsv(manifest));
  const order = { error: 0, review: 1, info: 2 } as Record<string, number>;
  review.sort((a, b) => order[a.severity] - order[b.severity] || a.type.localeCompare(b.type));
  writeFile(p('migration/review-queue.csv'), toCsv(review, ['severity', 'type', 'item', 'detail', 'action']));
  writeJson(p('migration/import-summary.json'), summary);
  writeJson(statePath, Object.fromEntries(Object.entries(state).sort()));
}

// Orphan check: importer-owned article files whose source post no longer exists.
const expected = new Set(articleRows.map((a) => a.rel));
const orphans = exists(p('src/content/articles'))
  ? readdirSync(p('src/content/articles')).map((f) => `src/content/articles/${f}`).filter((rel) => state[rel] && !expected.has(rel))
  : [];
if (orphans.length) console.warn('Imported files with no current source post (left in place):', orphans);

const { parity, ...printable } = summary;
console.log(JSON.stringify(printable, null, 2));
