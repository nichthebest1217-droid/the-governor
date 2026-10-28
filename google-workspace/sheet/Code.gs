/**
 * The Governor: the publication Sheet's own script (in the Sheet: Extensions > Apps Script).
 *
 * It runs as whoever is using the Sheet and can only touch this spreadsheet. It adds The Governor
 * menu, sets up the tabs, and fills in "On the website" the moment a row is edited. It cannot read
 * Drive, reach GitHub or publish anything.
 *
 * Publishing is done by a separate script, "The Governor publisher"
 * (google-workspace/publisher/ in the website's repository), which runs the website itself and
 * which only the Sheet's owner can open or change. Anyone who can edit this Sheet can edit this
 * script, so nothing in it runs with the owner's access. Setup: google-workspace/SETUP.md.
 */

// ===== Shared with publisher/Code.gs: keep this block identical in both files (a test checks). =====
const ARTICLES = 'Articles';
const GUIDE = 'How to publish';
const ALL = 'All articles';
const AUTO = 'Filled in automatically by the Sheet';
const GUIDE_STATUS_ROW = 3;
const INSTANT_ON = 'Publishing is ON';
const OWNER_EMAIL = 'nicholas.zhuo@govsacademy.org'; // the account that owns the Sheet; Docs are shared with it
const STATUSES = ['Draft', 'Ready for Review', 'Published'];
const CATEGORIES = { 'News': 'news', 'Opinion': 'opinion', 'Arts': 'arts', 'Sports': 'sports', 'Humor & Fun': 'humor-fun', 'People': 'people', 'School Culture': 'school-culture' };
// [header, width, note shown when hovering over the header]
const COLUMNS = [
  ['Status', 120, 'Draft while it is being written, Ready for Review when an editor should read it, Published to put it on the website. Only Published articles are public.'],
  ['On the website', 280, 'Filled in by the Sheet: whether the article is live (with its link), on its way, or what is missing. Do not type here.'],
  ['Title', 280, 'The headline, as it should appear on the website.'],
  ['Author(s)', 210, "Names with class years, separated by commas: Jane Doe '27, Sam Lee '28"],
  ['Category', 130, 'The section of the website the article appears in.'],
  ['Publication date', 125, 'Leave empty to use the day it is published. A future date schedules the article: it goes live that day.'],
  ['Google Doc link', 230, 'The link to the article\'s Google Doc. Share the Doc with OWNER (Viewer is enough). Bold, italics, links, headings, lists and pictures carry over.'],
  ['Description', 260, 'Optional. One or two sentences shown under the headline and on the front page. Empty: the article\'s opening words are used.'],
  ['Image link', 210, 'Optional. The picture at the top of the article: a Google Drive link to the photo (or a web address). Empty: a picture at the very top of the Doc is used.'],
  ['Image description', 220, 'What the picture shows, for readers who cannot see it. Needed when there is an Image link.'],
  ['Image caption', 200, 'Optional.'],
  ['Image credit', 150, 'Optional, e.g. Photo by Jane Doe \'27.'],
  ['Type', 105, 'Article, or Editorial for the editors\' shared opinion.'],
  ['Print issue', 140, 'Optional. If the article ran in print, the issue\'s ID, e.g. 2026-27-issue-1.'],
  ['Order in issue', 95, 'Optional. Its position in the print issue: 1, 2, 3 …'],
  ['Correction', 200, 'Optional. A correction note, shown at the top of the article and on the Corrections page.'],
  ['Article text (if no Doc)', 240, 'Only when there is no Google Doc: paste the article here. Every line becomes a paragraph.'],
  ['ID', 250, 'Filled in by the Sheet when the article is first published. Do not change it: it keeps the article\'s web address.'],
];
const HEADERS = COLUMNS.map(function (c) { return c[0]; });

// The Issues tab: one row per print issue, made when its PDF is dropped into the print-issues folder.
const ISSUES = 'Issues';
const ISSUE_STATUSES = ['Ready for Review', 'Published'];
const PRINT_FOLDER = 'The Governor: print issues';
const ISSUE_COLUMNS = [
  ['Status', 130, 'Ready for Review while the editors check the articles made from the PDF. Published puts the issue on the website and publishes its articles that are still Ready for Review.'],
  ['On the website', 280, 'Filled in by the Sheet. Do not type here.'],
  ['Issue', 190, 'The issue as the website names it.'],
  ['ID', 150, 'Read from the PDF, for example 2026-27-issue-2. The issue\'s articles carry it in their Print issue column.'],
  ['Date', 120, 'The date printed on the issue.'],
  ['PDF', 230, 'The PDF dropped into the print-issues folder. To correct it, replace that file in Drive (File > Manage versions) or drop the new PDF.'],
  ['Articles folder', 230, 'The Google Docs made from the PDF, one per article. Fix any mistake in the Doc.'],
  ['Notes', 380, 'What could not be made into an article (puzzles, memes, a box without a writer). It stays in the PDF on the website.'],
];
const ISSUE_HEADERS = ISSUE_COLUMNS.map(function (c) { return c[0]; });

