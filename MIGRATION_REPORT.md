# Migration Report

Status as of 13 October 2026. Regenerate the numbers with `npm run import:wp && npm run build && npm run reconcile`.

## Verdict

**Every publicly readable article, byline, date, photograph and print issue on the WordPress site has been
migrated and verified. The archive cannot yet be called complete**, because WordPress itself reports one
more News post than the public can see (see Exceptions, item 1). That needs an administrator or a full export.

## Totals: source vs imported

| | Source | Imported | Match |
| --- | ---: | ---: | --- |
| Articles | 55 | 55 | Yes |
| News | 11 public (WordPress counter: 12) | 11 | **Open** |
| Opinion | 15 | 15 | Yes |
| Arts | 2 | 2 | Yes |
| Sports | 6 | 6 | Yes |
| Humor & Fun | 4 | 4 | Yes |
| People | 8 | 8 | Yes |
| School Culture | 9 | 9 | Yes |
| Articles by year | 2026: 55 | 2026: 55 | Yes |
| Headline identical | | 55 / 55 | Yes |
| Publication timestamp identical | | 55 / 55 | Yes |
| Web path identical to WordPress | | 55 / 55 | Yes |
| Byline parsed and credited | 55 with a byline line | 55 / 55 | Yes |
| Body text, word for word (Markdown vs source HTML) | | 55 / 55 | Yes |
| Body text, word for word (built page vs source HTML) | | 55 / 55 | Yes |
| Writers | 19 distinct after 2 inferred merges | 19 | See Exceptions 3 |
| Cover images | 25 | 25 | Yes |
| Inline images | 2 | 2 | Yes |
| Print issues with a PDF | 1 (4 identical uploads) | 1 | Yes |
| Print-issue page images | 8 | 8, re-ordered into page order | Yes |
| Media files backed up | 54 | 54 with checksums | Yes |
| Media files published | | 36 | 18 backup-only, each explained |
| Pages | 6 | 0 as content | 5 empty placeholders mapped to sections; 1 untouched WordPress sample page |
| Internal links between posts | 0 | 0 | n/a |
| External links in bodies | 0 | 0 | n/a |
| Unsupported embeds | 0 | 0 | n/a |
| Comments | 0 | 0 | n/a |
| Tags | 0 | 0 | n/a |
| Subscribers | 1 | not migrated (by design) | n/a |

Independent check: `scripts/spot-check.ts` fetched the **live public page** (not the API) for 13 articles
covering every section, both months, editorials, multi-author bylines, inline images, lists, and articles
with and without covers. Headline, date and full body text matched on all 13
(`migration/spot-check.json`).

## How each thing was handled

- **Text:** converted from WordPress HTML to Markdown; nothing reworded. Non-breaking spaces at paragraph
  ends became ordinary spaces. Quotation marks, dashes and the writers' own punctuation are untouched, and
  the site's Markdown engine has automatic "smart" punctuation switched off.
- **Bylines:** the opening "by ..." paragraph was moved out of the body into structured author data. The line
  exactly as printed is kept in each article's `originalByline`. A paragraph is treated as a byline only if
  the whole paragraph is one; ordinary sentences beginning with "By" are never touched (unit-tested).
- **Editorials:** the four pieces labelled "Editorial" keep the Opinion section, gain `kind: editorial`, credit
  every signer, and link to their issue.
- **Dates:** WordPress's local time with its UTC offset, e.g. `2026-05-14T15:03:57-04:00`. WordPress's
  "modified" time is stored as `sourceModifiedAt` but not shown as an "Updated" date, since it records
  re-saves, not corrections.
- **Images:** copied byte-for-byte to `public/media/YYYY/MM/wp-<id>.<ext>` (several originals had non-Latin
  screenshot filenames). Responsive WebP sizes are generated at build; originals are unmodified.
  Full-resolution originals of all 54 files are in `migration/raw/media` (183 MB, not in git).
- **Print issue:** Spring Issue 3 has its PDF, 8 page images in true page order, and links to the 14 web
  articles that its front page lists. Issues 1, 2 and 4 exist as records with their one editorial each and a
  "no scan in the archive yet" notice. No volume numbers are recorded because none are printed.
- **URLs:** `migration/url-map.csv` has all 124 source URLs (55 posts, homepage, 6 pages, 8 categories, 54
  attachments) with a new target or a stated reason. `/category/<section>/` and `/news-2/` redirect.
