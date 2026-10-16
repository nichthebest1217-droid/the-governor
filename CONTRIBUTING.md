# Contributing (developers)

The live website is the publisher in `google-workspace/`: change it as described in
[google-workspace/SETUP.md](google-workspace/SETUP.md), "Maintenance", and run `npm test` before pasting anything
into Apps Script. The commands below build and check the Astro site that served the paper until 16 October 2026
and remains the source of the archive.

## Ground rules

- Never edit the text of an archive article to "improve" it. Corrections go through the editors and are noted
  on the article (`correction` field).
- Never invent content: no placeholder bylines, captions, dates, photos or issue numbers. If a fact is
  unknown, leave the field empty; the templates hide empty fields.
- Keep it light. No client-side framework; the site ships no JavaScript bundle, only a few inline lines
  (date in the header, archive filters, copy link) and Pagefind on the search page.
- `main` is protected. Work on a branch, open a pull request, let CI pass.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Live preview. Runs the image optimizer first. |
| `npm run build` | Optimize images, build to `dist/`, build the search index. |
| `npm run check` | Astro and TypeScript diagnostics, including the content schemas. |
| `npm test` | Unit tests plus smoke tests against `dist/` (build first). |
| `npm run check:links` | Every internal link, image and srcset in `dist/` resolves. |
| `npm run check:media` | Every referenced media file exists; reports site weight. |
| `npm run reconcile` | Source inventory vs imported content vs built pages. |
| `npm run verify` | All of the above in order. |
| `npm run audit:wp` | Re-read the WordPress site (read-only) into `migration/raw/`. |
| `npm run import:wp` | Regenerate content from `migration/raw/`. Idempotent. |

To test the GitHub project-page layout locally:
`SITE_URL=https://example.github.io BASE_PATH=/the-governor npm run build && BASE_PATH=/the-governor npm run check:links`

## Conventions

- **Links:** always root-relative and wrapped in `href()` from `src/lib/site.ts`, which adds the deploy base
  path. In Markdown bodies write `/2026/05/14/slug/`; the rehype plugin adds the base.
- **Published filter:** get articles only through `getArticles()` in `src/lib/site.ts`. It is the single place
  drafts are filtered out, and `tests/routes.test.ts` proves a draft fixture never reaches `dist/`.
- **Dates** are strings. `publishedAt` may be `2026-10-13` or a full timestamp; the calendar day shown to
  readers is always the first ten characters, so builds do not depend on the server's timezone.
- **Images:** originals go in `public/media/`. `scripts/optimize-media.ts` writes WebP sizes to
  `public/_img/` (git-ignored) and a manifest the templates read for `srcset`, width and height.
- **Design tokens:** colours, type and spacing live in `src/styles/tokens.css`. `--accent` is provisional
  until the school confirms its official red.
- **Scripts** are TypeScript run by Node's built-in type stripping: no enums, no build step.

## Deviations from the masterplan's example tree (and why)

- One dynamic route, `src/pages/[section]/[...page].astro`, replaces seven copy-pasted section pages and adds
  pagination. The Humor section lives at `/humor-fun/` to match its WordPress category slug.
- Article layout lives in the article route itself rather than a separate `ArticleLayout.astro`; only one
  page uses it.
- `ImageWithCredit`/`SearchBox` components are folded into the article route and the search page.
- Added: `scripts/optimize-media.ts`, `src/lib/rehype-media.mjs`, `migration/curation/` (human-reviewed facts
  the importer relies on), `migration/source-html/` (untouched source HTML for auditing).
- Astro 7 defaults to a new Markdown engine; this project opts into the `unified` processor
  (`@astrojs/markdown-remark`) so the rehype plugin works, with smart punctuation turned off so quotation
  marks render exactly as written.

## Re-running the migration

`migration/raw/` is git-ignored (it holds the WordPress administrator's account record and 183 MB of
full-resolution originals). To rebuild it: `npm run audit:wp`. Then `npm run import:wp`.

The importer remembers the hash of every file it writes (`migration/import-state.json`). On a re-run it
rewrites a file only if nobody has edited it since; edited files are skipped and listed. `--force` discards
those edits. If a WordPress export (WXR) arrives later, add a reader for it in `scripts/audit-wordpress.ts`
that produces the same `migration/raw/api/*.json` shape; everything downstream stays the same.
