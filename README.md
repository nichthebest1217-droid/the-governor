# The Governor

Website of *The Governor*, the student newspaper of The Governor's Academy (Byfield, Massachusetts).

A static site: [Astro](https://astro.build) builds plain HTML from Markdown files in this repository,
[Pagefind](https://pagefind.app) adds full-text search, [Pages CMS](https://pagescms.org) gives editors a
form-based editor, and GitHub Actions deploys to GitHub Pages. There is no database and no server to maintain.

| If you are...                    | Read                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| An editor publishing stories     | [EDITORIAL_HANDBOOK.md](EDITORIAL_HANDBOOK.md)             |
| Changing code or design          | [CONTRIBUTING.md](CONTRIBUTING.md)                         |
| Checking what came from WordPress | [MIGRATION_REPORT.md](MIGRATION_REPORT.md)                 |
| Getting ready to launch          | [LAUNCH_REPORT.md](LAUNCH_REPORT.md)                       |
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
src/data/               homepage picks, masthead, navigation, site details
src/pages/              routes; src/components/ and src/layouts/ are the building blocks
src/styles/tokens.css   colours, fonts, sizes. Change the look here.
public/media/           article photographs (originals; web sizes are generated at build)
public/issues/          print-issue PDFs and page images
scripts/                migration and QA tools (TypeScript, run directly by Node)
migration/              inventories, URL map, review queue, and the evidence behind them
tests/                  unit tests and built-site smoke tests
.pages.yml              what editors can edit in Pages CMS
.github/workflows/      ci.yml (checks every pull request), deploy.yml (publishes main)
```

## The front page

The front page is a timeline: the newest print issue's stories at the top, older material below in reverse
date order. An issue gets its own block once three of its articles are online (set **Print issue** on each
article; **Order within the issue** controls their sequence). Older articles with no recorded issue are grouped
by the day they were published. Rows always fill their width and cards in a row share a top and a bottom.
The lead story is the editors' pick under **Homepage**, otherwise the first story with a wide photo.
The newest issue is laid out like a broadsheet front: photo stories as text-beside-picture rows in the main
column, text stories in the right-hand column. Photos are kept small on purpose so low-resolution originals
stay sharp.

The nameplate at the top is an image cut from the paper's own print front page
(`public/brand/nameplate.webp`, and `wordmark.webp` for phones). To change it, replace those two files.

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

- GitHub Pages sites may be up to about 1 GB. The site is currently about 110 MB, of which media is about 88 MB
  (`npm run check:media` prints the figure). One 28 MB issue PDF is the largest file. At roughly 30 MB per
  issue PDF plus photos, expect to add 150 to 250 MB a year; plan separate school-approved storage for PDFs
  before the site passes about 800 MB (the check fails at that point on purpose).
- A single file over 100 MB cannot be pushed to GitHub.
- The repository is public if it is on a free plan. Never put an unpublished sensitive story in it.
