# The Governor

Website of *The Governor*, the student newspaper of The Governor's Academy (Byfield, Massachusetts).

A static site: [Astro](https://astro.build) builds plain HTML from Markdown files in this repository,
[Pagefind](https://pagefind.app) adds full-text search, and GitHub Actions deploys to GitHub Pages. There is no
database and no server to maintain.

Editors publish from Google: articles are written in Google Docs and listed in a Google Sheet with a Status of
Draft, Ready for Review or Published. A few minutes after a row is marked Published the article is live; edits
to the Doc or the row follow, and unpublishing takes it down. See
[google-workspace/SETUP.md](google-workspace/SETUP.md). [Pages CMS](https://pagescms.org) remains for the web
editor's occasional work on print issues and the archive.

| If you are...                    | Read                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| An editor publishing stories     | [EDITORIAL_HANDBOOK.md](EDITORIAL_HANDBOOK.md)             |
| Changing code or design          | [CONTRIBUTING.md](CONTRIBUTING.md)                         |
| Checking what came from WordPress | [MIGRATION_REPORT.md](MIGRATION_REPORT.md)                 |
| Getting ready to launch          | [LAUNCH_REPORT.md](LAUNCH_REPORT.md)                       |
| Setting up or maintaining the Google Sheet publishing | [google-workspace/SETUP.md](google-workspace/SETUP.md) |
| Looking for the original brief   | [The_Governor_Claude_Code_Masterplan.md](The_Governor_Claude_Code_Masterplan.md) |

## Run it on your computer

Needs [Node.js](https://nodejs.org) 22.18 or newer.

```bash
npm install
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
src/data/               homepage picks, masthead, navigation, site details, cms-sync.json (what the Sheet published)
src/pages/              routes; src/components/ and src/layouts/ are the building blocks
src/styles/tokens.css   colours, fonts, sizes. Change the look here.
public/media/           article photographs (originals; web sizes are generated at build)
public/issues/          print-issue PDFs and page images
scripts/                Sheet sync, migration and QA tools (TypeScript, run directly by Node)
migration/              inventories, URL map, review queue, and the evidence behind them
tests/                  unit tests and built-site smoke tests
.pages.yml              what editors can edit in Pages CMS
.github/workflows/      ci.yml (checks pull requests), deploy.yml (publishes main), sync-docs.yml (publishes from the Sheet)
google-workspace/       the Google Sheet's script (Code.gs) and its setup guide
```

## The front page

Top to bottom, in the order the masterplan sets out: lead package (hero story plus a rail of four), Latest,
Editors' Picks, one band per section, the print issue, and the call for writers. Columns in a block share a
top and a bottom edge: the hero and feature photos stretch or crop to absorb any difference, so no block ends
with blank space.

- An "edition" is a print issue once three of its articles are online (set **Print issue** on each article;
  **Order within the issue** sets their sequence). Until then it is the most recent publication day.
- The lead is the editors' pick under **Homepage**, otherwise the first story with a landscape photo.
- The wordmark is an image cut from the paper's print front page (`public/brand/wordmark.webp`); the site
  icon is its G in red (`public/favicon.png`).
- Logo files are in `public/brand/`: `logo-seal.png` (crimson seal, 2048 px, with a 512 px copy),
  `logo-seal-black.png`, `logo-mark.png` (square G for avatars) and `social-card.png` (link previews).
- The look is set in two files: `src/styles/tokens.css` (colours, fonts, sizes) and `src/styles/global.css`.

## How publishing works

1. An editor writes or pastes the story in Pages CMS on the `drafts` branch.
2. A pull request from `drafts` to `main` runs every check and needs an approval.
3. Merging to `main` builds and deploys the site (about two minutes).

An article appears only if its file says `published: true` **and** it has been merged to `main`.

## Web addresses

Archive articles keep the exact path they had on WordPress (`/2026/05/14/slug/`). New articles follow the
same pattern, taken from the publication date and the file name. Old `/category/<section>/` links redirect to
the section pages. The full old-to-new table is `migration/url-map.csv`.

## Deploying

`deploy.yml` asks GitHub for the site's address, so the same code works at `https://ORG.github.io/REPO/` and
on a custom domain. Three settings are needed once, in the repository on GitHub:

- **Settings > Pages > Source:** GitHub Actions.
- **Settings > Branches:** protect `main` (require a pull request, one approval, and the `verify` check).
- **Settings > Variables > Actions:** `SITE_INDEXABLE=true` on launch day. Until then every page tells
  search engines not to index it.

## Limits to know about

- GitHub Pages sites may be up to about 1 GB. The published site is about 45 MB, 34 MB of it two issue PDFs.
  Full-size photo originals are **not** published: the build serves web-sized copies and removes the
  originals from the output (`scripts/prune-dist.ts` prints the total and fails the build above 900 MB).
  Keep originals in the staff's Drive. Export issue PDFs small (the 26-27 Issue I PDF is 4.7 MB).
- A single file over 100 MB cannot be pushed to GitHub.
- The repository is public if it is on a free plan. Never put an unpublished sensitive story in it.