/** The Issues tab, made when first needed. */
function issueTab_(ss) {
  let tab = ss.getSheetByName(ISSUES);
  if (tab) return tab;
  tab = ss.insertSheet(ISSUES);
  tab.getRange(1, 1, 1, ISSUE_HEADERS.length).setValues([ISSUE_HEADERS]).setFontWeight('bold').setBackground('#141312').setFontColor('#ffffff');
  ISSUE_COLUMNS.forEach(function (c, i) { tab.setColumnWidth(i + 1, c[1]); tab.getRange(1, i + 1).setNote(c[2]); });
  tab.setFrozenRows(1);
  tab.getRange(2, 1, 300, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ISSUE_STATUSES, true).setAllowInvalid(false).build());
  return tab;
}

function ownerEmail_() {
  return PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || OWNER_EMAIL;
}

/** Links in the Doc and Image columns, including links behind a pasted chip or a renamed link. */
function linkColumns_(sheet, headers, first, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({});
  ['Google Doc link', 'Image link'].forEach(function (name) {
    const c = headers.indexOf(name);
    if (c < 0 || count < 1) return;
    const rich = sheet.getRange(first, c + 1, count, 1).getRichTextValues();
    for (let i = 0; i < count; i++) out[i][name] = linkIn_(rich[i][0]);
  });
  return out;
}

function linkIn_(rich) {
  if (!rich) return '';
  const direct = rich.getLinkUrl();
  if (direct) return direct;
  const runs = rich.getRuns();
  for (let i = 0; i < runs.length; i++) if (runs[i].getLinkUrl()) return runs[i].getLinkUrl();
  return '';
}

/** One row of the Articles tab as an object. */
function rowFrom_(v, headers, links, rowNumber) {
  const raw = function (name) { const i = headers.indexOf(name); return i < 0 || v[i] == null ? '' : v[i]; };
  const text = function (name) { return String(raw(name)).trim(); };
  const docLink = (links && links['Google Doc link']) || text('Google Doc link');
  const date = dateOf_(raw('Publication date'));
  const r = {
    row: rowNumber,
    status: text('Status'),
    website: text('On the website'),
    title: text('Title').replace(/\s+/g, ' '),
    authors: text('Author(s)'),
    category: text('Category'),
    date: date.value,
    dateInvalid: date.invalid,
    docLink: docLink,
    docId: /docs\.google\.com|drive\.google\.com|^[A-Za-z0-9_-]{25,}$/.test(docLink) ? idFromLink_(docLink) : '',
    description: text('Description').replace(/\s+/g, ' '),
    imageLink: (links && links['Image link']) || text('Image link'),
    imageAlt: text('Image description'),
    imageCaption: text('Image caption'),
    imageCredit: text('Image credit'),
    type: text('Type') || 'Article',
    issue: text('Print issue'),
    order: text('Order in issue'),
    correction: text('Correction'),
    text: String(raw('Article text (if no Doc)')).replace(/\r\n?/g, '\n').trim(),
    id: text('ID'),
  };
  r.blank = !r.status && !r.title && !r.docLink && !r.text;
  return r;
}

