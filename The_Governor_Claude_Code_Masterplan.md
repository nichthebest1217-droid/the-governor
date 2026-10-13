# THE GOVERNOR — DIGITAL RELAUNCH
## Master Implementation Brief for Claude Code
**Prepared:** October 13, 2026  
**Project:** Rebuild the student newspaper of The Governor's Academy and migrate its complete WordPress archive  
**Primary objective:** Publish a fast, elegant, student-operated editorial website at zero recurring core software/hosting cost, preserving the historical record.

> **CLAUDE CODE: Treat this as an implementation assignment, not a request for another strategy document.** Inspect the existing repository and source site, formulate a short execution plan, then build the project in small testable increments. Do not invent or fabricate source articles. If access, credentials, or exports are unavailable, finish everything that can be built without them, generate an explicit data-ingestion checklist, and pause only the blocked import actions. Never delete, change, or redirect the original WordPress site without direct permission.

## 0. Source websites and design direction

### Existing publication (the actual migration source)
- Homepage: https://govsacademynews.wpcomstaging.com/
- News archive example: https://govsacademynews.wpcomstaging.com/category/news/
- Example article: https://govsacademynews.wpcomstaging.com/2026/05/14/more-than-free-time-the-real-value-of-senior-spring-term-projects/
- Known existing categories: **News, Opinion, Arts, Sports, Humor & Fun, People, School Culture**. Verify all existing categories, tags, archives, and pages rather than assuming this list is complete.
- Current home includes a **Spring Issue #3** presentation, gallery imagery, and recent posts. Investigate how issues, spreads, PDFs, and images are stored and linked.
- Some article bylines are embedded as text inside the body rather than encoded as WordPress authors. For example, the sample article credits **Maxwell Donahue '26** in its body. Extract bylines conservatively; do not assume the WordPress account name is the journalist.

### Visual inspirations — study, do not clone
1. https://phillipian.net/ — emulate the newspaper-like masthead, serious hierarchy, lead story, weekly top-stories, clearly delineated desks, bylines, and accessible print archives. Do not copy logos or CSS wholesale.
2. https://www.themiltonmeasure.org/ — emulate the refined modern reading experience, editorial picks, multi-section homepage, bylines, article summaries, reading time, searchable archive, and author landing pages. Do not replicate their exact proprietary design.
3. Establish an original **The Governor** design that uses the academy's authentic visual identity, subject to approval of the official school color and logo usage.

## 1. Non-negotiable project principles

- **No articles lost, no rewritten history.** Preserve original headlines, full article bodies, publication dates, attribution, captions, hyperlinks, quotations, intentional formatting, images, and source URLs. Avoid automated paraphrasing. If a field is missing, flag it for review rather than inventing it.
- **Full-site migration, not just `/category/news/`.** Include every public WordPress category, page, post, image gallery, print issue, accessible attachment, relevant author record, and historical archive. Separately inventory comments and subscriber information; do not publish personal data or migrate subscriptions automatically.
- **Editorial integrity.** AI may assist with code, migration, mechanical formatting, and metadata extraction, but cannot invent interviews, quotations, authors, news facts, or reporting. Preserve distinctions between News, Opinion, Editorial, and Humor.
- **Ownership and sustainability.** Deploy under an institutionally controlled GitHub organization/repository rather than an individual graduating student's account if the school agrees. Document transfer of access for future editorial boards.
- **Free-first.** GitHub Pages + Astro + GitHub Actions + Pages CMS + Pagefind are core. Custom domain purchase, third-party mailing lists, or heavy media/CDN services are optional, and must be disclosed as non-free possibilities.
- **Accessibility and privacy.** Follow WCAG 2.2 AA where feasible; use photo credits and descriptive alternative text. Avoid disclosing private student data or importing drafts/private content without explicit authorization.
- **Low maintenance.** Minimize dependencies and runtime JS. Do not require a production database or continuously running backend server.

## 2. Stack and architecture

