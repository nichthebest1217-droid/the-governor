# Migration Audit (Phase 0)

Audited 13 October 2026. Read-only: nothing on the WordPress site was changed.
Machine-readable results: `migration/audit-summary.json`, `migration/source-inventory.csv`.
Re-run with `npm run audit:wp`.

## Source

| | |
| --- | --- |
| Site | https://govsacademynews.wpcomstaging.com/ ("The GOVERNOR", WordPress.com site 254215479, theme *nook*) |
| `robots.txt` | `Disallow: /` for all crawlers (normal for a `wpcomstaging.com` address). The audit is the publication reading its own site through the documented public API at a slow rate, not a crawl. |
| REST API | `wp-json/wp/v2/` open, HTTP 200 on every endpoint tried |
| Sitemap | `sitemap-1.xml`, 62 URLs |
| RSS | `/feed/`, 10 items |

## What exists (verified)

| Item | API total (`X-WP-Total`) | Fetched | Notes |
| --- | ---: | ---: | --- |
| Posts | 55 | 55 | All dated 16 April to 14 May 2026 (upload dates) |
| Pages | 6 | 6 | Five are empty menu placeholders; one is WordPress's untouched sample page |
| Categories | 8 | 8 | The seven known sections plus an empty default category |
| Tags | 0 | 0 | |
| Media | 54 | 54 | 50 images, 4 PDFs; 183 MB; all backed up with SHA-256 checksums |
| Comments | 0 | 0 | Nothing to migrate |
| User accounts | 1 | 1 | The site administrator. Not a byline source; kept out of this repository |
| Subscribers | 1 (site metadata) | not read | Not migrated, per the brief |

Posts per section: News 11, Opinion 15, Arts 2, Sports 6, Humor & Fun 4, People 8, School Culture 9.

## Cross-checks

- Every one of the 55 post URLs is in the sitemap; the sitemap's other 7 URLs are the homepage and the 6 pages.
- All 10 feed items are in the inventory.
- API totals equal the number of records fetched on every endpoint.
- **One discrepancy:** WordPress's own counter says the News category holds **12** posts, but only **11**
  public posts carry it (category counts sum to 56, public posts to 55). The likeliest cause is a draft,
  private, scheduled or trashed News post, which the public API cannot show. **Open blocker**; see below.

## How the old site stored things (verified)

- **Bylines** are typed as the first paragraph of every post ("by Maxwell Donahue ‘26"). All 55 posts have
  one. The WordPress account behind every post is the same administrator, so it is ignored.
- **Editorials:** four Opinion posts open with "[2026] Spring Issue #N Editorial by ..." and list several
  signers. That is the only place issue numbers 1, 2 and 4 are recorded.
- **Print issue:** the homepage showed "NEW! Spring Issue #3" as a slideshow of 8 page screenshots. The same
  issue's PDF (8 pages, 28 MB) was uploaded four times, byte-identical. The front page reads
  "BYFIELD, MASSACHUSETTS · NON SIBI SED ALIIS · SPRING ISSUE 3 - APRIL 2026". The slideshow showed pages
  3 to 8 in reverse order; the correct order is recoverable from the screenshots' timestamps and contents.
- **Photographs:** 25 posts have a featured image; 2 posts have one inline image each. No image on the site
  has alt text, a caption or a photographer credit. Seven further images were uploaded to posts but never
  displayed.
- **Body markup** is simple: paragraphs, bold, italics, three lists, two figures. No embeds, tables,
  galleries, audio or video. No post links to another post.
- **Excerpts** are auto-generated from the opening lines, not written by editors.
- **Identity:** the header uses the school crest (`govslogo.webp`) and a small logo. Not reused on the new
  site pending school approval.

## Reference sites studied

- **The Phillipian:** centred blackletter nameplate over a thin section bar; one dominant lead image with the
  headline; desks as labelled bands with a text list beside a feature; small red-blue kickers; prominent
  "Latest Paper" and Archives links.
- **The Milton Measure:** serif nameplate with volume and date beneath; lead story text beside a large photo;
  "Editorial Board's Picks"; each section as a ruled band with "View more"; byline, date and reading time on
  every card; generous white space.
- **Taken from them:** hierarchy, ruled section bands, kickers, card metadata, an Editors' Picks block,
  a visible print archive. **Not taken:** logos, colours, fonts, CSS or any text.

## Blockers and inputs needed

| # | Need | Why | Blocks |
| --- | --- | --- | --- |
| 1 | WordPress **Tools > Export > All content** (or an admin to look at Posts > News for a non-public post) | Resolve the 12-vs-11 News count; confirm no drafts or private posts are being left behind | Declaring the archive *complete* |
| 2 | School approval of the **official red** and of crest/logo use | The accent colour is provisional; the crest is not used | Final identity |
| 3 | A **school-controlled GitHub organization** and repository | Ownership must outlive any student | Deploy, Pages CMS test |
| 4 | An approved **public contact email** | Contact, tips, corrections and join pages show a "not posted yet" notice instead of a fake form | Those pages being useful |
| 5 | This year's **masthead** | Page shows a notice until supplied | Masthead page |
| 6 | **Domain** decision | Site works at `ORG.github.io/REPO` without one | Redirect plan |
| 7 | PDFs of **Spring Issues 1, 2 and 4**, if anyone has them | Listed as "no scan in the archive yet" | Issue archive |
