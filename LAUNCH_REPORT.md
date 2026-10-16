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

Still open after launch, none of which a developer can settle alone:

- Editors proofread the 14 Issue I articles against the PDF and confirm the section labels.
- Replace the low-resolution Issue I photos with originals; add photo credits and alt text to archive photos.
- Replace the placeholder Editors' Picks; approve the About, Corrections, Contact, Join and Privacy text.
- Post a staff email address (the site currently points readers to the paper's Instagram).
- The unexplained twelfth News post on WordPress (see MIGRATION_REPORT.md).
- A school web address, and a school-owned home for the repository and the Sheet before Nicholas graduates.
- Hand the Sheet, the Drive folder and the publisher to a school-owned account before graduation (google-workspace/SETUP.md, "Handing over").

## Where each phase stands

| Phase | Status | Evidence |
| --- | --- | --- |
| 0 Audit | **Done** | [MIGRATION_AUDIT.md](MIGRATION_AUDIT.md) |
| 1 Foundation | **Done** | Astro 7 static project, typed content collections, tokens, CI and deploy workflows |
| 2 Editorial site | **Done**, pending identity approval | 107 pages; desktop, tablet and phone layouts checked in the browser |
| 3 Migration | **Done for all public content**; one source discrepancy open | [MIGRATION_REPORT.md](MIGRATION_REPORT.md) |
| 4 CMS and newsroom | **Configured, not yet tested by a person** | `.pages.yml`, [EDITORIAL_HANDBOOK.md](EDITORIAL_HANDBOOK.md). Needs a GitHub repository and an authorized login |
| 5 QA and launch | **Automated QA done; launch steps blocked on decisions** | Below |

## Verification run

```
npm run check        0 errors, 0 warnings
npm run build        107 pages; Pagefind indexed 61 pages
npm test             22 tests, 22 pass
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
| Deployable by GitHub Actions; build passes locally and in CI | **Met** | Deployed by `deploy.yml` on 13 October 2026 |
| Pages CMS create/edit tested by an authorized user | **Blocked** | Needs the repository and a login. Field types follow the current Pages CMS docs; the `list`, `select` and `date` options could not be exercised and should be confirmed on first login |
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
7. **The repository is public on a free plan,** so `published: false` hides a story from the site but not
   from GitHub. The handbook's workflow keeps unapproved stories out of the repository.
8. **Print-issue text is not searchable** (page images and a PDF). The 14 articles from Issue 3 that are
   also web posts are searchable.
9. **Media growth.** About 78 MB now. See README for the 1 GB plan.

## To launch (in order)

1. Decide inputs 1 to 6 in MIGRATION_AUDIT.md (export or admin check; red; GitHub organization; email;
   masthead; domain).
2. Create the repository in the school organization; push this folder; set Pages source to GitHub Actions.
3. Create the `drafts` branch; protect `main` (pull request, one approval, `verify` check).
4. Confirm the first deploy at `https://ORG.github.io/REPO/`; run Lighthouse; click through on a phone.
5. An authorized editor signs in to Pages CMS and publishes one test edit through a pull request.
6. Editors clear the review queue (credits, alt text, name confirmations) and replace the placeholder picks.
7. Adviser and editor-in-chief approve. Set `SITE_INDEXABLE=true`. Announce.

## Redirect and cutover options (no action taken)

The new site keeps WordPress's article paths, so a domain-level redirect preserves every old link.

- **If the paper gets its own domain:** point it at GitHub Pages. On WordPress.com, a paid "Site Redirect"
  can forward `govsacademynews.wpcomstaging.com/*` to the same path on the new domain.
- **If staying on `github.io`:** replace the old homepage with a notice linking to the new site, and leave the
  old posts readable. Path-preserving redirects are not available for free from a `wpcomstaging.com` address.
- Either way, keep the WordPress site and the `migration/raw` backup until the adviser signs off that the
  archive is complete. Do not delete WordPress content.