**Recommended stack**
- Astro (current stable release) with TypeScript and static output.
- Astro content collections for typed article, author, and print-issue data; Markdown for straightforward article editing. Use MDX only where genuinely needed for supported special embeds and components.
- CSS custom properties/design tokens and small scoped styles. Avoid a heavy client UI framework unless a feature truly requires it.
- Pagefind static full-text search, generated from the production `dist/` build. Ensure base-path compatibility with project GitHub Pages URLs.
- Pages CMS with `.pages.yml` configured for article creation/editing, cover images, metadata, author references where supported, and editorial settings. Verify all chosen field schemas against current Pages CMS docs.
- GitHub Actions for lint, type checks, build, internal-link and migration-validation checks, and deployment.
- RSS, `sitemap.xml`, robots rules, canonical URLs, Open Graph metadata, and a useful 404 page.

**URL strategy:** Preserve the original WordPress article pathname when possible, e.g. `/2026/05/14/more-than-free-time-the-real-value-of-senior-spring-term-projects/`, on the new hostname. This improves continuity for historical links and may allow path-preserving domain redirects if later supported. Use the same stable date-based permalink convention for new articles unless the editorial team explicitly approves a different strategy. Section landing pages can use `/news/`, `/opinion/`, etc. Provide a map of every old URL to its new target.

**GitHub Pages details:** An Astro project page may live at `https://ORG.github.io/REPO/` and require `site`/`base` configuration. A custom domain removes the repo prefix. Test links, media, canonical tags, and search in both environments; follow official Astro deployment guidance.

## 3. Visual design system

**Identity:** “The Governor” in an elegant editorial serif masthead, with a restrained Govs-red accent, black/charcoal typography, warm white/off-white background, light neutral dividing rules, and ample whitespace. Validate the exact school red; do not represent a guessed hex code as official.

**Typography proposal:** Newsreader or Libre Baskerville for display headlines, Source Serif 4 or Georgia for article body, Inter or a system sans for labels, navigation and metadata. Optimize locally/self-host where license permits, avoid unnecessary font weights, and provide robust fallbacks.

**Responsive grids:**
- Desktop (>= 1024px): centered max-width ~1240–1320px; 12-column editorial grid; lead story occupying ~7–8 columns; supporting stories in side rail; additional modular category bands.
- Tablet (768–1023px): 2-column lead/story layout, narrower gutters, reorganized sections.
- Mobile (<= 767px): single-column reading flow, functional navigation drawer, no horizontal scroll, legible headlines, appropriately cropped hero images.

**Header:** compact utility strip with today's date or issue identity (only when real, not invented); large masthead centered on desktop; thin-rule top/bottom boundaries; navigation for News, Opinion, Arts, Sports, Humor & Fun, People, School Culture, Archives, About, Search. Avoid overwhelming narrow screens. A future dedicated Editorial desk may be added without recategorizing historical posts incorrectly.

**Homepage content order:**
1. Masthead + current issue/date.
2. Featured lead package: one dominant hero article, two to four secondary high-priority stories, balanced image/no-image layouts.
3. “Latest News” feed or “This Week's Top Stories,” driven by editorial configuration and recent-publication defaults.
4. “Editor's Picks” curated module.
5. Distinct section bands (News, Opinion, Arts, Sports, School Culture, People, Humor & Fun) with a section heading, a 3–4 article group and “View all” link.
6. Latest Print Issue / Browse Archives callout only where real source material exists.
7. Join the Staff / Submit a Tip / Letters to the Editors callout.
8. Footer with masthead, mission, staff contacts approved for publication, corrections policy, privacy, and social links if verified.

**Article page:** category eyebrow; full title; deck/excerpt when supplied; byline(s); original publish date and meaningful correction/update timestamp; reading time; high-quality lead media; credit/caption; comfortable reading measure ~680–760px; preserved original rich content; share/copy link; tags; related stories; corrections link. Do not show empty placeholders or invented descriptions.

