# Publishing from Google Docs

Writers keep writing in Google Docs. An editor lists each finished article in one Google Sheet. Pressing
**The Governor > Publish approved rows** sends every row marked *Approved* to the website, which rebuilds
itself in about two minutes. No coding, no cost, and no Google Cloud project.

Status: the script's logic is tested outside Google (`tests/google-sheet.test.ts`). It has **not yet been run
inside a real Google account**; the first run below is that test.

## What goes where

| Thing | Lives in | Why |
| --- | --- | --- |
| Drafts and edits | Google Docs | Where the staff already works |
| Original photos, full size | Google Drive | No size limit to worry about; nothing is lost |
| The list of what is approved | The Google Sheet | The editor-in-chief's control panel |
| The website's pages and web-sized photos | GitHub | Free hosting; the design lives here |

Only a 2,000-pixel copy of each photo is sent to the website, and the site publishes even smaller WebP
versions. A typical story adds well under 1 MB, so the 1 GB hosting limit is decades of issues away.

## One-time setup (about 15 minutes)

Do this signed in to the Google account that should own the workflow. A school account is best, so the
school keeps it when students graduate.

1. **Create the Sheet.** New Google Sheet, name it "The Governor: Publication".
2. **Add the script.** Extensions > Apps Script. Delete what is there, paste in all of `Code.gs`, and save.
   In Project Settings, tick "Show appsscript.json", then replace that file's contents with
   `appsscript.json` from this folder.
3. **Make a GitHub token.** On github.com: Settings > Developer settings > Fine-grained tokens > Generate.
   Repository access: only the newspaper's repository. Permissions: **Contents: Read and write**. Set an
   expiry of one year and put a renewal reminder on the adviser's calendar. Copy the token.
4. **Give the script the token.** In Apps Script: Project Settings > Script Properties, add:
   - `GITHUB_TOKEN` = the token
   - `GITHUB_REPO` = `nichthebest1217-droid/the-governor` (change if the repository moves)
   - `GITHUB_BRANCH` = `main`
   - `SITE_URL` = the site's address, only if it has a custom domain
5. **Reload the Sheet.** A menu called **The Governor** appears. Choose **Set up this sheet** and approve the
   permission prompt (it asks to read Drive files and contact GitHub).

Anyone who can edit the Sheet can publish, so share it only with the editors and the adviser.

## Publishing an article

1. Add a row: Doc link, headline, section, writers (`Jane Doe '27, Sam Lee '28`), date, and type.
2. For a photo: paste the Drive link of the image, and fill in the description (what the picture shows),
   caption and credit.
3. If the article ran in print, add the issue ID (for example `2026-27-issue-2`) and its order in the issue.
4. The editor-in-chief sets **Status** to **Approved**.
5. **The Governor > Check approved rows** tells you what would happen without changing anything.
6. **The Governor > Publish approved rows**. The row turns to *Published* and shows the article's address.

To correct an article, fix the Doc, set the row back to *Approved*, and publish again.

What the script ignores on purpose: fonts, sizes, colours and spacing in the Doc, pictures pasted into the
Doc (add photos through the Sheet so they get a description and a credit), and a title or "by ..." line at
the top of the Doc (those come from the Sheet).

## A Google Site as the school's front door

New Google Sites has no way for a script to add pages (Google retired that with classic Sites), so articles
cannot flow from Docs into Google Sites pages automatically. What works:

1. In the school Google account, create a Google Site and add a page of type **Full page embed** with the
   newspaper's address.
2. Publish it. A Workspace administrator can then map it to a school address such as
   `governor.SCHOOLDOMAIN` (Admin console > Apps > Google Workspace > Sites > Custom URL).

Limits to know: inside the frame the address bar does not change from article to article, so people cannot
copy a link to one story from it (the "Copy link" button on each article still gives the real address).

## If the token expires or publishing fails

The **Result** column says why in plain words. The usual causes: the Doc is not shared with the account
running the script, the photo link is not an image, or the GitHub token has expired (make a new one and
replace `GITHUB_TOKEN`).
