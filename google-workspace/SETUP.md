# Publishing from Google Docs and Google Sheets

Writers write in Google Docs. Editors list each article in one Google Sheet and set its **Status**:
**Draft**, **Ready for Review** or **Published**. A few minutes after an article is marked Published it is on
the website, in its section, on its own page and on the front page. Editing the Doc or the row updates the
website; setting the Status back to Draft takes the article down. Nobody touches GitHub, and nothing costs money.

- The Sheet: "The Governor: Publication" in the school account `nicholas.zhuo@govsacademy.org`,
  <https://docs.google.com/spreadsheets/d/1n8o4n_5bSl9TOet1IvaAt7pl5FXxLWKiYek6i_2Xbsc/edit>
- Its script: Extensions > Apps Script (the code is [`Code.gs`](Code.gs), the permissions [`appsscript.json`](appsscript.json))
- The website side: [`scripts/lib/sheet-sync.ts`](../scripts/lib/sheet-sync.ts), run by
  [`.github/workflows/sync-docs.yml`](../.github/workflows/sync-docs.yml)
- For editors: the Sheet's **How to publish** tab, and [EDITORIAL_HANDBOOK.md](../EDITORIAL_HANDBOOK.md)

## How it works

```
 Google Doc ──► Sheet row (Status: Published)
                   │  every minute the Sheet's script looks for changes:
                   │  a row marked or unmarked Published, an edited row, an edited Doc
                   ▼
           "Website, update!" ──► GitHub Actions: "Publish from the Google Sheet"
                                     │ 1. reads the Sheet's web address: Published articles only
                                     │ 2. fetches what changed: the Doc as text, its pictures
                                     │ 3. writes the articles, takes down unpublished ones
                                     │ 4. checks and builds the whole site (any failure stops here)
                                     │ 5. commits and publishes to GitHub Pages
                                     ▼
                         website ──► /publishing-status.json ──► Sheet: "✓ Live: <link>"
```

| Thing | Lives in | Why |
| --- | --- | --- |
| Drafts, edits, comments | Google Docs | Where the staff already works |
| Original photos, full size | Google Drive | No size limit; nothing is lost |
| What is published, and how | The Google Sheet | The editors' control panel |
| The pages and web-sized photos | GitHub (this repository) | Free hosting; the design lives here |

**Formatting.** Bold, italics, links, headings, bulleted and numbered lists, tables and pictures carry over.
Fonts, sizes and colours do not: the website applies its own typography. A headline and a "By ..." line at the
top of the Doc are dropped, because they come from the Sheet. An italic line right under a picture becomes its
caption, and a picture at the very top of the Doc becomes the article's cover photo (unless the row has an
Image link). Pictures are re-saved at most 2,000 pixels wide, which also removes camera data such as the GPS
position; the full-size originals stay in Drive.

**Timing.** With instant publishing on (below), an article is live about five minutes after it is marked
Published. Without it, GitHub's own timer collects changes, and GitHub runs that timer late: on this
repository it ran every three to five hours in October 2026.

## Setup

Done on 16 October 2026 except step 4, which only the Sheet's owner can do.

1. **The Sheet and its tabs.** In the Sheet, **The Governor > Set up or repair this Sheet** creates or repairs
   the Articles, How to publish, Homepage, Site and Masthead tabs: columns, dropdowns, colours, notes on every
   column header. It keeps everything already typed (when it has to move columns it first saves a copy of the
   tab). Safe to run again at any time.
2. **Google permissions.** The script asks its owner once for: this spreadsheet only
   (`spreadsheets.currentonly`), reading Docs and photos in Drive (`drive.readonly`: it can never change or
   delete a file), connecting to the website and GitHub (`script.external_request`), showing its menu and
   windows (`script.container.ui`) and running every minute (`script.scriptapp`). No Google Cloud project, API
   key or billing is involved.
3. **The web address GitHub reads.** In the script editor: **Deploy > New deployment > Web app**, *Execute as:
   Me*, *Who has access: Anyone*. Put the address in [`endpoint.json`](endpoint.json). It only ever serves
   Published articles, which are public anyway; drafts and articles waiting for review never leave Google, and
   the Docs' own addresses are never shown.
