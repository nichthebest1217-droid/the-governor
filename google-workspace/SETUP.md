# The Governor, run from Google

Since 16 October 2026 the newspaper's website is hosted entirely in the school's Google account. Writers write in
Google Docs; editors list each article in one Google Sheet and set its **Status** (**Draft**, **Ready for Review**
or **Published**); about a minute after a row is marked Published the article is on the website, in its section,
on its own page and on the front page. Editing the Doc or the row updates it; setting the Status back to Draft takes
it down. A whole print issue can be added at once: drop its PDF into a Drive folder and its articles arrive in
the Sheet as Google Docs waiting for review. The Google Site is the address readers use. Nothing costs money, and
nothing depends on GitHub.

| Piece | Where | Code (in this repository) |
| --- | --- | --- |
| **The Google Site**, the address readers use | <https://sites.google.com/govsacademy.org/thegovernor>: one page that shows the website full-screen | |
| **The publisher**: the website itself, plus the minute-by-minute check | Apps Script project "The Governor publisher", owned by `nicholas.zhuo@govsacademy.org`; only the owner can open it | [`publisher/Code.gs`](publisher/Code.gs), [`publisher/Doc.gs`](publisher/Doc.gs), [`publisher/Issue.gs`](publisher/Issue.gs) and [`publisher/Page.html`](publisher/Page.html) (the last three generated), [`publisher/appsscript.json`](publisher/appsscript.json) |
| **The Sheet**, "The Governor: Publication" | <https://docs.google.com/spreadsheets/d/1n8o4n_5bSl9TOet1IvaAt7pl5FXxLWKiYek6i_2Xbsc/edit> | Its own script (menu, set-up, instant feedback): [`sheet/Code.gs`](sheet/Code.gs), [`sheet/appsscript.json`](sheet/appsscript.json) |
| **Pictures, PDFs and the site's data** | Drive folder "The Governor website" in the owner's Drive: "Pictures and PDFs (public)" (anyone can view each file) and "Data" (private) | |
| **Print issues** | Drive folder "The Governor: print issues" in the owner's Drive, shared with the Sheet's editors: drop an issue's PDF here; a folder of Docs per issue appears inside | Splitting: [`scripts/lib/pdf-read.ts`](../scripts/lib/pdf-read.ts), [`scripts/lib/issue-split.ts`](../scripts/lib/issue-split.ts); try it on a PDF with `node scripts/split-issue.ts <file>` |
| The pages' design | [`site/app.js`](site/app.js) and `src/styles/` | built into Page.html by `node scripts/build-gas.ts` |
| For editors | The Sheet's **How to publish** tab, and [EDITORIAL_HANDBOOK.md](../EDITORIAL_HANDBOOK.md) | |

## How it works

```
 Google Doc ──► Sheet row (Status: Published)
                   │  every minute the publisher reads the Sheet:
                   │  new or edited Published rows are turned into web pages (text, pictures, byline),
                   │  rows set to Draft or Ready for Review come down,
                   │  and "On the website" says ✓ Live with the link
                   ▼
   Drive: "Pictures and PDFs (public)" + "Data" (live.json, archive.json)
                   ▲
 reader ──► Google Site ──► the publisher's web address (doGet): the newspaper page and its data
                                    └── article texts and searches, as the reader asks (api)
```

- **One web address.** The publisher's web app *is* the website. The Google Site shows it full-screen; inside the
  Site, readers move between pages without the address bar changing (Google Sites does not allow otherwise). Every
  article's **Copy link** gives its own address (the publisher's address with `?p=/2026/10/16/headline/`), which
  opens that article directly.
- **Speed.** A page needs one request to Google (about a second); article texts and searches come from the
  script's cache. Pictures come straight from Drive at the size each screen needs.
- **The archive.** The 55 WordPress articles and the 14 transcribed Issue I articles, their writers, the five print
  issues and every picture and PDF were copied into Drive once, on 16 October 2026, by `importArchive()`, from the
  site this replaced (`google-workspace/import/archive.json`, built by `node scripts/build-archive.ts`). They keep
  their headlines, text, dates and paths.
