# Publishing from Google Docs and Google Sheets

Writers write in Google Docs. Editors list each article in one Google Sheet and set its **Status**:
**Draft**, **Ready for Review** or **Published**. A few minutes after an article is marked Published it is on
the website, in its section, on its own page and on the front page. Editing the Doc or the row updates the
website; setting the Status back to Draft takes the article down. Nobody touches GitHub, and nothing costs money.

| Piece | Where | Code |
| --- | --- | --- |
| The Sheet, "The Governor: Publication" | School account `nicholas.zhuo@govsacademy.org`: <https://docs.google.com/spreadsheets/d/1n8o4n_5bSl9TOet1IvaAt7pl5FXxLWKiYek6i_2Xbsc/edit> | |
| The Sheet's own script: menu, set-up, instant feedback | In the Sheet: Extensions > Apps Script | [`sheet/Code.gs`](sheet/Code.gs), [`sheet/appsscript.json`](sheet/appsscript.json) |
| **The publisher**: reads the Docs, answers GitHub, holds the GitHub key | A separate Apps Script project, "The Governor publisher", that only the owner can open | [`publisher/Code.gs`](publisher/Code.gs), [`publisher/appsscript.json`](publisher/appsscript.json) |
| The website side | This repository, run by GitHub Actions | [`scripts/lib/sheet-sync.ts`](../scripts/lib/sheet-sync.ts), [`.github/workflows/sync-docs.yml`](../.github/workflows/sync-docs.yml) |
| For editors | The Sheet's **How to publish** tab, and [EDITORIAL_HANDBOOK.md](../EDITORIAL_HANDBOOK.md) | |

## How it works

```
 Google Doc ──► Sheet row (Status: Published)
                   │  every minute the publisher looks for changes:
                   │  a row marked or unmarked Published, an edited row, an edited Doc
                   ▼
           "Website, update!" ──► GitHub Actions: "Publish from the Google Sheet"
                                     │ 1. reads the publisher's web address: Published articles only
                                     │ 2. fetches what changed: the Doc as text, then its pictures
                                     │ 3. writes the articles, takes down unpublished ones
                                     │ 4. checks and builds the whole site (any failure stops here)
                                     │ 5. commits and publishes to GitHub Pages
                                     ▼
                         website ──► /publishing-status.json ──► publisher ──► Sheet: "✓ Live: <link>"
```

**Why two scripts.** Anyone who can edit a Google Sheet can also edit the script inside it. The publisher runs
with the owner's access (it reads the owner's Drive to export the Docs, and it holds the GitHub key), so it
lives in its own project that only the owner can open. The Sheet's own script runs as whoever is editing and
can touch nothing but the spreadsheet.

**Formatting.** Bold, italics, links, headings, bulleted and numbered lists, tables and pictures carry over.
Fonts, sizes and colours do not: the website applies its own typography. A headline and a "By ..." line at the
top of the Doc are dropped, because they come from the Sheet. An italic line right under a picture becomes its
caption, and a picture at the very top of the Doc becomes the cover photo (unless the row has an Image link).
Pictures are re-saved at most 2,000 pixels wide, which also removes camera data such as GPS position; the
full-size originals stay in Drive.

**Timing.** With instant publishing on (step 4 below), an article is live about five minutes after it is marked
Published. Without it, GitHub's own timer collects changes, and GitHub runs that timer late: on this repository
it ran every three to five hours in October 2026.

## Setup

1. **The Sheet.** In the Sheet, **The Governor > Set up or repair this Sheet** creates or repairs the Articles,
   How to publish, Homepage, Site and Masthead tabs: columns, dropdowns, colours, a note on every column header.
   It keeps everything already typed (when it has to move columns it first saves a copy of the tab) and is safe
   to run again at any time. The Sheet's script asks only for "this spreadsheet" and "show menus".
2. **The publisher.** At <https://script.google.com>, signed in as the Sheet's owner: **New project**, name it
   "The Governor publisher", paste [`publisher/Code.gs`](publisher/Code.gs) into `Code.gs`, and (Project Settings
   > "Show appsscript.json") paste [`publisher/appsscript.json`](publisher/appsscript.json). Save. Choose
   `setUpPublisher` in the function menu and click **Run**. Google asks the owner, once, to allow:
   - *See, edit, create and delete your spreadsheets*: it opens only the publication Sheet (its ID is in the code);
   - *See and download your Google Drive files*: read-only, to export the Docs and photos; it never changes or
     deletes a file;
   - *Connect to an external service*: the website and GitHub;
   - *Allow this application to run when you are not present*: the every-minute check.

   No Google Cloud project, API key or billing is involved.
3. **The web address GitHub reads.** In the publisher: **Deploy > New deployment > Web app**, *Execute as: Me*,
   *Who has access: Anyone*. Put the address in [`endpoint.json`](endpoint.json). It serves only Published
   articles, which are public anyway; it never shows a Doc's address or the headline of anything unpublished,
   and it changes nothing in the Sheet.