/** A date cell, or text such as 2026-10-16 or 10/16/2026, as "2026-10-16". */
function dateOf_(value) {
  if (value === '' || value == null) return { value: '', invalid: false };
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return { value: Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd'), invalid: false };
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { value: s, invalid: false };
  const d = new Date(s);
  if (/\d/.test(s) && !isNaN(d)) return { value: Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'), invalid: false };
  return { value: '', invalid: true };
}

/** What is missing from a Published row, in plain words. Needs no access to Drive. */
function basicProblems_(r) {
  const p = [];
  if (!r.title) p.push('Add a Title.');
  else if (r.title.length > 200) p.push('The Title is longer than 200 characters.');
  if (!CATEGORIES[r.category]) p.push('Choose a Category.');
  if (!r.authors) p.push("Add the author(s), for example Jane Doe '27.");
  if (r.dateInvalid) p.push('The Publication date is not a date (for example 10/16/2026).');
  if (!r.docId && !r.text) p.push(r.docLink ? 'The Google Doc link is not a link to a Google Doc.' : 'Add the Google Doc link (or paste the article into "Article text").');
  if (r.imageLink) {
    if (/docs\.google\.com\/(document|spreadsheets|presentation)\//.test(r.imageLink)) p.push('The Image link points to a Google Doc, not to a picture.');
    else if (!driveId_(r.imageLink) && !/^https:\/\/\S+$/.test(r.imageLink)) p.push('The Image link must be a Google Drive link or a web address that starts with https://.');
    if (!r.imageAlt) p.push("Add an Image description: what the picture shows, for readers who can't see it.");
  }
  if (r.description.length > 400) p.push('The Description is longer than 400 characters.');
  if (r.issue && !/^[a-z0-9-]+$/.test(r.issue)) p.push('The Print issue should look like 2026-27-issue-1.');
  if (r.type !== 'Article' && r.type !== 'Editorial') p.push('Choose Article or Editorial as the Type.');
  return p;
}

/** The day a Published row goes (or went) live: its date, or the day it was first published. */
function goLiveDate_(r, today) {
  return r.date || (r.id ? r.id.slice(0, 10) : today);
}

function offNote_(status) {
  if (status === 'Ready for Review') return 'Not on the website (waiting for review)';
  if (status === 'Draft') return 'Not on the website (draft)';
  return 'Not on the website';
}

function waitNote_(instant) {
  return instant ? ' (usually live within a minute)' : ' (the publisher is not running: tell the web editor)';
}

function idFromLink_(link) {
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(link) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(link) || /^([A-Za-z0-9_-]{25,})$/.exec(link);
  return m ? m[1] : '';
}

/** The file ID of a Google Drive link (or of a bare file ID), or '' for any other address. */
function driveId_(link) {
  return /^https:\/\/(drive|docs)\.google\.com\//.test(link) || /^[A-Za-z0-9_-]{25,}$/.test(link) ? idFromLink_(link) : '';
}

function slugify_(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

function longDate_(day) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[Number(day.slice(5, 7)) - 1] + ' ' + Number(day.slice(8, 10)) + ', ' + day.slice(0, 4);
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
// ===== End of shared block =====

function onOpen() {
  SpreadsheetApp.getUi().createMenu('The Governor')
    .addItem('Set up or repair this Sheet', 'setUpSheet')
    .addItem('How to publish', 'showGuide')
    .addToUi();
}

function showGuide() {
  const tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GUIDE);
  if (tab) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(tab);
}

/** As soon as a row is edited, say what will happen. The publisher's minute-by-minute check does it. */
function onEdit(e) {
  try {
    const range = e && e.range;
    if (!range || range.getLastRow() < 2) return;
    const sheet = range.getSheet();
    if (sheet.getName() === ISSUES) { issueNote_(sheet, range); return; }
    if (sheet.getName() !== ARTICLES) return;
    const width = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    const webCol = headers.indexOf('On the website') + 1;
    if (!webCol || headers.indexOf('Status') < 0) return;
    if (range.getColumn() === webCol && range.getNumColumns() === 1) return;
    const first = Math.max(2, range.getRow());
    const count = range.getLastRow() - first + 1;
    if (count > 200) return; // a big paste: the publisher catches up within a minute
    const values = sheet.getRange(first, 1, count, width).getValues();
    const links = linkColumns_(sheet, headers, first, count);
    const cells = sheet.getRange(first, webCol, count, 1);
    const current = cells.getValues();
    const guide = sheet.getParent().getSheetByName(GUIDE);
    const instant = !!guide && String(guide.getRange(GUIDE_STATUS_ROW, 1).getValue()).indexOf(INSTANT_ON) === 0;
    const today = today_();
    let changed = false;
    const next = values.map(function (v, i) {
      const note = quickNote_(rowFrom_(v, headers, links[i], i + first), String(current[i][0]), instant, today);
      if (note !== current[i][0]) changed = true;
      return [note];
    });
    if (changed) cells.setValues(next);
  } catch (err) {
    // Feedback only; the publisher corrects anything missed.
  }
}

/** An issue's Status was changed: say so at once (the publisher confirms within a minute). */
function issueNote_(sheet, range) {
  const headers = sheet.getRange(1, 1, 1, ISSUE_HEADERS.length).getValues()[0].map(function (h) { return String(h).trim(); });
  const status = headers.indexOf('Status') + 1;
  const web = headers.indexOf('On the website') + 1;
  if (!status || !web || range.getColumn() > status || range.getColumn() + range.getNumColumns() - 1 < status) return;
  for (let r = Math.max(2, range.getRow()); r <= range.getLastRow(); r++) {
    const value = String(sheet.getRange(r, status).getValue()).trim();
    const current = String(sheet.getRange(r, web).getValue());
    const note = value === 'Published' ? (current.indexOf('✓ Live') === 0 ? current : 'Publishing the issue and its articles… (about a minute)') : current.indexOf('✓ Live') === 0 ? 'Taking the issue off the website…' : 'Not on the website (waiting for review)';
    if (note !== current) sheet.getRange(r, web).setValue(note);
  }
}

function quickNote_(r, current, instant, today) {
  if (r.blank) return '';
  const wasOnSite = /^(✓|Updating|Taking it off|⚠ The website still shows)/.test(current);
  if (r.status !== 'Published') return wasOnSite ? 'Taking it off the website…' : offNote_(r.status);
  const problem = basicProblems_(r)[0];
  if (problem) return (wasOnSite ? '⚠ The website still shows the earlier version: ' : '⚠ ') + problem;
  const day = goLiveDate_(r, today);
  if (day > today) return 'Scheduled for ' + longDate_(day) + (wasOnSite ? ' (off the website until then)' : '');
  return (wasOnSite ? 'Updating…' : 'Publishing…') + waitNote_(instant);
}

// ---------------------------------------------------------------------------------------------
// Setting up the Sheet

// Columns and statuses of the first version of this Sheet, upgraded by "Set up or repair this Sheet".
const RENAMED = { 'Headline': 'Title', 'Writers': 'Author(s)', 'Section': 'Category', 'Cover photo link': 'Image link', 'Photo description': 'Image description', 'Caption': 'Image caption', 'Photo credit': 'Image credit', 'Print issue ID': 'Print issue', 'Result': 'On the website' };
const OLD_STATUS = { 'Approved': 'Published', 'In edit': 'Ready for Review', 'Hold': 'Draft' };
const DROPPED = ['Web address'];

/** Builds or repairs every tab. Safe to run again: it never deletes what editors typed. */
function setUpSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ARTICLES);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    if (['Homepage', 'Site', 'Masthead', GUIDE, ALL].indexOf(sheet.getName()) >= 0) sheet = ss.insertSheet(ARTICLES, 0);
    else sheet.setName(ARTICLES);
  }
  upgradeColumns_(ss, sheet);
  formatArticles_(sheet);
  issueTab_(ss);
  keyValueTab_(ss, 'Homepage', HOME_ROWS);
  keyValueTab_(ss, 'Site', SITE_ROWS);
  if (!ss.getSheetByName('Masthead')) {
    const m = ss.insertSheet('Masthead');
    m.getRange(1, 1, 1, 3).setValues([['Group', 'Name', 'Role (optional)']]).setFontWeight('bold');
    m.setFrozenRows(1);
  }
  writeGuide_(ss);
  ss.setActiveSheet(sheet);
  ss.toast('The Sheet is set up.', 'The Governor', 8);
}