- **Print issues.** At each check the publisher looks in "The Governor: print issues". A new or replaced PDF is
  read in pieces and split by the layout's own styles: a headline (bold, larger than the text), the writers in
  italics under it, the text in columns, rules between stacked articles, captions under or beside photos. Each
  article becomes a Google Doc (text, photos and captions) and a *Ready for Review* row; the issue gets a row in
  the Issues tab, whose Notes list what could not be made into an article. A long issue is finished over a few
  checks. Setting the issue's row to Published puts a public copy of the PDF on the website (Drive draws the
  cover from its first page; the issue's page shows the PDF in Google's viewer) and publishes its articles still
  *Ready for Review*. It was checked against Issue I, whose 14 articles had been typed in by hand: every article,
  writer and photo matched.
- **Formatting.** Bold, italics, links, headings, lists, tables and pictures in a Doc carry over; fonts, sizes and
  colours do not (the website has its own typography). A headline and a "By ..." line at the top of the Doc are
  dropped, because they come from the Sheet. An italic line right under a picture becomes its caption, and a
  picture at the very top of the Doc becomes the cover photo (unless the row has an Image link).

## Setup (done on 16 October 2026)

1. **The Sheet.** In the Sheet, **The Governor > Set up or repair this Sheet** creates or repairs the Articles,
   How to publish, Homepage, Site and Masthead tabs. It keeps everything already typed. Its script asks only for
   "this spreadsheet" and "show menus".
2. **The publisher.** At <https://script.google.com>, signed in as the Sheet's owner: a project named
   "The Governor publisher" with four files: `Code.gs`, `Doc.gs`, `Page.html` (HTML) and the manifest (Project
   Settings > "Show appsscript.json"), each pasted from this folder; under Services, **Drive API** (v3). It asks the
   owner once to allow:
   - *See, edit, create and delete your spreadsheets*: it opens only the publication Sheet (its ID is in the code);
   - *See and download all your Google Drive files*: read-only, to export the Docs and photos;
   - *See, edit, create and delete only the specific Google Drive files you use with this app*: the website's own
     folder (it cannot touch any other file);
   - *Connect to an external service* and *Allow this application to run when you are not present* (the check).

   No Google Cloud project, API key, GitHub key or billing is involved.
3. **Copy the archive.** Run `importArchive` (choose it in the function menu, then **Run**) until it says the
   archive is in Drive; each run copies for about four and a half minutes.
