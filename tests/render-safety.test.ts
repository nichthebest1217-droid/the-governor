// Articles from the Google Sheet are rendered with HTML switched off: whatever a Doc or a Sheet
// cell smuggles in shows as text. Runs the site's own Markdown pipeline (Astro's processor with
// src/lib/rehype-media.mjs), so it needs the media manifest from `npm run media`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { p, exists } from '../scripts/lib/util.ts';
import rehypeMedia from '../src/lib/rehype-media.mjs';

const skip = !exists(p('src/data/media-manifest.json')) && 'run `npm run media` first';

test('HTML in a Sheet article shows as text, however the Markdown around it is written', { skip }, async () => {
  const md = await createMarkdownProcessor({ rehypePlugins: [[rehypeMedia, { base: '/' }]], smartypants: false, syntaxHighlight: false });
  const attempts = [
    '``<img src=x onerror=alert(1)>`',
    '\\`<a href="javascript:alert(1)">x</a>\\`',
    '- item\n\n  ```\n  code\n  ```\n  <script>alert(1)</script>',
    'Text <iframe src="https://evil.example/"></iframe> more',
    '<details open ontoggle=alert(1)>',
    '[click](javascript:alert(1))',
  ];
  for (const body of attempts) {
    const { code } = await md.render(body, { frontmatter: { cmsId: '2026-10-16-test' } });
    assert.ok(!/<(img|script|iframe|details)\b/i.test(code) && !/<a\b[^>]*href="javascript:/i.test(code), `${body}\n=> ${code}`);
  }
  const shown = await md.render('Compare <b>this</b>.', { frontmatter: { cmsId: '2026-10-16-test' } });
  assert.match(shown.code, /Compare &#x3C;b>this&#x3C;\/b>\.|Compare &lt;b&gt;this&lt;\/b&gt;\./);
  const archive = await md.render('<b>kept</b>', { frontmatter: {} });
  assert.match(archive.code, /<b>kept<\/b>/, 'archive articles render as before');
});
