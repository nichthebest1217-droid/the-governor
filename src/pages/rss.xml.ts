import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE, getArticles, getAuthorMap, href, permalink, sectionLabel, summary } from '../lib/site';

export async function GET(context: APIContext) {
  const articles = (await getArticles()).slice(0, 30);
  const authors = await getAuthorMap();
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: new URL(href('/'), context.site).toString(),
    items: articles.map((a) => ({
      title: a.data.title,
      link: new URL(href(permalink(a)), context.site).toString(),
      pubDate: new Date(a.data.publishedAt),
      description: summary(a, 280),
      categories: [sectionLabel(a.data.section)],
      author: a.data.authors.map((id) => authors.get(id)?.data.name).filter(Boolean).join(', ') || undefined,
    })),
  });
}