4. **Start the check.** Run `setUpPublisher`: it creates the Drive folders (including "The Governor: print
   issues"), the Issues tab and the every-minute trigger. The print-issues folder is shared with the Sheet's
   editors once a day.
5. **The web address.** **Deploy > New deployment > Web app**, *Execute as: Me*, *Who has access: Anyone*. Put the
   address in Project Settings > Script properties as `WEB_APP_URL`.
6. **The Google Site.** In the Site's editor, the page holds one full-page embed of that address
   (Insert > Embed > By URL > Whole page). **Publish**.

## What editors see

The **On the website** column fills itself in:

| It says | Meaning |
| --- | --- |
| Not on the website (draft) / (waiting for review) | Not Published, so not public |
| Publishing… / Updating… | On its way; usually live within a minute |
| ✓ Live: *link* | On the website, this exact version |
| Scheduled for *date* | Published with a future date: it goes live that day |
| ⚠ *what is wrong* | Something to fix, in plain words. If the article was live, the earlier version stays up |

## Safety rails

- **Only the owner's script runs with the owner's access, and nobody else can edit it.** Anyone who can edit a
  Google Sheet can edit the script inside it, so the Sheet's own script can touch nothing but the Sheet; the
  publisher is a separate project.
- **Drafts never leave Google.** Only rows marked Published are built into pages. Scheduled articles stay private
  until their day.
- **Nothing in a Doc can run on the website.** Article text is converted with every bit of HTML shown as plain
  text; links may only point to web pages, email addresses or the site itself; only pictures the publisher copied
  into Drive are shown; every page escapes what it displays.
- **The publisher only touches its own files.** It reads Docs and photos (read-only) and writes only inside "The
  Governor website" folder. A taken-down article's pictures go to the Drive trash, where Drive keeps them 30 days.
- **Mistakes do not empty the site.** A row with a problem keeps its live version until it is fixed. If more than
  three of the Sheet's published articles (and more than half) vanish at once, nothing is taken down and the How to
  publish tab says so. A temporary Google error is simply tried again a minute later.
- **What readers can ask for.** The web address answers only with published content: the page, an article's text,
  or search results. The check cannot be started from outside more than once every 20 seconds.
- **Who can publish.** Anyone who can edit the Sheet. Share it only with editors and the adviser. A Doc that anyone
  with its link can edit is flagged in the Sheet, because its edits go live too.

## Maintenance

**Changing the pages' design.** Edit `google-workspace/site/app.js` or `src/styles/`, run `node scripts/build-gas.ts`
and `npm test`, then paste the new `Page.html` into the publisher and update the deployment (below).

**Changing the publisher.** Edit `publisher/Code.gs` (or `scripts/lib/doc-markdown.ts`, `pdf-read.ts` or
`issue-split.ts`, then rebuild `Doc.gs` and `Issue.gs` with `node scripts/build-gas.ts`), run
`npm test` (it runs both scripts against a fake of Google's services, and checks they are plain enough for Apps
Script), paste the file in, and **Deploy > Manage deployments > (the web app) > Edit > Version: New version > Deploy**.
That keeps the same web address. After changing `Doc.gs`, raise `PROCESSOR` in `Code.gs` to rebuild every Sheet
article.

**By hand.** In the publisher, `publishNow` checks the Sheet at once. The trigger can be paused from the
publisher's Triggers page (the clock icon) and restarted with `setUpPublisher`.

**If something is stuck.** The row's ⚠ message says what is wrong. The publisher's Executions page (the list icon)
shows each minute's check and any error. If the How to publish tab no longer says "Publishing is ON", the trigger
has stopped: run `setUpPublisher`.

**Limits.** Apps Script allows a script owner about 90 minutes of trigger time a day on a personal account and six
hours on a school account; the check uses about a minute an hour when nothing changes. Drive holds the pictures
and PDFs (about 90 MB today) within the owner's storage.

## Handing over

Everything belongs to a student account, which closes after graduation. Before then, hand it to the adviser or
another `@govsacademy.org` account (Google does not let school files be given to an address outside the school).
It takes about half an hour, most of it waiting for the archive to copy.

1. **The Sheet and the Google Site:** Share > Transfer ownership to the new owner. The Sheet keeps its address.
2. **The publisher:** share the project with the new owner. They open it, choose **Overview > Make a copy**, and
   in their copy:
   - Project Settings > Script properties: delete any properties that came along, then add `OWNER_EMAIL` with
     their address. The copy is a new app, so it cannot write to the old copy's files; it makes its own folder.
   - Run `importArchive` until it says the archive is in Drive (each run copies for about four and a half
     minutes), then run `setUpPublisher`.
   - **Deploy > New deployment > Web app**, *Execute as: Me*, *Who has access: Anyone*, and put the new address in
     Script properties as `WEB_APP_URL`.

   At its first check it rebuilds every Published row of the Sheet.
3. **Point readers at it:** in the Google Site's editor, change the embed to the new address and **Publish**. Put
   the new address in `redirect/index.html` and `redirect/404.html` too, so old links keep forwarding.
4. **The Sheet's own script:** in the Sheet, Extensions > Apps Script > Project Settings > Script properties, add
   `OWNER_EMAIL` with the new address, so its messages name the right account. Writers share their Docs with it.
5. **The old owner** deletes the old publisher project, which stops its check and its old address. Its "The
   Governor website" folder can then go to the trash.

## Where the old site went

The Astro site that served the paper from GitHub Pages between 13 and 16 October 2026 is kept in this repository
as the source of the archive and as a fallback. Its GitHub Pages address now forwards readers to the Google Site
(and old article links to the same article), so nothing is served from GitHub any more.
