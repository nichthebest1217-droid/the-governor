# Publishing from Google Docs

Writers keep writing in Google Docs. An editor lists each finished article in one Google Sheet and marks it
**Approved**. Every half hour the website's repository asks the Sheet for approved articles, checks them,
and publishes. No coding, no cost, no Google Cloud project, and **no access token stored anywhere**.

## Status (13 October 2026)

Set up and running in the school account `nicholas.zhuo@govsacademy.org`:

- Sheet: "The Governor: Publication" (with the script attached; menu **The Governor**).
- The script's web address is deployed (version 2) and recorded in `endpoint.json`.
- **Tested end to end on 13 October 2026:** a test Doc listed in the Sheet and marked Approved was collected
  by the GitHub workflow, passed the checks, was committed and went live with the right headline, byline and
  text. The test article was then removed.
- The photo path was tested the same way: a Drive image was fetched, converted to a clean JPEG and
  published with its description. Both test articles were removed afterwards.

## What goes where

| Thing | Lives in | Why |
| --- | --- | --- |
| Drafts and edits | Google Docs | Where the staff already works |
| Original photos, full size | Google Drive | No size limit to worry about; nothing is lost |
| The list of what is approved | The Google Sheet | The editor-in-chief's control panel |
| The website's pages and web-sized photos | GitHub | Free hosting; the design lives here |

Only a 2,000-pixel copy of each photo reaches the website, and the site publishes smaller WebP versions.

## Publishing an article

1. Add a row: Doc link, headline, section, writers (`Jane Doe '27, Sam Lee '28`), date, and type.
2. For a photo: paste the Drive link of the image, and fill in the description (what the picture shows),
   caption and credit.
3. If the article ran in print, add the issue ID (for example `2026-27-issue-2`) and its order in the issue.
4. **The Governor > Check approved rows** (optional) says in the Result column whether each row is ready.
5. The editor-in-chief sets **Status** to **Approved**. Within about 30 minutes the article is live.
   To publish at once: on GitHub, Actions > "Collect approved articles from the Google Sheet" > Run workflow.
6. **The Governor > Mark live articles as Published** tidies the Status column afterwards.

To correct an article, fix the Doc and set the row to *Approved* again. To hold something back, use any
status other than *Approved*.

The Docs and photos must be readable by the account that owns the Sheet (share them with it, or keep them in
a folder it can open).

What the script ignores on purpose: fonts, sizes, colours and spacing in the Doc, pictures pasted into the
Doc (add photos through the Sheet so they get a description and a credit), and a title or "by ..." line at
the top of the Doc (those come from the Sheet).

## How it is safe

- The Sheet never writes to GitHub, so there is no token to leak or renew.
- The script's web address is public but read-only, and returns only rows marked Approved, which are about
  to be public anyway. Anyone who can edit the Sheet can publish, so share it only with editors and the adviser.
- GitHub treats what the Sheet sends as untrusted: only article, writer and photo files in their expected
  folders are accepted, archive articles are never overwritten, and the new content must pass the same checks
  as any other change before it is committed (`scripts/sync-docs.ts`, `.github/workflows/sync-docs.yml`).

## Changing the script later

Edit `Code.gs` here, paste it into Extensions > Apps Script, save, then **Deploy > New deployment** (Web app,
execute as Me, access Anyone) and put the new address in `endpoint.json`. The permissions it asks for are in
`appsscript.json`.

## Handing over

The Sheet belongs to a student account, which closes after graduation. Before then, move the Sheet to the
adviser's account or a school shared drive, have the new owner run **Deploy > New deployment**, and update
`endpoint.json` with the new address.

## The Google Site (the school's front door)

Published on 13 October 2026 from the school account: <https://sites.google.com/govsacademy.org/thegovernor>.
It is one page, a full-page embed of the newspaper, set as the homepage. A blank "Home" page is hidden from
its navigation and can be deleted.

- **Who can see it:** "Anyone at The Governor's Academy" (Google's default for the school). To open it to
  the public, use Publish > Publish settings > Manage, if the school allows public Sites.
- **A school address:** a Workspace administrator can map it to something like `governor.govsacademy.org`
  (Admin console > Apps > Google Workspace > Sites > Custom URL).
- **Limits:** new Google Sites cannot be filled by a script, so the articles live on the newspaper site and
  appear here through the embed. Inside the frame the address bar does not change from article to article;
  the "Copy link" button on each article gives the real address.
