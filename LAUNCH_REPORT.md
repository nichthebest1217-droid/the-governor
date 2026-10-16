# Launch Report

Status as of 16 October 2026. **Moved to Google.** The paper is served from the school's Google account and read
at <https://sites.google.com/govsacademy.org/thegovernor> (a Google Site showing the publisher's web app
full-screen). The publisher, an Apps Script project owned by `nicholas.zhuo@govsacademy.org`, builds articles from
the Sheet "The Governor: Publication" and its Google Docs every minute, and holds the archive (69 articles, 35
writers, 5 print issues, 52 pictures and PDFs) in the Drive folder "The Governor website". The old GitHub Pages
address (<https://nichthebest1217-droid.github.io/the-governor/>) only forwards readers there. The WordPress site
is untouched. Details: [google-workspace/SETUP.md](google-workspace/SETUP.md).

Between 13 and 16 October the same design was served as a static Astro site from GitHub Pages; that code stays in
this repository as the source of the archive and as a fallback.

Known limits of hosting on Google: inside the Google Site the address bar does not change from page to page
(each article's Copy link gives its own address, on script.google.com); search engines index the Google Site page,
not each article; a page takes about a second to load.

**Publishing tested end to end on 16 October 2026,** in the live accounts with a clearly labelled test article
("Publishing test: please ignore", by "Test Writer ’27"): a Google Doc with a headline, a byline line, two
pictures with italic captions, bold, italics, a link, a subheading and a bulleted list.

1. Its row, set to Draft and then Ready for Review with the Sheet's Status menu, said "Not on the website" each
   time; nothing reached the website.
2. Set to Published, the row said "Publishing…" at once and "✓ Live" with the article's link about 90 seconds
   later. The publication date filled itself in. The article was the lead story on the Google Site's front page,
   with its own page, a writer page and the first picture as its cover photo.
3. A sentence typed into the Doc was on the website about a minute later.
4. Set back to Draft, it was off the website within a minute, and its copied pictures were in the Drive trash.
5. The row and the Doc were then removed; the website shows the 69 archive articles again.

The test found one fault, now fixed: Google exported the Doc's bulleted list as indented text, which the website
showed as two quote boxes. Indented lists now stay lists, and a heading made bold in the Doc no longer comes out
double-bold (`scripts/lib/doc-markdown.ts`, with tests).

Still open after launch, none of which a developer can settle alone:

- Editors proofread the 14 Issue I articles against the PDF and confirm the section labels.
- Replace the low-resolution Issue I photos with originals; add photo credits and alt text to archive photos.
- Replace the placeholder Editors' Picks; approve the About, Corrections, Contact, Join and Privacy text.
- Post a staff email address (the site currently points readers to the paper's Instagram).
- The unexplained twelfth News post on WordPress (see MIGRATION_REPORT.md).
- A school web address, and a school-owned home for the repository and the Sheet before Nicholas graduates.
- Hand the Sheet, the Google Site and the publisher to a school account before graduation (google-workspace/SETUP.md, "Handing over").

## Where each phase stands

| Phase | Status | Evidence |
| --- | --- | --- |
| 0 Audit | **Done** | [MIGRATION_AUDIT.md](MIGRATION_AUDIT.md) |
| 1 Foundation | **Done** | Astro 7 static project, typed content collections, tokens, CI and deploy workflows |
| 2 Editorial site | **Done**, pending identity approval | 107 pages; desktop, tablet and phone layouts checked in the browser |
| 3 Migration | **Done for all public content**; one source discrepancy open | [MIGRATION_REPORT.md](MIGRATION_REPORT.md) |
| 4 CMS and newsroom | **Done; tested end to end, not yet used by an editor** | Google Sheet + Docs + the publisher ([google-workspace/SETUP.md](google-workspace/SETUP.md)), [EDITORIAL_HANDBOOK.md](EDITORIAL_HANDBOOK.md); the 16 October test above |
| 5 QA and launch | **Automated QA done; launch steps blocked on decisions** | Below |

## Verification run

```
npm run check        0 errors, 0 warnings
npm run build        107 pages; Pagefind indexed 61 pages
npm test             52 tests, 52 pass (16 October 2026, including the publisher and the Sheet's script)
npm run check:links  6,400+ internal references, 0 broken (also clean with BASE_PATH=/the-governor)
npm run check:media  36 files, 77.8 MB, 7.6% of the Pages limit; all present
npm run reconcile    55/55 posts: headline, date, path, byline, cover, text, rendered text
spot-check           13 live WordPress pages match the new site
```

## Acceptance criteria

| Criterion | Status | Note |
| --- | --- | --- |
| Responsive editorial homepage | **Met** | Three-column lead package, Latest, Editors' Picks, seven section bands, print issue, join callout |
| Seven sections work and are populated | **Met** | Paginated; Opinion runs to two pages |
| Article template renders legacy content faithfully | **Met** | Word-for-word check on all 55 built pages |
| Every source URL inventoried with a target or blocker | **Met** | 124 URLs in `migration/url-map.csv` |
| Counts reconcile, with exceptions register | **Partly** | 55 = 55; the News 12-vs-11 counter is open |
| Dates and bylines correct; 10+ spot checks | **Met** | 13 checked against live pages. Two inferred name merges await confirmation |
| Search finds archive articles; drafts excluded | **Met** | Verified in the browser ("Fafa"); a draft fixture is proven absent from pages, feed, sitemap and index |
| Authors, sections, issues, about, masthead, corrections, contact | **Met** | Masthead and contact show honest "not posted yet" notices until data is supplied |
| No broken internal links or missing images | **Met** locally | Re-check on the live URL after first deploy |
| Deployable; checks pass | **Met** | Served from Google since 16 October 2026 (from GitHub Pages, by `deploy.yml`, between 13 and 16 October) |
| Publishing from the newsroom's tools tested | **Met** | Google Docs and the Sheet, 16 October 2026: live, updated after an edit, taken down when set to Draft (above) |
| README and handover docs | **Met** | README, CONTRIBUTING, EDITORIAL_HANDBOOK |
| WordPress site intact | **Met** | Read-only access only |

## Not measured

- **Lighthouse scores.** Not run (no Lighthouse install here), so no score is claimed. What can be stated:
  the homepage is 36 KB of HTML, loads no JavaScript bundle (one small inline script), one stylesheet,
  self-hosted variable fonts (about 50 to 65 KB each, loaded only as used), and responsive WebP images with
  explicit dimensions and lazy loading below the fold. Run Lighthouse on the deployed URL before launch.
- **Screen-reader and keyboard pass by a person.** Structure is in place (skip link, landmarks, one `h1` per
  page, visible focus, reduced-motion support, no carousels), but nobody has walked it with VoiceOver.
- **Colour contrast with the final red.** The provisional accent passes AA on the paper background; re-check
  when the official colour is set.

## Known limits

1. **Alt text is empty on all 27 archive images** because the source had none. This is the main
   accessibility gap, and it needs people who know what the photos show.
2. **No photo credits** exist for the 25 cover images.
3. **Draft copy awaiting editorial approval:** About, Corrections policy, Contact, Join and Privacy pages
   were written for this build. They state only verifiable facts and ordinary newspaper practice, but the
   editors and adviser should read and own them.
4. **Editors' Picks are placeholders** chosen during the build.
5. **Accent colour and nameplate are provisional.** The print edition uses a blackletter nameplate with two
   griffins; the site uses a serif wordmark until the school approves identity assets.
6. **No social image fallback.** Articles without a cover share as text-only cards.
7. **The repository is public on a free plan.** Since the move to Google, unpublished stories never reach it:
   they stay in Google Docs and the Sheet.
8. **Print-issue text is not searchable** (page images and a PDF). The 14 articles from Issue 3 that are
   also web posts are searchable.
9. **Media growth.** About 90 MB of pictures and PDFs in the owner's Drive, within that account's storage.

## To launch (in order)

The website is live on the Google Site. What remains is editorial:

1. Decide the open inputs in MIGRATION_AUDIT.md (WordPress export or admin check, red, email, masthead, domain).
2. Editors clear the review queue (credits, alt text, name confirmations) and set real Editors' Picks in the
   Sheet's Homepage tab.
3. An editor publishes the first real article from the Sheet, following its How to publish tab.
4. Adviser and editor-in-chief approve the About, Corrections, Contact, Join and Privacy text. Announce the
   Google Site's address.
5. Before graduation, hand everything to a school-owned account (google-workspace/SETUP.md, "Handing over").

## Redirect and cutover options (no action taken)

The new site keeps WordPress's article paths: the publisher opens `/2026/05/12/remembering-fafa/` as
`…/exec?p=/2026/05/12/remembering-fafa/`, and the old GitHub Pages address already forwards every path that way.

- **Old WordPress links:** path-preserving redirects are not available for free from a `wpcomstaging.com`
  address. WordPress.com sells a "Site Redirect"; confirm it can point at the forwarding address with the path
  kept before paying for it. Otherwise leave the old posts readable and link to the Google Site from the
  WordPress homepage.
- Either way, keep the WordPress site and the `migration/raw` backup until the adviser signs off that the
  archive is complete. Do not delete WordPress content.