**Author page:** author name, optional graduation year/bio/photo when verified, and chronologically sorted posts; multiple authors per story. Historical entries with unidentified authors must remain published but be flagged `authorNeedsReview: true` and omit fabricated bylines.

**Archive pages:** year or academic-year browse, filters by section/author, full-text search, chronological pagination; print-issue gallery with verifiable volume/issue/date/PDF information. Keep article and issue archives conceptually distinct.

**Additional pages:** About, Editorial Board/Masthead, Archives, Search, Corrections, Contact/Submit, Join the Staff, Privacy, and 404. Forms must use a real external submission destination or clearly labelled `mailto:` option; never render a fake working submission form.

## 4. Archive preservation and migration — implement before declaring complete

### 4.1 Source discovery and backup
1. Inspect the source site's robots rules, reachable sitemaps, RSS, `wp-json/wp/v2/` API, HTML category pagination, and image/media URLs. Do not rely solely on public crawling.
2. **Preferred input:** ask the publication's WordPress administrator for **Tools → Export → All content** as WordPress XML/WXR, plus a **separate media library export** or media backup (e.g., archive of images, PDFs, audio). The WXR may reference media URLs rather than embed original binaries.
3. If the REST API is accessible, enumerate `posts`, `pages`, `categories`, `tags`, `media`, and relevant authors with pagination (`per_page=100`, inspect `X-WP-TotalPages`). Use moderate concurrency, exponential backoff/retry, and respect 429s and permissions.
4. If API/export is unavailable, fallback to sitemap discovery and carefully rate-limited crawling of all paginated category/date/archive pages. Mark the resulting dataset **provisional / unverified**, never “complete” without a reconciliation source.
5. Store the untouched XML, HTML snapshots, manifest CSV/JSON, and media originals in a separate secure backup outside the publicly deployed website/repository where appropriate. Avoid exposing commenter emails or administrator identifiers.
6. Never delete the old site or overwrite source records.

### 4.2 Inventory every recoverable asset
For each discovered item, capture:
- `legacyWpId` (if accessible), `legacyUrl`, `sourceType`, original slug and date-based pathname;
- `title`, actual author display names and graduation years *only if verified*, date, modified date, status;
- categories/tags, body HTML, summary if original, linked and featured media, inline images, caption, photographer/source credit, alt text if present;
- audio/video/embed and PDF attachments, original internal and external links;
- school year, original issue/date/volume when demonstrable;
- checksums/file size for assets and preservation status.

Generate `migration/source-inventory.json`, `migration/source-inventory.csv`, `migration/url-map.csv`, `migration/media-manifest.csv`, and `migration/review-queue.csv`.

### 4.3 Conversion rules
- Build an **idempotent** migration CLI. Running it twice must not duplicate posts, rename stable URLs, or overwrite curated edits silently.
- Parse WXR/XML or API content; convert supported WordPress HTML/Gutenberg blocks into Markdown with semantic structure: headings, emphasis, quotations, unordered/ordered lists, hyperlinks, image captions, galleries, embedded media, tables, footnotes if present.
- Strip WordPress UI chrome (“Like,” “Comment,” subscribe widgets, previous/next site navigation, duplicate boilerplate) without stripping article content.
- Detect embedded `by [Author]` lines carefully. Transfer clearly identifiable bylines to author metadata, preserve the original in a raw source backup, and flag ambiguous names for review. Do not strip a `by` phrase if it is substantive prose.
- Normalize typography only where it does not change meaning. Preserve quotations, titles, paragraph sequence, hyperlinks, and the original article text.
- Preserve accessible originals and create optimized display versions of authorized images. Retain high-resolution masters in backup; preserve image provenance and credits. Avoid remote dependencies on the WordPress staging domain where possible.
- Convert absolute internal WordPress links into verified migrated local URLs using `url-map.csv`; leave external links alone. Report unresolved links rather than guessing targets.
- Use explicit slug-collision handling (stable suffixes/legacy ID) and exact dates from source. Do not guess section or writer when unknown.
- Preserve original full HTML/source data separately so editors can audit conversion errors.
- Never infer that an article appeared in a particular print issue without documentary evidence.

