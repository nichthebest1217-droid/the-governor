# The Governor: Web Editor's Handbook

For editors-in-chief, section editors and the web editor. No coding needed.

## The one rule

**Nothing goes on the public site until the editor-in-chief has approved it.** The website is built from a
public GitHub repository, so anything saved there can be read by anyone who looks, even with "Published"
switched off. Stories that are unfinished, sensitive, or not yet approved stay in the staff's shared Google
Docs until they are ready.

## From draft to published

1. **Writer** drafts in the school-approved shared doc.
2. **Section editor** edits and fact-checks: names spelled right, quotes confirmed, photo permission and
   photographer known.
3. **Editor-in-chief** approves the final text, headline, byline and photo credit.
4. **Web editor** enters the story in Pages CMS (below), on the `drafts` branch, with **Published** on.
5. **Web editor** opens a pull request from `drafts` to `main` on GitHub. The automatic checks run.
6. **A second person** (editor-in-chief or adviser) approves and merges. The site updates in about two
   minutes.

Step 6 is the safeguard: one person cannot publish alone.

## Adding an article in Pages CMS

1. Go to **app.pagescms.org**, sign in with GitHub, choose the newspaper's repository.
2. In the branch menu at the top, choose **drafts**. Check this every time.
3. **Articles > Add an entry**, then fill in:
   - **Headline.**
   - **Deck** (optional): one or two sentences under the headline. If empty, cards show the opening words.
   - **Publication date.** This becomes part of the web address. Do not change it after publishing.
   - **Section**, and **Type** (choose *Editorial* only for the editors' shared position).
   - **Writers.** Pick from the list. New writer? Add them under **Writers** first: name as printed, web ID
     `first-last`, class year.
   - **Cover photo**, **description (alt text)**, **caption**, **photo credit**. Alt text says what is in the
     picture for readers using a screen reader ("Seniors in white dresses toss confetti outside the chapel").
     A caption adds context. Every photo needs a credit unless the editor-in-chief says otherwise.
   - **Print issue**, only if the story ran in that printed issue.
   - **Article**: paste the text. Use the toolbar for bold, italics, quotes, lists, links and extra photos.
     Do not type the byline into the article; that is what the Writers field is for.
   - **Published**: on.
4. **Save.** Then open the pull request (step 5 above).

Fonts and sizes from Google Docs are ignored on purpose. The website applies one typographic style to
every article.

## Choosing the front page

**Homepage** in Pages CMS:

- **Lead story**: the big one. Empty = the newest article with a photo.
- **Top stories beside the lead**: up to five. Empty = the newest ones.
- **Editors' Picks**: up to four. Empty = the block disappears.
- **Print issue to promote**, and an optional **banner** across the top of every page.

> The Editors' Picks currently on the site were chosen as placeholders when the site was built. Replace them.

## Corrections

1. Fix the text in the article.
2. Fill in **Correction note** ("An earlier version misstated the score. It was 3-1.") and **Updated on**.
3. Publish through the normal pull request. The note appears at the top of the article and on the
   Corrections page. The earlier wording stays in the repository's history.

Do not delete an article because someone dislikes it. Talk to the adviser.

## Adding a print issue

1. Export the PDF as small as is still readable (aim under 30 MB; a file over 100 MB cannot be uploaded).
2. **Print issues > Add an entry**: title ("Fall Issue 1"), web ID (`2026-fall-issue-1`), season, year,
   number, the date **as printed on the front page**, the PDF, and page images in page order.
3. Fill in **How we know these facts** ("Front page reads FALL ISSUE 1 - OCTOBER 2026").
4. On each article that ran in it, set **Print issue**.

Leave **Volume** empty unless a volume number is printed on the issue.

## Photos and privacy

- Use only photos the staff took or has permission to use. Credit the photographer.
- Resize before upload if you can (2000 pixels wide is plenty). The site makes smaller copies itself.
- No screenshots of private messages, no home addresses or phone numbers, nothing from a draft the writer
  has not agreed to publish.
- A student who asks for their photo or name to be reviewed: tell the editor-in-chief and adviser the same day.

## The review list left by the migration

`migration/review-queue.csv` lists everything the move from WordPress could not settle by itself. Open it in
Google Sheets. In rough priority:

1. **One News post is unaccounted for.** WordPress counts 12 News posts; 11 are public. Ask whoever runs
   the old site to look for a draft, private or trashed News post.
2. **Photo credits (25) and alt text (27).** None existed on the old site. Add them article by article.
3. **Two byline spellings to confirm:** "Jayden Padila" was treated as Jayden Padilla; "Alexandra (Alex)
   Hughey" as Alex Hughey.
4. **Trent DiGiovanni's class year:** three bylines say ’27, one says ’25. The site shows ’27.
5. **Spring Issues 1, 2 and 4** are known only from their editorials. If anyone has the PDFs, add them.
6. **Seven photos** were uploaded to articles on the old site but never displayed. They are in the backup.

## Handing over to next year's board

Each spring the outgoing editor-in-chief and adviser:

- [ ] Add the incoming web editor and editor-in-chief to the GitHub organization with *Write* access; keep
      the adviser as *Owner*. Remove graduating students.
- [ ] Confirm `main` is still protected (pull request + one approval + checks).
- [ ] Walk the new web editor through publishing one real article start to finish.
- [ ] Update **Masthead** and the contact email under **Site details**.
- [ ] Download a copy of the repository (green **Code** button > Download ZIP) to the school's shared drive.

The repository should belong to a school-controlled GitHub organization, never a student's personal account.

## When something goes wrong

| Problem | What to do |
| --- | --- |
| My article is not on the site | Is **Published** on? Was the pull request merged? Check the **Actions** tab on GitHub for a red X and read the failed step. |
| The checks failed on my pull request | Click **Details**. The usual causes: a writer who has no entry under Writers, a missing photo, a link typed without `https://`. |
| I published something by mistake | Switch **Published** off and merge that change. Tell the editor-in-chief. It disappears in about two minutes, but treat it as having been public. |
| A photo looks wrong or huge | Re-upload a resized copy with a new file name and select it. |
| The site is down | Check githubstatus.com. If GitHub is fine, open the **Actions** tab and re-run the last deploy. |
| We lost something | Every version of every file is in the repository history. A developer or the adviser can restore it; see CONTRIBUTING.md. |