4. **Instant publishing: the one credential.** The publisher needs a GitHub key that allows exactly one thing:
   starting the website update.
   1. Open [GitHub's key page, already filled in](https://github.com/settings/personal-access-tokens/new?name=The+Governor+publisher&description=Lets+the+Google+Sheet+start+the+website+update.&target_name=nichthebest1217-droid&expires_in=none&actions=write)
      (signed in as the owner of the website's repository). It sets the name, no expiry, and the single permission
      **Actions: Read and write**.
   2. Under **Repository access**, choose **Only select repositories** and pick **the-governor**. Click
      **Generate token** and copy it (it starts with `github_pat_`).
   3. In the publisher: **Project Settings** (gear icon) > **Script Properties** > **Add script property**.
      Property `GITHUB_KEY`, value: the key. **Save**.

   Within a minute the Sheet's How to publish tab says **Instant publishing is ON** (or, in red, what is wrong
   with the key). Only the owner can see the key. It cannot change code or content: the worst a stolen key could
   do is start or cancel website updates. To revoke it, delete it on GitHub (Settings > Developer settings >
   Fine-grained tokens) or remove the script property.
5. **GitHub.** Nothing to set up: the workflow commits with its own built-in access. Repository variable
   `SITE_INDEXABLE=true` lets search engines in.

## What editors see

The **On the website** column fills itself in:

| It says | Meaning |
| --- | --- |
| Not on the website (draft) / (waiting for review) | Not Published, so not public |
| Publishing… / Updating… | On its way; usually live within five minutes |
| ✓ Live: *link* | On the website, this exact version |
| Scheduled for *date* | Published with a future date: it goes live that day |
| Taking it off the website… | Was live; the Status changed; it is being taken down |
| ⚠ *what is wrong* | Something to fix, in plain words. If the article was live, the earlier version stays up |

## Safety rails

- Only rows marked Published are ever offered to the website. Drafts, rows waiting for review and scheduled
  articles never leave Google; the public list carries only scrambled IDs for them.
- GitHub treats what the publisher sends as untrusted: fields are checked, pictures re-encoded, any HTML in an
  article from the Sheet is shown as text (enforced where the page is rendered, not only by cleaning the text),
  links can only point to web pages or email addresses, and only files the Sheet created are ever replaced or
  removed (archive articles cannot be overwritten).
- A row with a problem never takes a live article down; the live version stays until the row is fixed. A
  temporary failure (Google busy, a row edited mid-update) is tried again on the next run.
- A row set to Draft is taken down. A row deleted from the Sheet is taken down too, unless more than three (and
  more than half) of the Sheet's articles disappear at once: then nothing is taken down and the How to publish
  tab says so, in case a tab was emptied or a paste went wrong.
- Every published change passes the same type checks, build, tests and link checks as any other change. If
  anything fails, nothing is published and the row says so. If a publish does not finish, the next run notices
  that the website is behind and publishes again.
- Every change is a commit, so any earlier version can be restored. (Removing something from the repository's
  history entirely needs the web editor.)
- Anyone who can edit the Sheet can publish: share it only with editors and the adviser. A Doc that anyone with
  its link can edit is flagged in the Sheet, because its edits go live too.

## Maintenance

**Changing a script.** Edit the file here, paste it into the matching project (the Sheet's script or the
publisher), and save. `npm test` first runs both against a fake of Google's services
([`tests/google-sheet.test.ts`](../tests/google-sheet.test.ts)); the block of code the two share must stay
identical, and the test checks that. After changing the publisher, update its web address in place:
**Deploy > Manage deployments > (the web app) > Edit > Version: New version > Deploy**. That keeps the same
address. (A *New deployment* gets a new address, which then goes into [`endpoint.json`](endpoint.json).)

**Changing how Docs become articles.** [`scripts/lib/doc-markdown.ts`](../scripts/lib/doc-markdown.ts) and
[`scripts/lib/sheet-sync.ts`](../scripts/lib/sheet-sync.ts); raise `PROCESSOR` in the latter to rebuild every
Sheet article on the next run.

**By hand.** GitHub > Actions > "Publish from the Google Sheet" > Run workflow publishes now. In the publisher,
running `publishNow` checks the Sheet and starts an update even if nothing changed; `stopPublisher` stops the
every-minute check (`setUpPublisher` starts it again). Locally, `node scripts/sync-docs.ts --dry-run` shows
what would change.

**If something is stuck.** The row's ⚠ message says what is wrong. A row that stays at Publishing… for 30
minutes says so; the publisher asks GitHub again by itself three times. Then look at GitHub > Actions for a red
run. If the How to publish tab says instant publishing stopped, the key expired or was deleted: put a new one in
the publisher's Script Properties.

**GitHub's timer.** GitHub turns off scheduled workflows in a repository with no activity for 60 days. Any
publish counts as activity; after a long break, re-enable the workflow under Actions if it says "disabled".

## Handing over

The Sheet, the publisher and the key belong to a student account, which closes after graduation. Before then:

1. Move the Sheet to the adviser's account or a school shared drive (Share > Transfer ownership). Its own script
   moves with it.
2. The new owner creates their own publisher (step 2 of Setup; if the Sheet's address changed, set its ID as the
   script property `SHEET_ID`), deploys it (step 3) and puts the new address in [`endpoint.json`](endpoint.json).
   They set the script property `OWNER_EMAIL` to their address in both scripts (it tells writers whom to share
   Docs with).
3. The new owner adds a GitHub key (step 4) from an account that can manage the repository, ideally a
   school-owned GitHub organisation.
4. The old owner runs `stopPublisher` and deletes the old key on GitHub.

## The Google Site (the school's front door)

Published on 13 October 2026 from the school account: <https://sites.google.com/govsacademy.org/thegovernor>.
It is one page, a full-page embed of the newspaper, with the seal as its logo and tab icon. A blank "Home" page
is hidden from its navigation and can be deleted.

- **A school address:** a Workspace administrator can map it to something like `governor.govsacademy.org`
  (Admin console > Apps > Google Workspace > Sites > Custom URL).
- **Limits:** new Google Sites cannot be filled by a script, so the articles live on the newspaper site and
  appear here through the embed. Inside the frame the address bar does not change from article to article; the
  "Copy link" button on each article gives the real address.