/** Puts the columns in the order above, keeping every value typed so far (and any extra columns). */
function upgradeColumns_(ss, sheet) {
  const values = sheet.getDataRange().getValues();
  const old = values[0].map(function (h) { const name = String(h).trim(); return RENAMED[name] || name; });
  if (HEADERS.every(function (h, i) { return old[i] === h; })) return;
  const data = values.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); });
  if (data.length) sheet.copyTo(ss).setName('Articles before upgrade ' + today_());
  const extras = old.filter(function (h) { return h && HEADERS.indexOf(h) < 0 && DROPPED.indexOf(h) < 0; });
  const header = HEADERS.concat(extras);
  const rows = data.map(function (r) {
    const rec = {};
    old.forEach(function (h, i) { if (h) rec[h] = r[i]; });
    if (OLD_STATUS[rec.Status]) rec.Status = OLD_STATUS[rec.Status];
    rec['On the website'] = '';
    return header.map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
  });
  sheet.clearConditionalFormatRules();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations().clearContent().clearNote();
  if (sheet.getMaxColumns() < header.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), header.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}

function formatArticles_(sheet) {
  if (sheet.getMaxRows() < 500) sheet.insertRowsAfter(sheet.getMaxRows(), 500 - sheet.getMaxRows());
  const n = sheet.getMaxRows() - 1;
  const at = function (name) { return HEADERS.indexOf(name) + 1; };
  const list = function (values, help) { return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).setHelpText(help).build(); };
  const head = sheet.getRange(1, 1, 1, HEADERS.length);
  head.setValues([HEADERS]).setFontWeight('bold').setBackground('#141312').setFontColor('#ffffff').setVerticalAlignment('middle').setWrap(true);
  [at('On the website'), at('ID')].forEach(function (c) { sheet.getRange(1, c).setBackground('#5f5a53'); });
  sheet.setRowHeight(1, 40);
  COLUMNS.forEach(function (c, i) {
    sheet.setColumnWidth(i + 1, c[1]);
    sheet.getRange(1, i + 1).setNote(c[2].replace('OWNER', ownerEmail_()));
  });
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  const body = sheet.getRange(2, 1, n, HEADERS.length);
  body.clearDataValidations().setVerticalAlignment('top').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(2, at('Status'), n, 1).setDataValidation(list(STATUSES, 'Draft, Ready for Review or Published.'));
  sheet.getRange(2, at('Category'), n, 1).setDataValidation(list(Object.keys(CATEGORIES), 'The section of the website.'));
  sheet.getRange(2, at('Type'), n, 1).setDataValidation(list(['Article', 'Editorial'], 'Article or Editorial.'));
  sheet.getRange(2, at('Publication date'), n, 1).setNumberFormat('mmm d, yyyy')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('A date, for example 10/16/2026. Leave empty for the day it is published.').build());
  sheet.getRange(2, at('Order in issue'), n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).setHelpText('A number: 1, 2, 3 …').build());
  sheet.getRange(2, at('On the website'), n, 1).setFontColor('#5f5a53');
  sheet.getRange(2, at('ID'), n, 1).setFontColor('#8a847b');
  const status = sheet.getRange(2, at('Status'), n, 1);
  const web = sheet.getRange(2, at('On the website'), n, 1);
  const rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  sheet.setConditionalFormatRules([
    rule().whenTextEqualTo('Published').setBackground('#d9efdc').setFontColor('#1e5e2b').setRanges([status]).build(),
    rule().whenTextEqualTo('Ready for Review').setBackground('#fdefc8').setFontColor('#7a4f00').setRanges([status]).build(),
    rule().whenTextEqualTo('Draft').setBackground('#eeeeee').setFontColor('#555555').setRanges([status]).build(),
    rule().whenTextStartsWith('✓').setFontColor('#1e7b34').setBold(true).setRanges([web]).build(),
    rule().whenTextStartsWith('⚠').setFontColor('#a50e0e').setBold(true).setRanges([web]).build(),
  ]);
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (p.getDescription() === AUTO) p.remove(); });
  [at('On the website'), at('ID')].forEach(function (c) { sheet.getRange(1, c, sheet.getMaxRows(), 1).protect().setDescription(AUTO).setWarningOnly(true); });
}

