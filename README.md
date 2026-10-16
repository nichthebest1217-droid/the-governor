# The Governor

Website of *The Governor*, the student newspaper of The Governor's Academy (Byfield, Massachusetts).

**Since 16 October 2026 the paper runs entirely in the school's Google account.** Readers use the Google Site,
<https://sites.google.com/govsacademy.org/thegovernor>, which shows the newspaper served by an Apps Script
project ("The Governor publisher") from a Google Sheet, Google Docs and a Drive folder. Writers write in Docs;
editors set a Status of Draft, Ready for Review or Published in the Sheet, and about a minute later the article is
live. Nothing is hosted on GitHub any more: the old GitHub Pages address only forwards to the Google Site. See
[google-workspace/SETUP.md](google-workspace/SETUP.md).

This repository holds the code: the publisher and the Sheet's scripts (`google-workspace/`), the pages' design
(`google-workspace/site/app.js` and `src/styles/`), the tools that build them (`scripts/`), and the Astro site that
served the paper from 13 to 16 October 2026, kept as the source of the archive and as a fallback.

| If you are...                    | Read                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| An editor publishing stories     | [EDITORIAL_HANDBOOK.md](EDITORIAL_HANDBOOK.md)             |
| Changing code or design          | [CONTRIBUTING.md](CONTRIBUTING.md)                         |
| Checking what came from WordPress | [MIGRATION_REPORT.md](MIGRATION_REPORT.md)                 |
| Getting ready to launch          | [LAUNCH_REPORT.md](LAUNCH_REPORT.md)                       |
| Setting up or maintaining the Google Sheet publishing | [google-workspace/SETUP.md](google-workspace/SETUP.md) |
| Looking for the original brief   | [The_Governor_Claude_Code_Masterplan.md](The_Governor_Claude_Code_Masterplan.md) |

## Run it on your computer

The live site needs nothing on your computer. To change its code you need [Node.js](https://nodejs.org) 22.18
or newer:

```bash
npm install
node scripts/build-gas.ts   # rebuild the publisher's Page.html and Doc.gs after changing the design or Doc.gs
npm test                    # the publisher, the Sheet's script and the pages, run against a fake of Google
```

The Astro fallback site still builds:

```bash
npm run dev        # live preview at http://localhost:4321 (search is not available in dev)
npm run build      # full production build into dist/, including the search index
npm run preview    # serve dist/ at http://localhost:4321, with working search
npm run verify     # type check + build + tests + link check + media check
```

## Where things live

```text
src/content/articles/   one Markdown file per article (frontmatter + body)
src/content/authors/    one JSON file per writer
src/content/issues/     one JSON file per print issue
src/data/               homepage picks, masthead, navigation, site details (of the Astro site)
src/pages/              routes; src/components/ and src/layouts/ are the building blocks
src/styles/tokens.css   colours, fonts, sizes. Change the look here (both sites use it).
public/media/           article photographs (originals; web sizes are generated at build)
public/issues/          print-issue PDFs and page images
scripts/                build tools for the publisher, the archive bundle, migration and QA (TypeScript, run directly by Node)
migration/              inventories, URL map, review queue, and the evidence behind them
tests/                  unit tests and built-site smoke tests
.pages.yml              Pages CMS settings from the Astro site (not used since the move to Google)
.github/workflows/      ci.yml (checks pull requests), deploy.yml (publishes the forwarding pages in redirect/)
redirect/               the two pages the old GitHub Pages address serves: they forward readers to Google
google-workspace/       the publisher (publisher/), the Sheet's own script (sheet/), the pages (site/app.js), the archive bundle (import/), setup guide
```

## The front page

Top to bottom, in the order the masterplan sets out: lead package (hero story plus a rail of four), Latest,
Editors' Picks, one band per section, the print issue, and the call for writers. Columns in a block share a
top and a bottom edge: the hero and feature photos stretch or crop to absorb any difference, so no block ends
with blank space.

- An "edition" is a print issue once three of its articles are online (set **Print issue** on each article;
  **Order in issue** sets their sequence). Until then it is the most recent publication day.
- The lead is the editors' pick under **Homepage**, otherwise the first story with a landscape photo.
- The wordmark is an image cut from the paper's print front page (`public/brand/wordmark.webp`); the site
  icon is its G in red (`public/favicon.png`).
- Logo files are in `public/brand/`: `logo-seal.png` (crimson seal, 2048 px, with a 512 px copy),
  `logo-seal-black.png`, `logo-mark.png` (square G for avatars) and `social-card.png` (link previews).
- The look is set in two files: `src/styles/tokens.css` (colours, fonts, sizes) and `src/styles/global.css`.

## How publishing works

1. A writer writes the story in a Google Doc and shares it with the Sheet's owner.
2. An editor adds a row to the Sheet's **Articles** tab with the Doc link, title, author(s) and category, and
   moves its **Status** from Draft to Ready for Review to Published.
3. About a minute later the publisher has put it on the website, and **On the website** says ✓ Live with its
   link. Edits to the Doc or the row follow within a minute; setting the Status back to Draft takes it down.

Only Published rows are ever public. The details for editors are in the Sheet's **How to publish** tab and in
[EDITORIAL_HANDBOOK.md](EDITORIAL_HANDBOOK.md).

## Web addresses

Archive articles keep the exact path they had on WordPress (`/2026/05/14/slug/`). New articles follow the
same pattern, taken from the publication date and the file name. Old `/category/<section>/` links redirect to
the section pages. The full old-to-new table is `migration/url-map.csv`.

## Deploying

A code change reaches the website by pasting the changed files into the publisher's Apps Script project and,
when `Page.html` changed, deploying a new version of its web app (same address). The steps are in
[google-workspace/SETUP.md](google-workspace/SETUP.md), "Maintenance". GitHub deploys nothing but the two
forwarding pages (`deploy.yml`, when `redirect/` changes).

## Limits to know about

- Pictures and PDFs live in the owner's Drive (about 90 MB today) and count against that account's storage.
- Apps Script limits how long scripts may run each day (about 90 minutes on a personal account, six hours on a
  school account); the minute-by-minute check uses about a minute an hour when nothing changes.
- The repository is public if it is on a free plan. Drafts never reach it: they stay in Google Docs and the Sheet.
