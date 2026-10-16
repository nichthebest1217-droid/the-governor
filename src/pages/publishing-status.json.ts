// What the Google Sheet reads to fill in its "On the website" column: which Sheet articles are
// live (and which version of each), what could not be published and why, and a list of every
// article on the site for the Sheet's "All articles" tab. Holds nothing that is not already public.
import type { APIContext } from 'astro';
import record from '../data/cms-sync.json';
import { authorLabel, getArticles, getAuthorMap, href, permalink, sectionLabel } from '../lib/site';

interface SyncRecord {
  articles: Record<string, { revision: string; file: string }>;
  errors: Record<string, { revision: string; message: string }>;
  warnings: string[];
}

export async function GET(context: APIContext) {
  const sync = record as unknown as SyncRecord;
  const articles = await getArticles();
  const authors = await getAuthorMap();
  const url = (path: string) => new URL(href(path), context.site).toString();
  const byFile = new Map(articles.map((a) => [`src/content/articles/${a.id}.md`, a]));
  const sheet: Record<string, { revision: string; url: string }> = {};
  for (const [id, entry] of Object.entries(sync.articles)) {
    const article = byFile.get(entry.file);
    if (article) sheet[id] = { revision: entry.revision, url: url(permalink(article)) };
  }
  const body = {
    builtAt: new Date().toISOString(),
    sheet,
    errors: sync.errors,
    warnings: sync.warnings,
    all: articles.map((a) => ({
      date: a.data.publishedAt.slice(0, 10),
      title: a.data.title,
      section: sectionLabel(a.data.section),
      authors: a.data.authors.map((id) => authors.get(id)).filter((x) => x !== undefined).map(authorLabel).join(', '),
      url: url(permalink(a)),
      fromSheet: Boolean(a.data.cmsId),
    })),
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