function writeGuide_(ss) {
  const tab = ss.getSheetByName(GUIDE) || ss.insertSheet(GUIDE, 1);
  const status = String(tab.getRange(GUIDE_STATUS_ROW, 1).getValue() || 'Waiting for the publisher to check in…');
  const owner = ownerEmail_();
  const lines = [
    ['h1', "How to publish on The Governor's website"],
    ['p', ''],
    ['status', status],
    ['p', ''],
    ['h2', '1. Write the article in Google Docs'],
    ['p', "Bold, italics, links, headings, lists and pictures carry over to the website. Fonts, sizes and colours don't: the website uses its own. To caption a picture, type the caption in italics on the line right under it. Give every picture a description for readers who can't see it: right-click the picture > Alt text."],
    ['h2', '2. Share the Doc with ' + owner],
    ['p', 'Viewer access is enough. (Or keep the Doc in a shared folder that account can open.)'],
    ['h2', '3. Add a row in the Articles tab'],
    ['p', "Fill in the Title, the Author(s) (Jane Doe '27, Sam Lee '28), the Category and the Google Doc link. Optional: a Description (shown under the headline and on the front page), an Image link for the picture at the top (a Google Drive link) with its description, caption and credit, and a Publication date (empty means the day it is published)."],
    ['h2', '4. Set the Status'],
    ['p', 'Draft while it is being written. Ready for Review when an editor should read it. Published to put it on the website. Only Published articles are public: drafts never leave Google.'],
    ['h2', '5. Watch "On the website"'],
    ['p', 'It says Publishing…, then ✓ Live with the link. Anything missing appears there in plain words, starting with ⚠.'],
    ['p', ''],
    ['h2', 'A whole print issue at once'],
    ['p', 'Drop the issue\'s PDF into the Google Drive folder "' + PRINT_FOLDER + '". Within a few minutes every article in it is in the Articles tab as Ready for Review, each with its own Google Doc (text, photos and captions from the PDF), and the issue has a row in the Issues tab. Check the articles and fix anything in their Docs; then set the issue\'s Status to Published in the Issues tab: the issue goes on the website with its PDF, and so does every article of it still Ready for Review. Puzzles, memes and boxes without a writer are listed in the issue\'s Notes; they stay in the PDF. For sharp photos, download the PDF from Canva as PDF Print.'],
    ['p', ''],
    ['h2', 'Good to know'],
    ['p', '• To fix a published article, edit its Google Doc or its row. The website updates by itself.'],
    ['p', '• To take an article down, change its Status to Draft or Ready for Review.'],
    ['p', '• To schedule an article, give it a future Publication date and mark it Published. It goes live that day.'],
    ['p', '• No Google Doc? Paste the article into "Article text (if no Doc)". Every line becomes a paragraph.'],
    ['p', '• Do not type in the "On the website" and "ID" columns: the Sheet fills them in. The ID keeps the article\'s web address the same.'],
    ['p', '• The front page, the masthead and the contact emails are set in the Homepage, Masthead and Site tabs. "All articles" lists everything on the website.'],
    ['p', '• Anyone who can edit this Sheet can publish. Share it only with editors and the adviser.'],
  ];
  tab.clear();
  tab.getRange(1, 1, lines.length, 1).setValues(lines.map(function (l) { return [l[1]]; })).setWrap(true).setVerticalAlignment('top').setFontSize(11);
  lines.forEach(function (l, i) {
    const cell = tab.getRange(i + 1, 1);
    if (l[0] === 'h1') cell.setFontSize(18).setFontWeight('bold');
    if (l[0] === 'h2') cell.setFontSize(12).setFontWeight('bold').setFontColor('#9b1b30');
    if (l[0] === 'status') cell.setFontWeight('bold').setFontColor(l[1].indexOf(INSTANT_ON) === 0 ? '#1e7b34' : '#7a4f00');
  });
  tab.setColumnWidth(1, 900);
  tab.setHiddenGridlines(true);
  tab.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  tab.protect().setDescription(AUTO).setWarningOnly(true);
}

