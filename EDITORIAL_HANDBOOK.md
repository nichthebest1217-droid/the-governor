# The Governor: Web Editor's Handbook

For editors-in-chief, section editors and the web editor. No coding needed. Everything happens in Google:
articles in Google Docs, one Google Sheet ("The Governor: Publication") whose **How to publish** tab has the
short version of this page, and the website itself, which the school's Google account runs and the Google Site
shows (<https://sites.google.com/govsacademy.org/thegovernor>). How the pieces fit together:
[google-workspace/SETUP.md](google-workspace/SETUP.md).

## The one rule

**Nothing is marked Published until the editor-in-chief has approved it.** Marking a row Published puts the
article on the public website within about a minute; treat anything published as public for good, even after it
is taken down. Unfinished, sensitive or unapproved stories
stay Draft or Ready for Review: those never leave Google.

## From draft to published

| Status | Who | What it means |
| --- | --- | --- |
| **Draft** | Writer, section editor | Being written or edited. Not public. |
| **Ready for Review** | Section editor | Edited and fact-checked: names spelled right, quotes confirmed, photo permission and photographer known. Waiting for the editor-in-chief. Not public. |
| **Published** | Editor-in-chief | Approved: text, headline, byline, photo and credit. On the website about a minute later. |

Anyone who can edit the Sheet can choose Published, so share the Sheet only with editors and the adviser.
Writers need only their Doc.

## Publishing an article

1. **Write in Google Docs.** Bold, italics, links, headings, lists, tables and pictures carry over; fonts,
   sizes and colours do not (the website uses its own). For a caption, type it in italics on the line right
   under the picture. Give each picture a description for readers who cannot see it: right-click > Alt text.
2. **Share the Doc** with `nicholas.zhuo@govsacademy.org` (Viewer is enough), or keep it in a shared folder
   that account can open.
3. **Add a row** in the Articles tab:
   - **Title**: the headline, as it should appear.
   - **Author(s)**: names as printed, with class years, separated by commas: `Jane Doe '27, Sam Lee '28`.
     A new name gets a writer page automatically.
   - **Category**: the section of the website.
   - **Google Doc link**: the Doc's address. (No Doc? Paste the text into **Article text (if no Doc)**; every
     line becomes a paragraph.)
   - **Description** (optional): one or two sentences under the headline and on the front page. Empty = the
     opening words.
   - **Image link** (optional): the photo for the top of the article, as a Google Drive link, with its
     **Image description** (what is in the picture, for screen readers: "Seniors in white dresses toss confetti
     outside the chapel"), **caption** and **credit**. Every photo needs a credit unless the editor-in-chief
     says otherwise. Empty = a picture at the very top of the Doc is used.
   - **Publication date** (optional): empty = the day it is published. A future date schedules it.
   - **Type**: *Editorial* only for the editors' shared position. **Print issue** and **Order in issue** only
     if it ran in print.
4. **Set the Status** as above. When it says Published, watch **On the website**: Publishing…, then
   **✓ Live** with the link. Anything missing appears there in plain words, starting with ⚠.

Do not type in **On the website** or **ID**: the Sheet fills them in, and the ID keeps the article's web
address the same.

## Fixing, updating and taking down

- **Fix a typo or update a story:** edit the Google Doc, or the row. The website follows within a minute or two.
  (Writers who can still edit the Doc can change the live article too; make the Doc view-only for them once it
  is published if that matters.)
- **Take a story down:** set its Status to Draft or Ready for Review. Publishing it again later keeps the same
  web address. Tell the editor-in-chief, and treat it as having been public.
- **Corrections:** fix the text, then fill in **Correction** ("An earlier version misstated the score. It was
  3-1."). The note appears at the top of the article and on the Corrections page.

Do not take an article down because someone dislikes it. Talk to the adviser.

## Choosing the front page

The Sheet's **Homepage** tab. Paste an article's web address (from **On the website**, or the **All articles**
tab, which lists everything on the site) into the Value column:

- **Lead story**: the big one. Empty = the newest article with a wide photo.
- **Top story 2–5**: beside the lead. Empty = the newest ones.
- **Editors' pick 1–4**: Empty = the block disappears.
- **Print issue to promote**, and an optional **Banner text** and **Banner link** across the top of every page.

> The Editors' Picks currently on the site were chosen as placeholders when the site was built. Replace them.

The **Masthead** tab (one person per row: group, name, optional role) and the **Site** tab (contact emails,
masthead school year) work the same way and update the site within a minute.

## Adding a print issue (web editor)

Print issues are part of the archive the publisher copied into Drive. Adding one is a job for the web editor:
put the PDF and page images in the repository's `public/issues/`, describe the issue in `src/content/issues/`,
rebuild the archive bundle (`node scripts/build-archive.ts`) and run `importArchive` again with the new commit
(see [google-workspace/SETUP.md](google-workspace/SETUP.md)). Then put the issue's ID in **Print issue** on each
Sheet article that ran in it, and in the Homepage tab's **Print issue to promote**.

## Photos and privacy

- Use only photos the staff took or has permission to use. Credit the photographer.
- Keep originals in Drive. The website saves its own copy at most 2,000 pixels wide and removes camera data
  such as GPS location.
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

- [ ] Share the Sheet with the incoming editors; remove graduating students.
- [ ] If the account that owns the Sheet is graduating, follow "Handing over" in
      [google-workspace/SETUP.md](google-workspace/SETUP.md): the Sheet and the Google Site go to a school account,
      which copies the publisher, deploys it and points the Google Site at it.
- [ ] Give the incoming web editor the code repository (ideally owned by a school-controlled organization, never a
      student's personal account).
- [ ] Walk the new editors through publishing one real article start to finish.
- [ ] Update the **Masthead** and **Site** tabs.
- [ ] Download a copy of the repository (green **Code** button > Download ZIP) to the school's shared drive.

## When something goes wrong

| Problem | What to do |
| --- | --- |
| **On the website** shows ⚠ | Do what it says: the row or the Doc is missing something. If the article was already live, the earlier version stays up meanwhile. |
| It says Publishing… for more than a few minutes | The top of the **How to publish** tab should say "Publishing is ON". If it does not, the publisher's minute-by-minute check has stopped: the Sheet's owner opens the publisher and runs `setUpPublisher` ([SETUP.md](google-workspace/SETUP.md)). Its Executions page shows any error. |
| "The Sheet can't open this Doc" | Share the Doc with `nicholas.zhuo@govsacademy.org`. |
| A picture is missing | Pictures inside the Doc must be ordinary inline pictures (not drawings "in front of text"). The cover picture must be a Drive link the owner account can open, with an Image description. |
| I published something by mistake | Set the Status back to Draft. It disappears within a minute, but treat it as having been public. Tell the editor-in-chief. |
| The Sheet looks broken (columns moved, dropdowns gone) | **The Governor > Set up or repair this Sheet**. It keeps what was typed. |
| Many articles vanished from the Sheet but are still online | On purpose: when several rows disappear at once, nothing is taken down. Put the rows back; to take articles down, set them to Draft. |
| The site is down | Check the Google Workspace status page (google.com/appsstatus). If Google is fine, the publisher's Executions page shows what failed. |
| We lost something | Docs keep their version history (File > Version history). Pictures of taken-down articles stay in the Drive trash for 30 days. The archive's original files are in the code repository. |
