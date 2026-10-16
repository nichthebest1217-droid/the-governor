// Rehype plugin for article bodies:
//  - prefixes root-relative links and images with the deploy base path,
//  - gives images dimensions, lazy loading and a responsive srcset (from `npm run media`),
//  - turns an image with a title into <figure><figcaption>,
//  - marks external links, and drops links that would run code (javascript: and the like).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { visit } from 'unist-util-visit';

// Resolved from the project root: when Astro bundles pages, import.meta.url no longer points
// into src/, so a path relative to this file would silently find nothing.
const MANIFEST = join(process.cwd(), 'src/data/media-manifest.json');
let cache;
export function mediaManifest() {
  if (!cache) {
    if (!existsSync(MANIFEST)) throw new Error(`Missing ${MANIFEST}. Run \`npm run media\` (npm run dev and npm run build do this for you).`);
    cache = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  }
  return cache;
}

export function withBase(base, path) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return path;
  return base.replace(/\/$/, '') + path;
}

export default function rehypeMedia({ base = '/' } = {}) {
  return (tree) => {
    const manifest = mediaManifest();
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
        const href = node.properties.href;
        // A link that would run code instead of opening a page is dropped (the words stay).
        if (/^\s*(javascript|vbscript|data|file):/i.test(href)) delete node.properties.href;
        else if (/^https?:\/\//.test(href)) node.properties.rel = ['noopener'];
        else node.properties.href = withBase(base, href);
      }
      if (node.tagName === 'img' && typeof node.properties?.src === 'string') {
        const src = node.properties.src;
        const info = manifest[src];
        node.properties.loading = 'lazy';
        node.properties.decoding = 'async';
        if (node.properties.alt === undefined) node.properties.alt = '';
        if (info) {
          node.properties.width = info.width;
          node.properties.height = info.height;
          if (info.variants.length) {
            node.properties.srcset = info.variants.map((v) => `${withBase(base, v.path)} ${v.width}w`).join(', ');
            node.properties.sizes = '(min-width: 800px) 720px, 100vw';
            node.properties.src = withBase(base, info.variants[info.variants.length - 1].path);
          } else node.properties.src = withBase(base, src);
        } else node.properties.src = withBase(base, src);
        const caption = node.properties.title;
        if (caption && parent && typeof index === 'number') {
          delete node.properties.title;
          const figure = {
            type: 'element', tagName: 'figure', properties: {},
            children: [node, { type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: String(caption) }] }],
          };
          // A paragraph holding only this image becomes the figure itself.
          if (parent.tagName === 'p' && parent.children.length === 1) {
            parent.tagName = 'figure';
            parent.children = figure.children;
          } else parent.children[index] = figure;
        }
      }
    });
  };
}