4. **Instant publishing: the one credential.** The Sheet needs a GitHub key that allows one thing: starting the
   website update. In the Sheet, **The Governor > Turn on instant publishing…** opens a window that walks through
   it:
   1. Click **Open GitHub to create a key** (sign in as the owner of the website's repository). GitHub opens
      its "fine-grained token" page already filled in: name, no expiry, and the single permission
      **Actions: Read and write**.
   2. Under **Repository access**, choose **Only select repositories** and pick **the-governor**. Click
      **Generate token** and copy it.
   3. Paste it into the window and click **Connect**. The Sheet checks the key with GitHub, starts one update,
      and from then on checks every minute.

   Google asks the owner to allow the script to "run when you are not present" at this point; that is the
   every-minute check. The key is kept in the owner's private script storage, never in a cell, and other
   editors cannot see it. It cannot change code or content: the worst a stolen key could do is start or cancel
   website updates. To revoke it: GitHub > Settings > Developer settings > Fine-grained tokens, or
   **The Governor > Turn off instant publishing**.
5. **GitHub.** Nothing to set up: the workflow commits with its own built-in access. Repository variable
   `SITE_INDEXABLE=true` lets search engines in.

The **How to publish** tab says at the top whether instant publishing is on, and says so in red if GitHub stops
accepting the key.

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

- Only rows marked Published are ever offered to the website. Nothing in the Sheet can reach the site's code.
- GitHub treats what the Sheet sends as untrusted: fields are checked, pictures re-encoded, HTML typed into a
  Doc is shown as text, links can only point to web pages or email addresses, and only files the Sheet created
  are ever replaced or removed (archive articles cannot be overwritten).
- A row with a problem never takes a live article down; the live version stays until the row is fixed.
- If more than three articles (and more than half of them) would disappear at once, nothing is taken down and
  the run notes it, in case a filter, a sort or a deleted tab caused it. Take articles down one row at a time.
- Every published change goes through the same type checks, build, tests and link checks as any other change.
  If anything fails, nothing is published and the article's row says so.
- Every change is a commit, so any earlier version can be restored. (Removing something from the repository's
  history entirely needs the web editor.)
- Anyone who can edit the Sheet can publish: share it only with editors and the adviser. A Doc that anyone with
  its link can edit is flagged in the Sheet, because its edits go live too.

## Maintenance

**Changing the script.** Edit [`Code.gs`](Code.gs) here, paste it into Extensions > Apps Script, save, then
**Deploy > Manage deployments > (the web app) > Edit > Version: New version > Deploy**. That keeps the same
web address. (A *New deployment* gets a new address, which then goes into [`endpoint.json`](endpoint.json).)
`npm test` runs the script against a fake of Google's services before you paste it
([`tests/google-sheet.test.ts`](../tests/google-sheet.test.ts)).

**Changing how Docs become articles.** [`scripts/lib/doc-markdown.ts`](../scripts/lib/doc-markdown.ts) and
[`scripts/lib/sheet-sync.ts`](../scripts/lib/sheet-sync.ts); raise `PROCESSOR` in the latter to rebuild every
Sheet article on the next run.

**Running it by hand.** GitHub > Actions > "Publish from the Google Sheet" > Run workflow, or
`node scripts/sync-docs.ts --dry-run` locally to see what would change.

**If something is stuck.** The row's ⚠ message says what is wrong. If a row stays at Publishing… for 30
minutes it says so; the Sheet asks GitHub again by itself three times. Then look at GitHub > Actions for a
red run. If the How to publish tab says instant publishing stopped, the key expired or was deleted: run
**Turn on instant publishing…** again with a new key.

**GitHub's timer.** GitHub turns off scheduled workflows in a repository with no activity for 60 days. Any
publish counts as activity; after a long break, re-enable the workflow under Actions if it says "disabled".

## Handing over

The Sheet, the script and the key belong to a student account, which closes after graduation. Before then:

1. Move the Sheet to the adviser's account or a school shared drive (Share > Transfer ownership). The script
   moves with it.
2. The new owner opens the script, runs **Deploy > New deployment** (Web app, Me, Anyone) and puts the new
   address in [`endpoint.json`](endpoint.json).
3. The new owner runs **The Governor > Turn on instant publishing…** with a key from an account that can manage
   the repository (ideally a school-owned GitHub organisation), and changes `OWNER_EMAIL` under Project
   Settings > Script properties to their address (it tells writers whom to share Docs with).
4. Delete the old key on GitHub.

## The Google Site (the school's front door)

Published on 13 October 2026 from the school account: <https://sites.google.com/govsacademy.org/thegovernor>.
It is one page, a full-page embed of the newspaper, with the seal as its logo and tab icon. A blank "Home" page
is hidden from its navigation and can be deleted.

- **A school address:** a Workspace administrator can map it to something like `governor.govsacademy.org`
  (Admin console > Apps > Google Workspace > Sites > Custom URL).
- **Limits:** new Google Sites cannot be filled by a script, so the articles live on the newspaper site and
  appear here through the embed. Inside the frame the address bar does not change from article to article; the
  "Copy link" button on each article gives the real address.