### 4.4 Completeness and QA reports
The migration must output totals for source vs imported:
- articles (by category and year), published pages, authors/bylines, image references, successfully imported media, PDF issues, and links;
- duplicate candidates, content-diff flags, unresolved bylines, broken images, broken internal links, unsupported embeds, ambiguous issue mappings, suspiciously short/empty articles;
- public inventory completeness level, source/export match status, and manual fixes still required.

Treat any mismatch as an actionable error or explicit review item. **Do not claim a complete migration while unresolved source posts or inaccessible records remain.**

## 5. Content model (typed schema; adjust names to Astro version)

**Article collection**
```yaml
title: "More Than Free Time: The Real Value of Senior Spring Term Projects"
slug: "more-than-free-time-the-real-value-of-senior-spring-term-projects"
publishedAt: "2026-05-14"
updatedAt: null
section: "news"
secondarySections: []
tags: []
authors:
  - "maxwell-donahue"
excerpt: null
coverImage: "/media/2026/05/original-cover.jpg" # ONLY if source verified
coverAlt: null
coverCaption: null
coverCredit: null
featured: false
published: true
issueId: null
legacyWpId: null
legacyUrl: "https://govsacademynews.wpcomstaging.com/2026/05/14/more-than-free-time-the-real-value-of-senior-spring-term-projects/"
legacyPath: "/2026/05/14/more-than-free-time-the-real-value-of-senior-spring-term-projects/"
authorNeedsReview: false
migrationNeedsReview: false
```
**Important:** The cover path above is an illustrative placeholder, not a discovered image; don't publish that value until a real media file has been confirmed. Test that all generated frontmatter meets the final Astro/Zod and CMS schemas.

**Author collection:** stable ID, display name, optional class year and bio/photo, source evidence, public visibility flags.  
**Issue collection:** stable ID, publication date, volume/number (only if verified), academic year, cover image, downloadable PDF/spread image(s), associated article IDs where verified, original URL.  
**Homepage settings:** featured story IDs, curated picks, optional current issue and alert banner. Store as editable structured data rather than hard-coded array indices.

**Permalinks:** derive canonical paths from `legacyPath` for legacy items, otherwise a stable date/slug path. Keep category landing routes independent of article routes.

## 6. Example project structure

```text
the-governor/
  .github/workflows/ci.yml
  .github/workflows/deploy.yml
  .pages.yml
  astro.config.mjs
  package.json
  README.md
  CONTRIBUTING.md
  EDITORIAL_HANDBOOK.md
  MIGRATION_REPORT.md
  public/
    favicon.svg
    media/                    # approved, optimized publishable images
    issues/                   # approved print PDFs/spreads within hosting limits
  src/
    content.config.ts
    content/
      articles/*.md
      authors/*.json
      issues/*.json
    data/
      homepage.json
      navigation.json
    components/
      SiteHeader.astro
      Masthead.astro
      StoryCard.astro
      LeadStory.astro
      SectionBand.astro
      ArticleMetadata.astro
      ImageWithCredit.astro
      SiteFooter.astro
      SearchBox.astro
    layouts/
      BaseLayout.astro
      ArticleLayout.astro
    pages/
      index.astro
      [year]/[month]/[day]/[slug].astro
      news/index.astro
      opinion/index.astro
      arts/index.astro
      sports/index.astro
      humor/index.astro
      people/index.astro
      school-culture/index.astro
      archives/index.astro
      authors/[slug].astro
      issues/[slug].astro
      about.astro
      masthead.astro
      corrections.astro
      contact.astro
      search.astro
      404.astro
    styles/
      tokens.css
      global.css
  scripts/
    audit-wordpress.ts
    import-wordpress.ts
    reconcile-migration.ts
    check-links.ts
    check-media.ts
  migration/
    .gitignore               # ensure private/raw source data is excluded
    source-inventory.csv
    url-map.csv
    review-queue.csv
  tests/
    content.test.ts
    routes.test.ts
    migration.test.ts
```
This tree is a functional target, not a rigid convention: adjust to supported Astro content collections and framework routing, but explain deviations.

