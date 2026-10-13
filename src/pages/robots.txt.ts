import type { APIContext } from 'astro';
import { INDEXABLE, href } from '../lib/site';

// Search engines stay out until the staff launches: set SITE_INDEXABLE=true in deploy.yml.
export function GET(context: APIContext) {
  const body = INDEXABLE
    ? `User-agent: *\nAllow: /\nDisallow: ${href('/pagefind/')}\n\nSitemap: ${new URL(href('/sitemap-index.xml'), context.site)}\n`
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