- **Excerpts:** not imported (auto-generated on WordPress). Cards show the article's own opening words.
- **Source HTML:** every post's untouched HTML is in `migration/source-html/<id>.html` for auditing.

## Exceptions register

Full list: `migration/review-queue.csv` (82 rows). Summary:

| # | Severity | Item | Count | Action |
| --- | --- | --- | ---: | --- |
| 1 | **Error** | WordPress counts 12 News posts; 11 are public | 1 | Admin checks for a draft/private/trashed News post, or supplies the full export |
| 2 | Review | Images with no alt text on the source | 27 | Editors write alt text in the CMS |
| 2 | Review | Cover images with no photographer credit on the source | 25 | Editors add credits or confirm none needed |
| 3 | Review | Byline spellings merged by inference: "Jayden Padila" as Jayden Padilla; "Alexandra (Alex) Hughey" as Alex Hughey | 2 | Confirm, or delete the alias in `migration/curation/author-aliases.json` and re-import |
| 4 | Review | Trent DiGiovanni: bylines say ’27 three times and ’25 once; site shows ’27 | 1 | Confirm |
| 5 | Review | Spring Issues 1, 2, 4 have no PDF or scans | 3 | Upload if found |
| 6 | Review | Images uploaded to a post but never displayed on WordPress | 7 | In backup only; add to the article if they were meant to appear |
| 7 | Info | Bylines with no class year (Alex Hughey, Henry Loughman, Andrew Melly once each; year known from their other bylines) | 3 | None |
| 8 | Info | "Spring Issue #3 Editorial" gives no year; 2026 taken from the post date and the issue's front page | 1 | None |
| 9 | Info | Capitalisation variant "Trent Digiovanni" | 1 | None |
| 10 | Info | Duplicate PDF uploads published once | 3 | None |
| 11 | Info | School crest and old logo files not reused | 7 | Identity approval |
| 12 | Info | WordPress sample page not migrated | 1 | None |

One judgment to be aware of: on the page for "Remembering Fafa" the byline now reads "Jayden Padilla ’26",
where WordPress printed "Jayden Padila ‘26". That is exception 3; the printed form is preserved in the file.

Content only in print: Spring Issue 3's page 8 ("Memes", "Crosswords") and a photo feature credited to Alex
Wang ’27 exist only inside the PDF and page images, not as web articles.

## Not done / cannot be done from here

- No WordPress export (WXR) or admin access was available, so drafts, private posts, trashed posts and
  revision history are unknown.
- Nothing on WordPress was changed, redirected or deleted. Keep it running until launch is approved.

## Addendum, 13 October 2026: print edition 26-27 Issue I

Not part of the WordPress migration. Nicholas Zhuo supplied the PDF of **26-27 Issue I (October 9, 2026)**.

- The PDF (6 pages, 4.7 MB) and page images are published at `/issues/2026-27-issue-1/`.
- Its **14 articles were transcribed into web articles** from the PDF's text layer, reading each column in
  order by position, with headlines and bylines taken from the pages. Check: of the 5,886 body-size words
  in the PDF, all are in the articles except the two photo/comic captions; the only difference is one word
  the print hyphenates across columns ("view-" / "-ed", joined as "viewed").
- Two italics visible in print were restored by hand (*Beverly Hills Ninja.*, *Governor*). Any other italics
  would have been lost; none were seen on the pages.
- Six photographs were cropped from the PDF pages. They are modest in resolution (about 600 to 800 pixels
  wide); replace them with the original files when convenient. Captions are the printed ones. Alt text was
  written during transcription and should be checked. No photo credits are printed, so none are shown.
- **Section labels were assigned during transcription** because the print edition has none: Sports (weight
  room, football, Brooks rivalry), Opinion (cellphones, three-activity rule, nametags), News (absences, door
  locks), People (Mr. Adams, teachers' summers), Arts (staff art show), School Culture (Dummer Cup, animals,
  From the Editors). Editors should correct any that are wrong.
- The byline "MAROFA ’28" is a single name in print and is shown as "Marofa ’28".
- "Porter Lalime" is spelled "LaLime" once inside another article; the body text is left as printed.
- All 14 are marked `migrationNeedsReview: true` until an editor has proofread them against the PDF.
- The masthead page now lists the Editors, Writers and Advisor from the issue's Contributors box.
- Print-only items (word search, Mad Lib, the comic "Dumber & G-Dawg" by Lana Hardin ’27, memes) are not
  web articles.