## 7. Editor workflow and publishing controls

Configure `Pages CMS` so an authorized editor can add a story with: headline, optional deck, date, section, author(s), featured image, photographer and caption, tags, body, publication state, and optional issue link. Editors should not have to hand-edit HTML or YAML.

**Security note:** Pages CMS writes to GitHub. Never assume its `published` checkbox constitutes a review/approval workflow. Set up a demonstrated, tested process where drafts are not visible on the public site or in the production search index. Because the repository may be public, sensitive unpublished articles must not be committed there at all. Design and document an appropriate draft/review workflow (e.g. editorial Google Docs → authorized publisher's CMS entry; or protected branches/private repository with validated preview access). Use branch protection and approval checks where compatible. A change to the main branch should not publish unreviewed stories.

Proposed newsroom flow:
1. Writer drafts in school-approved private/shared docs.
2. Section editor edits and fact-checks, verifies sources and rights.
3. Editor-in-chief approves and confirms headline/byline/photographer/date.
4. Authorized web editor creates/publishes through Pages CMS or a reviewed PR.
5. GitHub Actions validates and deploys the static site.
6. Corrections are logged, visible to readers when material, with prior history in Git.

Provide `EDITORIAL_HANDBOOK.md` for student editors, `CONTRIBUTING.md` for developers, permissions/handover guide, troubleshooting, backup/restore instructions, and instructions for uploading print issues and media safely.

## 8. SEO, performance, accessibility and operational quality

- Full metadata: per-page title, description (source excerpt or carefully editorially created), canonical URL, Open Graph/Twitter image, publication/modified times, `NewsArticle` schema where appropriate (no fake author fields), sitemap and RSS.
- Implement Pagefind post-build indexing from `dist/`; only published pages. Verify actual search hits for old content and names.
- Responsive image sizes, WebP/AVIF derivatives where supported, lazy loading below fold, aspect-ratio placeholders, preserved original credits and captions.
- Accessibility: skip link, semantic page landmarks, logical headings, keyboard menus, visible focus states, accessible search, good contrast, proper image alt/caption distinctions, reduced motion preference, no inaccessible carousels.
- Performance budget: aim Lighthouse mobile >=90 for performance/accessibility/SEO under realistic test conditions, stable Core Web Vitals, minimal client JS. Measure rather than asserting a score.
- Unit tests for content normalizers/date routes/slug collisions; HTML/metadata snapshot tests for representative migrated articles; end-to-end or automated smoke tests for nav, mobile, search, issues, 404, and editor path.
- Check GitHub Pages limitations, including the published site's approx. 1 GB size ceiling and bandwidth policies. If archival PDFs/photographs exceed quotas, keep the static application on GitHub Pages and propose separately hosted *school-authorized* media or archival storage rather than silently discarding files.
- No unlicensed brand imagery, copied reference-site content, exposed secrets, student email harvesting, tracking without disclosure, or premature public launch.

## 9. Acceptance criteria (definition of done)

- [ ] Responsive homepage strongly reflects the agreed editorial vision, not a stock blog template.
- [ ] All seven known sections work and are populated when source material exists.
- [ ] Article template faithfully renders representative legacy text, quotations, imagery, bylines and credits.
- [ ] Every publicly recoverable source URL appears in an inventory and has either a verified new equivalent or a clearly documented migration blocker; nothing is silently omitted.
- [ ] Source/export counts reconcile with imported article counts, with an explicit exceptions register.
- [ ] Original article dates and known bylines are correct; at least 10 old articles across sections, dates, and media types are manually spot-checked.
- [ ] Search returns archived and newly published articles; unpublished stories are excluded.
- [ ] Authors, section archives, print issues where available, about, masthead, correction and contact pages work.
- [ ] No broken internal links or missing displayed images in production; all unresolved external links/media clearly documented.
- [ ] Fully deployable using GitHub Actions and GitHub Pages; `npm run build` passes locally and in CI.
- [ ] Pages CMS article creation and edit are tested by an authorized user, or blockers precisely recorded.
- [ ] README and editorial handover documentation allow a future team to operate it without the original developer.
- [ ] The existing WordPress site remains intact until backups, source parity and redirect strategy are independently confirmed and approved.

## 10. Work in the following phases (execute; do not just restate the plan)

**Phase 0 — Audit, no destructive operations:** Examine repo and WordPress site; test public API/sitemap/RSS; identify accessible categories, post volumes, media, current design, source inventory completeness. Output `MIGRATION_AUDIT.md` with source links and blockers. Request XML/media exports only when needed; continue with build work while unavailable.

**Phase 1 — Project foundation:** Scaffold Astro static project with TypeScript, content schemas, global tokens, site/base configuration, GitHub Actions CI/deploy, skeleton content and documentation. Use only a few clearly labelled illustrative/test stories where historical source is unavailable; never portray sample copy as published journalism.

**Phase 2 — Pixel-conscious editorial site:** Implement desktop/tablet/mobile header and homepage, cards, article template, category listings, archive/author/issue templates, search and core info pages. Use real source content where legally and technically available, correct credits, and coherent responsive rules.

**Phase 3 — Migration tooling and import:** Build robust repeatable extraction/transformation scripts. Import XML/media when supplied; fallback crawl only when allowed. Maintain review logs, redirects/permalink mapping, media validation and per-article source parity checks.

**Phase 4 — CMS and newsroom operation:** Implement `.pages.yml`, editorial workflow, draft protections, real publish test, comprehensive contributor and web-editor documentation, school-owned ownership and succession plan.

**Phase 5 — QA / launch:** Run automated checks and manual editorial audit, fix issues, configure domain (if approved), test live GitHub Pages site, prepare optional redirect/cutover strategy, and publish a final `LAUNCH_REPORT.md` with known limits and archive reconciliation status.

## 11. How Claude Code should communicate and proceed

1. Start by showing a concise summary of what you actually discovered in the repository and source site—not guesses.
2. Distinguish **verified**, **inferred**, **blocked**, and **not yet implemented** work.
3. Create an ordered todo checklist and execute the next highest-value unblocked phase immediately.
4. Commit logically separated changes where authorized; do not force-push, rewrite history, deploy publicly, purchase anything, change DNS, or mutate the original WordPress website without permission.
5. Demonstrate output with commands, screenshots/preview when available, and test results rather than simply saying a page was built.
6. Maintain `MIGRATION_REPORT.md` / `LAUNCH_REPORT.md` and summarize source totals, migrated totals, unresolved author/image/issue credits, and remaining risks.
7. Ask for only the unavoidable inputs (e.g. WordPress export, institution GitHub org, official identity assets, final domain, authorized email destination). All other work should continue using sound defaults.

**First tasks now:** Audit the live WordPress site and reference sites, initialize the Astro project, define article/content models, build the homepage + article prototype with verified historical content, and implement the migration inventory script. Proceed from there.

---

## Source and tooling references for the developer
- Existing Governor: https://govsacademynews.wpcomstaging.com/
- Existing News: https://govsacademynews.wpcomstaging.com/category/news/
- The Phillipian: https://phillipian.net/
- The Milton Measure: https://www.themiltonmeasure.org/
- WordPress content export: https://wordpress.com/support/export/
- WordPress media export: https://wordpress.com/support/export-your-media-library/
- WordPress API pagination: https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/
- Astro GitHub Pages deployment: https://docs.astro.build/en/guides/deploy/github/
- Pages CMS documentation: https://pagescms.org/docs/
- Pagefind documentation: https://pagefind.app/docs/
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