// ---------------------------------------------------------------------------------------------
// The Homepage, Site and Masthead tabs

const HOME_ROWS = [
  ['Lead story', 'Paste the article\'s web address. Leave empty to use the newest story with a wide photo.'],
  ['Top story 2', 'Optional. Stories shown beside the lead; leave empty for the newest ones.'],
  ['Top story 3', ''], ['Top story 4', ''], ['Top story 5', ''],
  ["Editors' pick 1", 'Up to four articles for the Editors\' Picks band. Leave all four empty to hide the band.'],
  ["Editors' pick 2", ''], ["Editors' pick 3", ''], ["Editors' pick 4", ''],
  ['Print issue to promote', 'The issue\'s ID, for example 2026-27-issue-1.'],
  ['Banner text', 'Optional one-line notice across the top of every page.'],
  ['Banner link', 'Optional web address the banner points to.'],
];
const SITE_ROWS = [
  ['Contact email', 'Shown on the Contact, Corrections and Join pages. Several addresses may be separated by commas. Leave as is unless it changes: an empty cell keeps the current address.'],
  ['Tips email', 'Optional. If empty, tips go to the contact email.'],
  ['Masthead school year', 'For example 2026–27.'],
];

/** Creates a two-column settings tab, or adds any settings rows it is missing. */
function keyValueTab_(ss, name, rows) {
  let tab = ss.getSheetByName(name);
  if (!tab) {
    tab = ss.insertSheet(name);
    tab.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'How to fill it in']]).setFontWeight('bold');
    tab.setFrozenRows(1);
    tab.setColumnWidth(1, 190); tab.setColumnWidth(2, 420); tab.setColumnWidth(3, 520);
  }
  const have = tab.getRange(1, 1, Math.max(1, tab.getLastRow()), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  rows.forEach(function (row) { if (have.indexOf(row[0]) < 0) tab.appendRow([row[0], '', row[1]]); });
}
