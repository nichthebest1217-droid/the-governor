// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import rehypeMedia from './src/lib/rehype-media.mjs';

// Local preview:            http://localhost:4321/
// GitHub project page:      SITE_URL=https://ORG.github.io BASE_PATH=/REPO   (set by deploy.yml)
// Custom domain:            SITE_URL=https://example.org  BASE_PATH=/
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (page) => !/\/(404|search|category|news-2)\//.test(page) })],
  // smartypants off: quotation marks and dashes render exactly as the writers typed them.
  markdown: { processor: unified({ smartypants: false, rehypePlugins: [[rehypeMedia, { base }]] }) },
});
