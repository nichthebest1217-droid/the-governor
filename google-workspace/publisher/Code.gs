/**
 * The Governor publisher: the newspaper's website, run from Google.
 *
 * A standalone Apps Script project ("The Governor publisher") that only the Sheet's owner can open.
 * It runs as the owner, so it is kept out of the Sheet: anyone who can edit the Sheet can edit the
 * Sheet's own script, but not this one.
 *
 *   - Its web address is the website. doGet() serves Page.html with the site's data, and the Google
 *     Site shows it full-screen. Readers' browsers ask api() for article texts and for searches.
 *   - Every minute (tick) it reads the Articles tab, gives rows that are ready an ID and a date,
 *     turns each new or edited Published article's Google Doc into a web page (Doc.gs), copies its
 *     pictures into Drive, takes down rows that are no longer Published, and fills in "On the website".
 *   - The archive (the WordPress articles and the print issues) was copied into Drive once, by
 *     importArchive().
 *   - A print issue's PDF dropped into the Drive folder "The Governor: print issues" is split into
 *     its articles (Issue.gs): a Google Doc and a Ready for Review row for each, and a row in the
 *     Issues tab. Setting that row to Published puts the issue (its PDF) on the website and
 *     publishes its articles that are still Ready for Review.
 *
 * Everything lives in the school's Google account: the Sheet, the Docs, this script, and a Drive
 * folder "The Governor website" holding the pictures and PDFs (anyone can view them) and the site's
 * data files (private). Setup and maintenance: google-workspace/SETUP.md in the website's repository.
 */

const SETTINGS = {
  SHEET_ID: '1n8o4n_5bSl9TOet1IvaAt7pl5FXxLWKiYek6i_2Xbsc', // "The Governor: Publication"
  SITE_URL: 'https://sites.google.com/govsacademy.org/thegovernor', // the Google Site that shows this
};
// Where the archive was copied from, once (a fixed version of the website's old repository).
const IMPORT_FROM = 'https://raw.githubusercontent.com/nichthebest1217-droid/the-governor/d57ac83c71e7c3617ebc6ddc709f0acfad9fcba2/';
// Raise to rebuild every article from the Sheet at the next check (after changing Doc.gs).
const PROCESSOR = 3; // 2: pictures Google exports in bold or italics stay pictures; 3: pictures side by side make the cover together (October 2026)
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

// ===== Shared with sheet/Code.gs: keep this block identical in both files (a test checks). =====
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
  ['Nameplate', 230, 'Optional. A special version of the paper\'s title (for example a Halloween one) to show at the top of the website while this is the latest issue: a Google Drive link to the picture. Leave empty for the usual title, which returns by itself when the next issue is published.'],
];
const ISSUE_HEADERS = ISSUE_COLUMNS.map(function (c) { return c[0]; });

/** The Issues tab, made when first needed. A column added since the tab was made goes on its end. */
function issueTab_(ss) {
  let tab = ss.getSheetByName(ISSUES);
  if (tab) {
    let next = tab.getLastColumn() + 1;
    const have = next > 1 ? tab.getRange(1, 1, 1, next - 1).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    ISSUE_COLUMNS.forEach(function (c) {
      if (have.indexOf(c[0]) >= 0) return;
      tab.getRange(1, next).setValue(c[0]).setFontWeight('bold').setBackground('#141312').setFontColor('#ffffff').setNote(c[2]);
      tab.setColumnWidth(next, c[1]);
      next++;
    });
    return tab;
  }
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

function setting_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || SETTINGS[key];
}
function book_() {
  return SpreadsheetApp.openById(setting_('SHEET_ID'));
}
/** The web address of this script's deployment, which is the website's own address. */
function webAppUrl_() {
  return PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || ScriptApp.getService().getUrl() || '';
}
/** A link straight to one page of the website. */
function pageUrl_(path) {
  return webAppUrl_() + '?p=' + encodeURIComponent(path);
}

// ---------------------------------------------------------------------------------------------
// Reading the Articles tab

function readTable_(ss) {
  const sheet = ss.getSheetByName(ARTICLES);
  if (!sheet) throw new Error('The Sheet has no Articles tab. In the Sheet: The Governor > Set up or repair this Sheet.');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  HEADERS.forEach(function (h) {
    if (headers.indexOf(h) < 0) throw new Error('The Articles tab has no "' + h + '" column. In the Sheet: The Governor > Set up or repair this Sheet.');
  });
  const count = values.length - 1;
  const links = linkColumns_(sheet, headers, 2, count);
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(rowFrom_(values[i + 1], headers, links[i], i + 2));
  return { sheet: sheet, headers: headers, rows: rows, cleared: settleIds_(rows), col: function (name) { return headers.indexOf(name) + 1; } };
}

/**
 * Each ID belongs to one row. When a row has been copied, the original keeps the ID: a Published
 * row before any other, then the row whose title still matches the ID, then the higher row.
 * Returns the rows whose ID was taken away (a copy, or something typed that is not an ID).
 */
function settleIds_(rows) {
  const groups = {};
  const cleared = [];
  rows.forEach(function (r) {
    if (!r.id) return;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id)) { r.id = ''; cleared.push(r); return; }
    (groups[r.id] = groups[r.id] || []).push(r);
  });
  Object.keys(groups).forEach(function (id) {
    const group = groups[id];
    if (group.length < 2) return;
    const score = function (r) { const slug = slugify_(r.title); return (r.status === 'Published' ? 2 : 0) + (slug && id.slice(11).indexOf(slug) === 0 ? 1 : 0); };
    let keep = group[0];
    group.forEach(function (r) { if (score(r) > score(keep)) keep = r; });
    group.forEach(function (r) { if (r !== keep) { r.id = ''; cleared.push(r); } });
  });
  return cleared;
}

/** Changes whenever anything that shows on the website changes, including the Doc's text. */
function revision_(r) {
  return hash_(JSON.stringify([r.title, r.authors, r.category, r.date, r.description, r.imageLink, r.imageAlt, r.imageCaption,
    r.imageCredit, r.type, r.issue, r.order, r.correction, r.text, r.docId, r.docVersion || '']));
}

/**
 * Sorts the rows: Published rows that are ready (`ready`), rows that were published but now have a
 * problem (`held`: the live version stays), and rows that are not Published or are scheduled for
 * later (`unpublished`: taken down). Also reads the Homepage, Site and Masthead tabs.
 */
function assess_(ss, t, docs, today, printed) {
  const out = { ready: [], held: [], unpublished: [], settings: null };
  t.rows.forEach(function (r) {
    r.problems = [];
    r.warnings = [];
    r.scheduled = false;
    if (r.blank) return;
    if (r.status !== 'Published') { if (r.id) out.unpublished.push(r.id); return; }
    r.problems = basicProblems_(r);
    if (r.docId) {
      const d = docs[r.docId];
      const problem = docProblem_(d);
      if (problem) r.problems.push(problem);
      else {
        r.docVersion = d.version;
        if (d.publicEdit) r.warnings.push("anyone with the Doc's link can edit it, and edits go live; set its sharing to Restricted");
      }
    }
    if (!r.id) return; // not ready yet: the minute-by-minute check gives it an ID first
    if (r.problems.length) { out.held.push(r.id); return; }
    r.date = goLiveDate_(r, today);
    // A future date schedules the article, except in a print issue that is Published: the issue's
    // Status says when its articles go up, and they keep the date printed on it.
    r.scheduled = r.date > today && !(r.issue && printed && printed[r.issue]);
    if (r.scheduled) { out.unpublished.push(r.id); return; }
    r.revision = revision_(r);
    out.ready.push(r);
  });
  out.settings = readSettings_(ss);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The Docs

/**
 * When each Doc was last edited, whether the owner can open it, and whether anyone with its link
 * may edit it. Edit times are remembered: each run asks Drive only for Docs edited since the last
 * run, and looks every Doc up again once an hour (or whenever Drive's search fails).
 */
function docInfo_(ids) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  let full = !all.DOCS_SCAN || now - Number(all.DOCS_FULL_SCAN || 0) > 60 * 60 * 1000;
  const fresh = {};
  if (!full && ids.length) {
    try {
      const since = new Date(Number(all.DOCS_SCAN) - 5 * 60 * 1000);
      const found = DriveApp.searchFiles("modifiedDate > '" + Utilities.formatDate(since, 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + "' and mimeType = 'application/vnd.google-apps.document'");
      while (found.hasNext()) { const f = found.next(); fresh[f.getId()] = f; }
    } catch (err) {
      full = true;
    }
  }
  const out = {};
  const updates = {};
  ids.forEach(function (id) {
    const cached = all['DOC:' + id];
    out[id] = cached && !full && !fresh[id] ? JSON.parse(cached) : lookUpDoc_(id, fresh[id], updates);
  });
  updates.DOCS_SCAN = String(now);
  if (full) {
    updates.DOCS_FULL_SCAN = String(now);
    Object.keys(all).forEach(function (k) { if (k.indexOf('DOC:') === 0 && ids.indexOf(k.slice(4)) < 0) props.deleteProperty(k); });
  }
  props.setProperties(updates);
  return out;
}

function lookUpDoc_(id, file, updates) {
  try {
    const f = file || DriveApp.getFileById(id);
    const info = { version: f.getLastUpdated().toISOString(), mime: f.getMimeType() };
    try {
      const access = f.getSharingAccess();
      info.publicEdit = f.getSharingPermission() === DriveApp.Permission.EDIT && (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK);
    } catch (err) { /* sharing details are not available for every file */ }
    updates['DOC:' + id] = JSON.stringify(info);
    return info;
  } catch (err) {
    return { error: "The Sheet can't open this Doc. Share it with " + ownerEmail_() + ' (Viewer is enough).' };
  }
}

function docProblem_(info) {
  if (!info) return 'The Sheet has not checked this Doc yet.';
  if (info.error) return info.error;
  if (info.mime !== 'application/vnd.google-apps.document') return 'The Google Doc link points to a file that is not a Google Doc. Open it, use File > Save as Google Docs, and paste the new link.';
  return '';
}

// ---------------------------------------------------------------------------------------------
// Drive: the website's folder, its data files and its pictures

/** "The Governor website" with its "Pictures and PDFs" and "Data" folders, made on first use. */
function folders_() {
  const props = PropertiesService.getScriptProperties();
  const ensure = function (key, name, parent) {
    let id = props.getProperty(key);
    if (!id) {
      id = Drive.Files.create({ name: name, mimeType: FOLDER_TYPE, parents: parent ? [parent] : [] }).id;
      props.setProperty(key, id);
    }
    return id;
  };
  const root = ensure('FOLDER_ROOT', 'The Governor website', null);
  return { root: root, media: ensure('FOLDER_MEDIA', 'Pictures and PDFs (public)', root), data: ensure('FOLDER_DATA', 'Data', root) };
}

function saveJson_(name, value) {
  const props = PropertiesService.getScriptProperties();
  const key = 'FILE:' + name;
  const blob = Utilities.newBlob(JSON.stringify(value), 'application/json', name);
  const id = props.getProperty(key);
  if (id) { Drive.Files.update({}, id, blob); return id; }
  const created = Drive.Files.create({ name: name, mimeType: 'application/json', parents: [folders_().data] }, blob).id;
  props.setProperty(key, created);
  return created;
}

function loadJson_(name) {
  const id = PropertiesService.getScriptProperties().getProperty('FILE:' + name);
  return id ? JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8')) : null;
}

/** Puts a picture or PDF in the public folder (resumable upload, so large PDFs work) and lets anyone view it. */
function uploadPublic_(blob, name) {
  const type = blob.getContentType() || 'application/octet-stream';
  const start = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': type },
    payload: JSON.stringify({ name: name, parents: [folders_().media] }),
  });
  if (start.getResponseCode() !== 200) throw retry_('Drive did not accept the upload (' + start.getResponseCode() + ').', true);
  const headers = start.getHeaders();
  // The blob itself, not blob.getBytes(): a 30 MB PDF as a JavaScript array would not fit in memory.
  const put = UrlFetchApp.fetch(headers.Location || headers.location, { method: 'put', contentType: type, payload: blob, muteHttpExceptions: true });
  if (put.getResponseCode() !== 200 && put.getResponseCode() !== 201) throw retry_('Drive did not finish the upload (' + put.getResponseCode() + ').', true);
  const id = JSON.parse(put.getContentText()).id;
  Drive.Permissions.create({ role: 'reader', type: 'anyone' }, id);
  return id;
}

/** Moves files this script made to the Drive trash (Drive keeps them for 30 days). */
function trash_(ids) {
  (ids || []).forEach(function (id) {
    try { Drive.Files.update({ trashed: true }, id); } catch (err) { /* already gone */ }
  });
}

/** Width and height of a PNG, JPEG, GIF or WebP picture, read from its first bytes. */
function imageSize_(bytes) {
  const b = function (i) { return bytes[i] & 0xff; };
  if (b(0) === 0x89 && b(1) === 0x50) return { w: (b(16) << 24 | b(17) << 16 | b(18) << 8 | b(19)) >>> 0, h: (b(20) << 24 | b(21) << 16 | b(22) << 8 | b(23)) >>> 0 };
  if (b(0) === 0x47 && b(1) === 0x49) return { w: b(6) | b(7) << 8, h: b(8) | b(9) << 8 };
  if (b(0) === 0x52 && b(8) === 0x57) { // RIFF....WEBP
    const kind = String.fromCharCode(b(12), b(13), b(14), b(15));
    if (kind === 'VP8X') return { w: 1 + (b(24) | b(25) << 8 | b(26) << 16), h: 1 + (b(27) | b(28) << 8 | b(29) << 16) };
    if (kind === 'VP8 ') return { w: (b(26) | b(27) << 8) & 0x3fff, h: (b(28) | b(29) << 8) & 0x3fff };
    if (kind === 'VP8L') { const bits = b(21) | b(22) << 8 | b(23) << 16 | b(24) << 24; return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }; }
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (b(i) !== 0xff) { i++; continue; }
      const marker = b(i + 1);
      const length = b(i + 2) << 8 | b(i + 3);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: b(i + 7) << 8 | b(i + 8), h: b(i + 5) << 8 | b(i + 6) };
      i += 2 + length;
    }
  }
  return { w: null, h: null };
}

/** An error the next check should simply try again (Google busy, a row edited mid-update). */
function retry_(message, retry) {
  const err = new Error(message);
  err.retry = !!retry;
  return err;
}

// ---------------------------------------------------------------------------------------------
// Turning Published rows into web pages

/**
 * Brings live.json (the Sheet's articles as the website shows them) in line with the Sheet:
 * new and edited Published rows are built, rows that are no longer Published are taken down.
 * Stops after about four minutes; the next check carries on.
 */
function compile_(assessed, started) {
  const live = loadJson_('live.json') || { version: '', articles: {}, errors: {}, warnings: [], settings: null };
  const next = { version: '', articles: {}, errors: {}, warnings: [], settings: assessed.settings, issues: (assessed.issues || []).slice() };
  // An issue Drive could not be asked about just now keeps its live version.
  (live.issues || []).forEach(function (i) {
    if ((assessed.keepIssues || []).indexOf(i.id) >= 0 && !next.issues.some(function (x) { return x.id === i.id; })) next.issues.push(i);
  });
  assessed.ready.forEach(function (r) {
    const prev = live.articles[r.id];
    if (prev && prev.revision === r.revision && prev.processor === PROCESSOR) { next.articles[r.id] = prev; return; }
    if (Date.now() - started > 4 * 60 * 1000) { if (prev) next.articles[r.id] = prev; return; }
    try {
      next.articles[r.id] = compileArticle_(r, prev);
    } catch (err) {
      if (prev) next.articles[r.id] = prev;
      if (!err.retry) next.errors[r.id] = { revision: r.revision, message: String(err.message || err) };
    }
  });
  assessed.held.forEach(function (id) { if (live.articles[id] && !next.articles[id]) next.articles[id] = live.articles[id]; });
  // Rows set to Draft or Ready for Review, scheduled for later, or deleted, come down. A row that
  // vanished is taken down too, unless many vanished at once (an emptied tab, a bad paste).
  const gone = Object.keys(live.articles).filter(function (id) { return !next.articles[id]; });
  const vanished = gone.filter(function (id) { return assessed.unpublished.indexOf(id) < 0; });
  const hold = vanished.length > 3 && vanished.length > Object.keys(live.articles).length / 2;
  if (hold) next.warnings.push(vanished.length + ' published articles disappeared from the Sheet at once, so they were left on the website in case this is a mistake. To take them down, put their rows back and set them to Draft.');
  gone.forEach(function (id) {
    if (hold && vanished.indexOf(id) >= 0) next.articles[id] = live.articles[id];
    else trash_(live.articles[id].media);
  });
  // An article rebuilt by a newer processor (same row, same Doc) changes the version too, so it is saved.
  next.version = hash_(JSON.stringify([Object.keys(next.articles).sort().map(function (id) { return id + ':' + next.articles[id].revision + ':' + (next.articles[id].processor || 0); }), next.settings, next.issues]));
  if (next.version !== live.version || JSON.stringify(next.errors) !== JSON.stringify(live.errors || {}) || JSON.stringify(next.warnings) !== JSON.stringify(live.warnings || [])) {
    saveJson_('live.json', next);
    if (next.version !== live.version) setSiteVersion_();
  }
  return next;
}

/** One Published row as a web page: the Doc's text and pictures, the cover photo, the byline. */
function compileArticle_(r, prev) {
  const known = (prev && prev.images) || {}; // picture fingerprint -> {id, w, h}, so unchanged pictures are not copied again
  const images = {};
  const keep = function (bytes, mime, stem) {
    const key = hashBytes_(bytes);
    if (!images[key]) {
      const size = known[key] || imageSize_(bytes);
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[mime] || 'img';
      images[key] = known[key] || { id: uploadPublic_(Utilities.newBlob(bytes, mime, stem + '.' + ext), r.id + '-' + stem + '-' + key + '.' + ext), w: size.w, h: size.h };
    }
    return images[key];
  };
  let markdown;
  let lead = null;
  const sizes = {};
  if (r.docId) {
    const doc = exportDoc_(r.docId);
    const refs = {};
    DocMarkdown.imageRefs(doc.markdown).forEach(function (ref, n) {
      const img = doc.images[ref];
      if (!img) return;
      const saved = keep(Utilities.base64Decode(img.data), img.mime, String(n + 1));
      refs[ref] = 'gdrive:' + saved.id;
      sizes[saved.id] = { w: saved.w, h: saved.h };
    });
    const cleaned = DocMarkdown.cleanDocMarkdown(doc.markdown, { title: r.title, images: refs, leadImage: !r.imageLink });
    markdown = cleaned.body;
    lead = cleaned.lead;
  } else {
    markdown = DocMarkdown.textToMarkdown(r.text);
  }
  let cover = null;
  if (r.imageLink) {
    const picture = fetchCover_(r);
    const saved = keep(picture.bytes, picture.mime, 'cover');
    cover = { id: saved.id, w: saved.w, h: saved.h, alt: r.imageAlt, caption: r.imageCaption || null, credit: r.imageCredit || null };
  } else if (lead) {
    // Pictures side by side at the top of the Doc are the cover together, shown side by side.
    const pic = function (l) { const id = l.src.replace(/^gdrive:/, ''); return { id: id, w: (sizes[id] || {}).w || null, h: (sizes[id] || {}).h || null, alt: l.alt || '', caption: l.caption || null }; };
    cover = pic(lead);
    cover.credit = null;
    if (lead.beside && lead.beside.length) cover.beside = lead.beside.map(pic);
  }
  const text = plainText_(markdown);
  const words = text ? text.split(' ').length : 0;
  if (markdown.length <= 200 && !/!\[/.test(markdown) && !cover) throw new Error('The article has only ' + words + ' words. Is the Doc link right, and is it the finished Doc?');
  const writers = DocMarkdown.splitWriters(r.authors).slice(0, 12).map(DocMarkdown.parseWriter).filter(function (w) { return w.slug; });
  if (!writers.length) throw new Error("The Author(s) could not be read. Write them like Jane Doe '27, Sam Lee '28.");
  const paras = [];
  let length = 0;
  markdown.split(/\n\s*\n/).map(plainText_).filter(Boolean).forEach(function (para) { if (length < 420) { paras.push(para.slice(0, 600)); length += para.length; } });
  const media = Object.keys(images).map(function (k) { return images[k].id; });
  if (prev) trash_((prev.media || []).filter(function (id) { return media.indexOf(id) < 0; }));
  const writerInfo = {};
  writers.forEach(function (w) { writerInfo[w.slug] = { name: w.name, classYear: w.classYear }; });
  return {
    id: r.id, revision: r.revision, processor: PROCESSOR,
    title: r.title, publishedAt: r.date, date: r.date, updatedAt: null,
    section: CATEGORIES[r.category], secondarySections: [], kind: r.type === 'Editorial' ? 'editorial' : 'article',
    authors: writers.map(function (w) { return w.slug; }), writers: writerInfo,
    deck: r.description || null, paras: paras, minutes: Math.max(1, Math.round(words / 230)),
    cover: cover, issueId: r.issue || null, printOrder: r.order && !isNaN(Number(r.order)) ? Number(r.order) : null,
    correction: r.correction || null, featured: false, fromSheet: true,
    path: '/' + r.date.replace(/-/g, '/') + '/' + r.id.slice(11) + '/',
    text: text.slice(0, 20000), body: DocRender.render(markdown, sizes),
    media: media, images: images,
  };
}

/** The Doc as Markdown, with its pictures taken out and returned separately. */
function exportDoc_(docId) {
  const res = UrlFetchApp.fetch('https://docs.google.com/document/d/' + docId + '/export?format=md', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) throw retry_('Could not read the Doc (Google answered ' + code + ').', code === 429 || code >= 500);
  return splitImages_(res.getContentText('UTF-8'));
}

function splitImages_(md) {
  const images = {};
  let n = 0;
  const keep = function (ref, mime, data) { images[ref] = { mime: mime, data: data.replace(/\s+/g, '') }; };
  // Pictures come as definitions at the end, [image1]: <data:image/png;base64,...>, or inline.
  md = md.replace(/^\[([^\]\n]+)\]:[ \t]*<data:(image\/[\w.+-]+);base64,([^>]*)>[ \t]*$/gm, function (m, ref, mime, data) { keep(ref, mime, data); return ''; });
  md = md.replace(/^\[([^\]\n]+)\]:[ \t]*data:(image\/[\w.+-]+);base64,(\S+)[ \t]*$/gm, function (m, ref, mime, data) { keep(ref, mime, data); return ''; });
  md = md.replace(/!\[([^\]\n]*)\]\(<?data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]*)>?\)/g, function (m, alt, mime, data) {
    const ref = 'inline' + (++n);
    keep(ref, mime, data);
    return '![' + alt + '][' + ref + ']';
  });
  return { markdown: md.replace(/\n{3,}/g, '\n\n').trim(), images: images };
}

/** The picture at the row's Image link: from Drive, a 2,000-pixel copy (the original stays in Drive). */
function fetchCover_(r) {
  const drive = driveId_(r.imageLink);
  const res = drive
    ? UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + drive + '&sz=w2000', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true })
    : UrlFetchApp.fetch(r.imageLink, { muteHttpExceptions: true, followRedirects: true });
  const code = res.getResponseCode();
  if (code !== 200) throw retry_('The picture at the Image link could not be downloaded (' + code + '). Is it shared with ' + ownerEmail_() + '?', code === 429 || code >= 500);
  const blob = res.getBlob();
  if (!/^image\//.test(blob.getContentType())) throw new Error('The Image link does not point to a picture.');
  return { bytes: blob.getBytes(), mime: blob.getContentType() };
}

/** Plain words of a Markdown text, for summaries, reading time and search. */
function plainText_(markdown) {
  return String(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// The site's data: the archive plus the Sheet's articles, kept in the script cache

function setSiteVersion_() {
  PropertiesService.getScriptProperties().setProperty('SITE_VERSION', hash_(String(Date.now()) + Math.random()));
}

/** Everything the page needs except article texts. */
function siteData_() {
  const version = PropertiesService.getScriptProperties().getProperty('SITE_VERSION') || 'none';
  const cached = getBig_('site:' + version);
  return cached ? JSON.parse(cached) : buildSiteData_(version).client;
}

function buildSiteData_(version) {
  const archive = loadJson_('archive.json') || { articles: [], authors: {}, issues: [], brand: {}, contactEmail: null };
  const live = loadJson_('live.json') || { articles: {}, settings: null };
  const authors = JSON.parse(JSON.stringify(archive.authors || {}));
  const all = (archive.articles || []).slice();
  Object.keys(live.articles || {}).forEach(function (id) {
    const a = live.articles[id];
    Object.keys(a.writers || {}).forEach(function (slug) {
      if (!authors[slug]) authors[slug] = { name: a.writers[slug].name, classYear: a.writers[slug].classYear || null, bio: null, photo: null, visible: true };
    });
    all.push(a);
  });
  all.sort(function (a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (b.legacyWpId || 0) - (a.legacyWpId || 0) || (a.id < b.id ? -1 : 1); });
  const client = {
    articles: all.map(function (a) {
      return { id: a.id, title: a.title, publishedAt: a.publishedAt, updatedAt: a.updatedAt || null, section: a.section, secondarySections: a.secondarySections || [], kind: a.kind,
        authors: a.authors || [], deck: a.deck || null, paras: a.paras || [], minutes: a.minutes || 1, cover: a.cover || null, issueId: a.issueId || null,
        printOrder: a.printOrder == null ? null : a.printOrder, correction: a.correction || null, featured: !!a.featured, path: a.path, fromSheet: !!a.fromSheet };
    }),
    authors: authors,
    issues: mergeIssues_(archive.issues || [], live.issues || []),
    brand: archive.brand || {},
    settings: live.settings || {},
    contactEmail: archive.contactEmail || null,
  };
  const names = function (a) { return (a.authors || []).map(function (s) { return authors[s] ? authors[s].name : ''; }).join(' '); };
  const search = all.map(function (a) { return [a.id, (a.title + ' ' + names(a)).toLowerCase(), String(a.text || '').toLowerCase()]; });
  putBig_('site:' + version, JSON.stringify(client));
  putBig_('search:' + version, JSON.stringify(search));
  const bodies = {};
  all.forEach(function (a) { if (a.body && a.body.length < 90000) bodies['body:' + version + ':' + a.id] = a.body; });
  const keys = Object.keys(bodies);
  for (let i = 0; i < keys.length; i += 10) {
    const part = {};
    keys.slice(i, i + 10).forEach(function (k) { part[k] = bodies[k]; });
    CacheService.getScriptCache().putAll(part, 21600);
  }
  return { client: client, all: all, search: search };
}

function articleBody_(id) {
  const version = PropertiesService.getScriptProperties().getProperty('SITE_VERSION') || 'none';
  const hit = CacheService.getScriptCache().get('body:' + version + ':' + id);
  if (hit != null) return hit;
  const a = buildSiteData_(version).all.filter(function (x) { return x.id === id; })[0];
  return a ? a.body : null;
}

/** Articles containing every word of the query, best first: matches in the headline or byline count most. */
function search_(q) {
  const terms = String(q).toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; }).slice(0, 8);
  if (!terms.length) return [];
  const version = PropertiesService.getScriptProperties().getProperty('SITE_VERSION') || 'none';
  const cached = getBig_('search:' + version);
  const index = cached ? JSON.parse(cached) : buildSiteData_(version).search;
  const found = [];
  index.forEach(function (row) {
    let score = 0;
    for (let i = 0; i < terms.length; i++) {
      const inHead = row[1].indexOf(terms[i]) >= 0;
      const at = row[2].indexOf(terms[i]);
      if (!inHead && at < 0) return;
      score += inHead ? 3 : 1;
    }
    const at = row[2].indexOf(terms[0]);
    const snippet = at < 0 ? '' : (at > 60 ? '…' : '') + row[2].slice(Math.max(0, at - 60), at + 140).trim() + '…';
    found.push({ id: row[0], score: score, snippet: snippet });
  });
  found.sort(function (a, b) { return b.score - a.score; });
  return found.slice(0, 50).map(function (f) { return { id: f.id, snippet: f.snippet }; });
}

/** The script cache holds at most 100 KB per entry, so large values are stored in pieces. */
function putBig_(key, text) {
  const cache = CacheService.getScriptCache();
  const parts = {};
  const size = 30000;
  const count = Math.ceil(text.length / size);
  for (let i = 0; i < count; i++) parts[key + ':' + i] = text.slice(i * size, (i + 1) * size);
  parts[key + ':n'] = String(count);
  cache.putAll(parts, 21600);
}

function getBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + ':n'));
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = cache.getAll(keys);
  if (keys.some(function (k) { return got[k] == null; })) return null;
  return keys.map(function (k) { return got[k]; }).join('');
}

// ---------------------------------------------------------------------------------------------
// The website

/** The page readers get. ?p=/path/ opens a given page (every link a reader copies looks like that). */
function doGet(e) {
  const raw = String((e && e.parameter && e.parameter.p) || '/');
  let path = raw.split('?')[0] || '/';
  if (path[0] !== '/') path = '/' + path;
  if (!/\/$/.test(path)) path += '/';
  const data = siteData_();
  const article = data.articles.filter(function (a) { return a.path === path; })[0];
  const boot = { path: raw, data: data, bodies: {}, appUrl: webAppUrl_() };
  if (article) boot.bodies[article.id] = articleBody_(article.id);
  const page = HtmlService.createTemplateFromFile('Page');
  page.boot = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const out = page.evaluate()
    .setTitle(article ? article.title + ' | The Governor' : 'The Governor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return out;
}

/** What readers' browsers ask for: an article's text, or a search. */
function api(request) {
  const req = request || {};
  if (req.op === 'body') return { id: String(req.id), body: articleBody_(String(req.id)) };
  if (req.op === 'search') return { q: String(req.q || ''), results: search_(String(req.q || '').slice(0, 200)) };
  throw new Error('Unknown request.');
}

// ---------------------------------------------------------------------------------------------
// The minute-by-minute check

/** Runs every minute (installed by setUpPublisher). */
function tick() {
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('LAST_TICK') || 0) < 20 * 1000) return 'too soon';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'busy';
  try {
    const started = Date.now();
    refresh_();
    if (Date.now() - started < 90 * 1000) checkPrintIssues_(book_(), started);
    return 'done';
  } finally {
    lock.releaseLock();
  }
}

/** For the owner, from the script editor: check the Sheet now (at most every ten seconds). */
function publishNow() {
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('LAST_TICK') || 0) < 10 * 1000) return 'too soon';
  props.setProperty('LAST_TICK', '0');
  return tick();
}

/**
 * Gives rows that are ready an ID and a date, builds and takes down articles, and writes the
 * "On the website" column, the All articles tab and the line at the top of How to publish.
 */
function refresh_() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_TICK', String(started));
  const ss = book_();
  const issues = readIssues_(ss);
  publishIssueArticles_(ss, issues);
  const t = readTable_(ss);
  const today = today_();

  // IDs and dates first, straight after reading, so they land on the rows just read.
  const taken = {};
  t.rows.forEach(function (r) { if (r.id) taken[r.id] = true; });
  const idWrites = t.cleared.slice();
  const dateWrites = [];
  t.rows.forEach(function (r) {
    if (r.status !== 'Published' || basicProblems_(r).length) return;
    if (!r.date) { r.date = goLiveDate_(r, today); dateWrites.push(r); }
    if (!r.id) {
      r.id = uniqueId_(r.date + '-' + (slugify_(r.title) || 'article'), taken);
      taken[r.id] = true;
      if (idWrites.indexOf(r) < 0) idWrites.push(r);
    }
  });
  idWrites.forEach(function (r) { t.sheet.getRange(r.row, t.col('ID')).setValue(r.id); });
  dateWrites.forEach(function (r) { t.sheet.getRange(r.row, t.col('Publication date')).setValue(new Date(r.date + 'T12:00:00')); });

  const docIds = [];
  t.rows.forEach(function (r) { if (r.status === 'Published' && r.docId && docIds.indexOf(r.docId) < 0) docIds.push(r.docId); });
  const printed = {};
  issues.rows.forEach(function (r) { if (r.status === 'Published' && r.id) printed[r.id] = true; });
  const assessed = assess_(ss, t, docInfo_(docIds), today, printed);
  assessed.issues = siteIssues_(issues);
  assessed.keepIssues = issues.rows.filter(function (r) { return r.retrying; }).map(function (r) { return r.id; });
  const live = compile_(assessed, started);

  if (sameRows_(t)) writeNotes_(t, t.rows.map(function (r) { return noteFor_(r, live); }));
  writeIssueNotes_(issues, live);
  writeAllArticles_(ss);
  writeGuideStatus_(ss, live);
  sharePrintFolder_(ss);
}

/** False when rows were added, removed or moved since the Sheet was read: the notes wait a minute. */
function sameRows_(t) {
  if (!t.rows.length) return true;
  const titles = t.sheet.getRange(2, t.col('Title'), t.rows.length, 1).getValues();
  return t.rows.every(function (r, i) { return String(titles[i][0]).trim().replace(/\s+/g, ' ') === r.title; });
}

function noteFor_(r, live) {
  if (r.blank) return { text: '' };
  const entry = r.id ? live.articles[r.id] : null;
  if (r.status !== 'Published') return { text: entry ? 'Taking it off the website…' : offNote_(r.status) };
  if (r.problems.length) return { text: (entry ? '⚠ The website still shows the earlier version: ' : '⚠ ') + r.problems[0] };
  if (r.scheduled) return { text: 'Scheduled for ' + longDate_(r.date) + (entry ? ' (taking it off the website until then)' : '') };
  if (entry && entry.revision === r.revision) {
    const url = pageUrl_(entry.path);
    return { text: '✓ Live: ' + url + (r.warnings.length ? '   ⚠ ' + r.warnings[0] : ''), link: url };
  }
  const error = live.errors[r.id];
  if (error && error.revision === r.revision) return { text: '⚠ The website could not publish this version: ' + error.message };
  return { text: (entry ? 'Updating…' : 'Publishing…') + waitNote_(true) };
}

function writeNotes_(t, notes) {
  if (!notes.length) return;
  const range = t.sheet.getRange(2, t.col('On the website'), notes.length, 1);
  const current = range.getValues();
  let changed = false;
  const next = notes.map(function (n, i) {
    if (String(current[i][0]) !== n.text) changed = true;
    const b = SpreadsheetApp.newRichTextValue().setText(n.text);
    if (n.link) { const at = n.text.indexOf(n.link); b.setLinkUrl(at, at + n.link.length, n.link); }
    return [b.build()];
  });
  if (changed) range.setRichTextValues(next);
}

/** The All articles tab: everything on the website, with links. Rewritten when the site changes. */
function writeAllArticles_(ss) {
  const props = PropertiesService.getScriptProperties();
  const version = props.getProperty('SITE_VERSION') || 'none';
  let tab = ss.getSheetByName(ALL);
  if (tab && props.getProperty('ALL_VERSION') === version) return;
  const data = siteData_();
  if (!tab) {
    tab = ss.insertSheet(ALL);
    tab.protect().setDescription(AUTO).setWarningOnly(true);
    tab.setFrozenRows(1);
    [110, 380, 130, 260, 420, 110].forEach(function (w, i) { tab.setColumnWidth(i + 1, w); });
  }
  const label = function (slug) { return Object.keys(CATEGORIES).filter(function (k) { return CATEGORIES[k] === slug; })[0] || slug; };
  const rows = [['Date', 'Title', 'Category', 'Author(s)', 'Web address', 'From this Sheet']].concat(data.articles.map(function (a) {
    return [a.publishedAt.slice(0, 10), a.title, label(a.section), (a.authors || []).map(function (s) { return data.authors[s] ? data.authors[s].name : s; }).join(', '), pageUrl_(a.path), a.fromSheet ? 'Yes' : ''];
  }));
  if (tab.getMaxRows() < rows.length + 1) tab.insertRowsAfter(tab.getMaxRows(), rows.length + 1 - tab.getMaxRows());
  tab.clearContents();
  tab.getRange(1, 1, rows.length, 6).setValues(rows);
  tab.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#141312').setFontColor('#ffffff');
  props.setProperty('ALL_VERSION', version);
}

/** The line at the top of the How to publish tab, and any notes from the publisher under it. */
function writeGuideStatus_(ss, live) {
  const tab = ss.getSheetByName(GUIDE);
  if (!tab) return;
  const text = INSTANT_ON + ': articles appear on the website about a minute after they are marked Published, and come down a minute after they are set back to Draft.';
  const status = tab.getRange(GUIDE_STATUS_ROW, 1);
  if (status.getValue() !== text) status.setValue(text).setFontColor('#1e7b34').setFontWeight('bold');
  const notes = live.warnings.length ? 'Note: ' + live.warnings.join(' ') : '';
  const cell = tab.getRange(GUIDE_STATUS_ROW + 1, 1);
  if (cell.getValue() !== notes) cell.setValue(notes).setFontColor('#a50e0e');
}

// ---------------------------------------------------------------------------------------------
// Print issues: a PDF dropped into "The Governor: print issues" becomes the issue's articles

/** The print-issues folder in the owner's Drive. The publisher makes it, so it may add folders inside. */
function printFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('FOLDER_PRINT');
  if (!id) {
    id = Drive.Files.create({ name: PRINT_FOLDER, mimeType: FOLDER_TYPE, parents: [] }).id;
    props.setProperty('FOLDER_PRINT', id);
  }
  return id;
}

/** Once a day: everyone who can edit the Sheet may drop PDFs into the folder and fix the Docs made there. */
function sharePrintFolder_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('PRINT_SHARED_AT') || 0) < 24 * 60 * 60 * 1000) return;
  props.setProperty('PRINT_SHARED_AT', String(Date.now()));
  let editors = [];
  try { editors = ss.getEditors().map(function (u) { return String(u.getEmail() || '').toLowerCase(); }); } catch (err) { return; }
  const shared = JSON.parse(props.getProperty('PRINT_SHARED') || '[]');
  const owner = ownerEmail_().toLowerCase();
  const folder = printFolder_();
  editors.forEach(function (email) {
    if (!email || email === owner || shared.indexOf(email) >= 0) return;
    try {
      Drive.Permissions.create({ role: 'writer', type: 'user', emailAddress: email }, folder, { sendNotificationEmail: false });
      shared.push(email);
    } catch (err) { /* tried again tomorrow */ }
  });
  props.setProperty('PRINT_SHARED', JSON.stringify(shared));
}

/** A Drive file read in pieces as the PDF reader asks for them, so a large PDF never has to fit in memory. */
function driveBytes_(id, size) {
  return {
    size: size,
    read: function (start, end) {
      const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + (end - 1) }, muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      if (code !== 206 && code !== 200) throw retry_('Could not read the PDF (Google answered ' + code + ').', code === 429 || code >= 500);
      const raw = res.getContent();
      const from = code === 200 && raw.length > end - start ? start : 0;
      const out = new Uint8Array(Math.max(0, Math.min(raw.length - from, end - start)));
      for (let i = 0; i < out.length; i++) out[i] = raw[from + i] & 255;
      return out;
    },
  };
}

function base64_(bytes) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8) | (i + 2 < bytes.length ? bytes[i + 2] : 0);
    out.push(abc[(n >> 18) & 63], abc[(n >> 12) & 63], i + 1 < bytes.length ? abc[(n >> 6) & 63] : '=', i + 2 < bytes.length ? abc[n & 63] : '=');
  }
  return out.join('');
}

/** Writers' names as the website already spells them, so "DK RHEE" in a byline becomes DK Rhee. */
function knownWriters_() {
  const names = [];
  const archive = loadJson_('archive.json');
  if (archive) Object.keys(archive.authors || {}).forEach(function (k) { names.push(archive.authors[k].name); });
  const live = loadJson_('live.json');
  if (live) Object.keys(live.articles || {}).forEach(function (id) {
    const w = live.articles[id].writers || {};
    Object.keys(w).forEach(function (k) { names.push(w[k].name); });
  });
  return names;
}

/** At each check, when there is time: a new or replaced PDF in the folder becomes its issue's articles. */
function checkPrintIssues_(ss, started) {
  const props = PropertiesService.getScriptProperties();
  const folder = props.getProperty('FOLDER_PRINT');
  if (!folder) return;
  const found = Drive.Files.list({ q: "'" + folder + "' in parents and mimeType = 'application/pdf' and trashed = false", fields: 'files(id,name,modifiedTime,size)', orderBy: 'createdTime', pageSize: 50 });
  const file = (found.files || []).filter(function (f) { return props.getProperty('PRINT_DONE:' + f.id) !== f.modifiedTime; })[0];
  if (!file) return;
  try {
    if (makeIssue_(ss, file, started)) props.setProperty('PRINT_DONE:' + file.id, file.modifiedTime);
  } catch (err) {
    if (err.retry) return;
    props.setProperty('PRINT_DONE:' + file.id, file.modifiedTime);
    props.deleteProperty('PRINT_JOB:' + file.id);
    const tab = issueTab_(ss);
    const values = { 'Issue': file.name.replace(/\.pdf$/i, ''), 'PDF': 'https://drive.google.com/file/d/' + file.id + '/view', 'Notes': '⚠ This PDF could not be read: ' + String(err.message || err) };
    tab.getRange(tab.getLastRow() + 1, 1, 1, ISSUE_HEADERS.length).setValues([ISSUE_HEADERS.map(function (h) { return values[h] || ''; })]);
  }
}

/**
 * Splits the PDF, makes a Google Doc for each article (picking up where the last check stopped if
 * it ran out of time), then adds the articles to the Articles tab as Ready for Review, in print
 * order, and the issue to the Issues tab. A PDF dropped again adds only articles not yet in the Sheet.
 */
function makeIssue_(ss, file, started) {
  const props = PropertiesService.getScriptProperties();
  const key = 'PRINT_JOB:' + file.id;
  let job = JSON.parse(props.getProperty(key) || 'null');
  if (!job || job.modified !== file.modifiedTime) job = { modified: file.modifiedTime, folder: null, docs: {} };
  const pdf = IssuePdf.openPdf(driveBytes_(file.id, Number(file.size)));
  const split = IssuePdf.splitIssue(pdf, { knownNames: knownWriters_() });
  const name = file.name.replace(/\.pdf$/i, '');
  const id = split.id || 'issue-' + (slugify_(name) || file.id.slice(0, 8).toLowerCase());
  const title = split.title || name;
  const date = split.date || today_();
  const t = readTable_(ss);
  const have = {};
  t.rows.forEach(function (r) { if (r.issue === id) have[r.title.toLowerCase()] = true; });
  const todo = split.articles.filter(function (a) { return !have[a.title.toLowerCase()]; });
  if (todo.length && !job.folder) {
    job.folder = Drive.Files.create({ name: title.replace(/⁠/g, '') + ' articles', mimeType: FOLDER_TYPE, parents: [printFolder_()] }).id;
    props.setProperty(key, JSON.stringify(job));
  }
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i];
    if (job.docs[a.order]) continue;
    if (Date.now() - started > 4.3 * 60 * 1000) return false; // the next check carries on
    const html = IssuePdf.articleHtml(a, function (im) {
      const picture = pdf.image(im.id);
      return picture ? 'data:' + picture.mime + ';base64,' + base64_(picture.bytes) : null;
    });
    job.docs[a.order] = Drive.Files.create({ name: a.title, mimeType: 'application/vnd.google-apps.document', parents: [job.folder] }, Utilities.newBlob(html, 'text/html', 'article.html')).id;
    props.setProperty(key, JSON.stringify(job));
  }
  const day = new Date(date + 'T12:00:00');
  const rows = todo.map(function (a) {
    const v = {
      'Status': 'Ready for Review', 'Title': a.title, 'Author(s)': a.authors.join(', '), 'Category': a.category, 'Publication date': day,
      'Google Doc link': 'https://docs.google.com/document/d/' + job.docs[a.order] + '/edit', 'Type': a.editorial ? 'Editorial' : 'Article',
      'Print issue': id, 'Order in issue': a.order,
    };
    return t.headers.map(function (h) { return h in v ? v[h] : ''; });
  });
  if (rows.length) t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
  const tab = issueTab_(ss);
  const issues = readIssues_(ss);
  const count = split.articles.length + (split.articles.length === 1 ? ' article' : ' articles');
  const already = split.articles.length - todo.length;
  const notes = ['Made from ' + file.name + ' on ' + longDate_(today_()) + ': ' + count + (already ? ' (' + already + ' were already in the Sheet)' : '') + '.'].concat(split.skipped).join(' ');
  const values = { 'Issue': title, 'ID': id, 'Date': day, 'PDF': 'https://drive.google.com/file/d/' + file.id + '/view', 'Articles folder': job.folder ? 'https://drive.google.com/drive/folders/' + job.folder : '', 'Notes': notes };
  const existing = issues.rows.filter(function (r) { return r.id === id; })[0];
  if (existing) Object.keys(values).forEach(function (h) { if (values[h] !== '' && issues.col(h) > 0) tab.getRange(existing.row, issues.col(h)).setValue(values[h]); });
  else {
    values['Status'] = 'Ready for Review';
    tab.getRange(tab.getLastRow() + 1, 1, 1, ISSUE_HEADERS.length).setValues([ISSUE_HEADERS.map(function (h) { return h in values ? values[h] : ''; })]);
  }
  const first = pdf.page(1);
  props.setProperty('PRINT_META:' + id, JSON.stringify({ w: first.width, h: first.height, pages: pdf.pageCount }));
  props.deleteProperty(key);
  return true;
}

/** The Issues tab's rows. */
function readIssues_(ss) {
  const tab = ss.getSheetByName(ISSUES);
  const out = { tab: tab, rows: [], col: function (name) { return ISSUE_HEADERS.indexOf(name) + 1; } };
  if (!tab || tab.getLastRow() < 2) return out;
  const values = tab.getRange(1, 1, tab.getLastRow(), Math.max(ISSUE_HEADERS.length, tab.getLastColumn())).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  out.col = function (name) { return headers.indexOf(name) + 1; };
  const at = function (v, name) { const i = headers.indexOf(name); return i < 0 || v[i] == null ? '' : v[i]; };
  const np = headers.indexOf('Nameplate');
  const rich = np >= 0 ? tab.getRange(2, np + 1, values.length - 1, 1).getRichTextValues() : [];
  out.rows = values.slice(1).map(function (v, i) {
    return {
      row: i + 2, status: String(at(v, 'Status')).trim(), title: String(at(v, 'Issue')).trim(), id: String(at(v, 'ID')).trim(),
      date: dateOf_(at(v, 'Date')).value, pdf: idFromLink_(String(at(v, 'PDF')).trim()),
      nameplate: np >= 0 ? idFromLink_(String(at(v, 'Nameplate')).trim()) || idFromLink_(linkIn_(rich[i] && rich[i][0])) : '', problem: '', retrying: false,
    };
  });
  return out;
}

/** The first time an issue is Published: its articles still Ready for Review are published with it, and the front page promotes it. */
function publishIssueArticles_(ss, issues) {
  const props = PropertiesService.getScriptProperties();
  const fresh = issues.rows.filter(function (r) { return r.status === 'Published' && /^[a-z0-9-]+$/.test(r.id) && props.getProperty('ISSUE_PUBLISHED:' + r.id) !== '1'; });
  if (!fresh.length) return;
  const sheet = ss.getSheetByName(ARTICLES);
  const values = sheet ? sheet.getDataRange().getValues() : [[]];
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const cs = headers.indexOf('Status');
  const ci = headers.indexOf('Print issue');
  fresh.forEach(function (issue) {
    if (cs >= 0 && ci >= 0) {
      for (let r = 1; r < values.length; r++) {
        if (String(values[r][ci]).trim() === issue.id && String(values[r][cs]).trim() === 'Ready for Review') sheet.getRange(r + 1, cs + 1).setValue('Published');
      }
    }
    promoteIssue_(ss, issue, issues);
    props.setProperty('ISSUE_PUBLISHED:' + issue.id, '1');
  });
}

/** The Homepage tab's "Print issue to promote" moves to a newly published issue (not back to an older one). */
function promoteIssue_(ss, issue, issues) {
  const tab = ss.getSheetByName('Homepage');
  if (!tab) return;
  const values = tab.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() !== 'Print issue to promote') continue;
    const current = String(values[r][1] == null ? '' : values[r][1]).trim();
    const other = issues.rows.filter(function (x) { return x.id === current; })[0];
    if (current !== issue.id && (!current || !other || (other.date || '') <= (issue.date || ''))) tab.getRange(r + 1, 2).setValue(issue.id);
    return;
  }
}

/** Published issues as the website shows them: a public copy of the PDF, which Drive also draws the cover from. */
function siteIssues_(issues) {
  const props = PropertiesService.getScriptProperties();
  const out = [];
  issues.rows.forEach(function (r) {
    if (r.status !== 'Published' || (!r.id && !r.title)) return;
    if (!/^[a-z0-9-]+$/.test(r.id)) { r.problem = 'The ID should look like 2026-27-issue-2.'; return; }
    if (!r.pdf) { r.problem = 'Add the link to the PDF.'; return; }
    let copy;
    try { copy = publicPdf_(r.pdf); } catch (err) {
      if (err.retry) r.retrying = true; else r.problem = String(err.message || err);
      return;
    }
    const meta = JSON.parse(props.getProperty('PRINT_META:' + r.id) || '{}');
    const date = r.date || today_();
    const month = Number(date.slice(5, 7));
    const n = /(\d+)$/.exec(r.id);
    const issue = {
      id: r.id, title: r.title || r.id, season: month >= 8 ? 'Fall' : month <= 3 ? 'Winter' : 'Spring', year: Number(date.slice(0, 4)),
      number: n ? Number(n[1]) : null, volume: null, dateLabel: longDate_(date), notes: [], pdf: { id: copy }, pages: [],
      cover: { id: copy, w: 1200, h: Math.round((1200 * (meta.h || 1224)) / (meta.w || 792)) }, fromSheet: true,
    };
    // Its own nameplate, worn by the website while it is the latest issue. A problem with it does not hold the issue back.
    if (r.nameplate) {
      try { const pic = publicPicture_(r.nameplate); issue.nameplate = { id: pic.id, w: pic.w, h: pic.h }; } catch (err) {
        if (!err.retry) r.problem = String(err.message || err);
      }
    }
    out.push(issue);
  });
  return out;
}

/** A public copy of a picture in Drive (an issue's nameplate), with its size. Copied again when the picture changes. */
function publicPicture_(src) {
  const props = PropertiesService.getScriptProperties();
  const key = 'PICTURE_COPY:' + src;
  const known = JSON.parse(props.getProperty(key) || 'null');
  if (known && Date.now() - known.checked < 10 * 60 * 1000) return known;
  let meta;
  try { meta = Drive.Files.get(src, { fields: 'id,name,mimeType,modifiedTime' }); } catch (err) {
    if (known) return known;
    throw new Error('The publisher cannot open the Nameplate picture. Is it still in Drive, and shared with ' + ownerEmail_() + '?');
  }
  if (known && known.modified === meta.modifiedTime) {
    known.checked = Date.now();
    props.setProperty(key, JSON.stringify(known));
    return known;
  }
  if (!/^image\//.test(meta.mimeType || '')) throw new Error('The Nameplate link does not point to a picture.');
  const blob = DriveApp.getFileById(src).getBlob();
  const size = imageSize_(blob.getBytes());
  const copy = { id: uploadPublic_(blob, meta.name), w: size.w, h: size.h, modified: meta.modifiedTime, checked: Date.now() };
  if (known) trash_([known.id]);
  props.setProperty(key, JSON.stringify(copy));
  return copy;
}

/** A public copy of the issue's PDF in the website's folder, made again when the PDF is replaced. */
function publicPdf_(src) {
  const props = PropertiesService.getScriptProperties();
  const key = 'PRINT_COPY:' + src;
  const known = JSON.parse(props.getProperty(key) || 'null');
  if (known && Date.now() - known.checked < 10 * 60 * 1000) return known.id;
  let meta;
  try { meta = Drive.Files.get(src, { fields: 'id,name,modifiedTime' }); } catch (err) {
    if (known) return known.id;
    throw new Error('The publisher cannot open the PDF. Is it still in Drive, and shared with ' + ownerEmail_() + '?');
  }
  if (known && known.modified === meta.modifiedTime) {
    known.checked = Date.now();
    props.setProperty(key, JSON.stringify(known));
    return known.id;
  }
  let id;
  try {
    id = Drive.Files.copy({ name: meta.name, parents: [folders_().media] }, src).id;
    Drive.Permissions.create({ role: 'reader', type: 'anyone' }, id);
  } catch (err) {
    id = uploadPublic_(DriveApp.getFileById(src).getBlob(), meta.name);
  }
  if (known) trash_([known.id]);
  props.setProperty(key, JSON.stringify({ id: id, modified: meta.modifiedTime, checked: Date.now() }));
  return id;
}

/** "On the website" in the Issues tab. */
function writeIssueNotes_(issues, live) {
  const c = issues.col('On the website');
  if (!issues.tab || !issues.rows.length || c < 1) return;
  const onSite = {};
  (live.issues || []).forEach(function (i) { onSite[i.id] = true; });
  const range = issues.tab.getRange(2, c, issues.rows.length, 1);
  const current = range.getValues();
  let changed = false;
  const next = issues.rows.map(function (r, i) {
    let text = '';
    let link = null;
    if (r.id || r.title) {
      if (r.status !== 'Published') text = 'Not on the website (waiting for review)';
      else if (onSite[r.id]) { link = pageUrl_('/issues/' + r.id + '/'); text = '✓ Live: ' + link + (r.problem ? ' ⚠ ' + r.problem : ''); }
      else text = r.problem ? '⚠ ' + r.problem : 'Publishing the issue and its articles… (about a minute)';
    }
    if (String(current[i][0]) !== text) changed = true;
    const b = SpreadsheetApp.newRichTextValue().setText(text);
    if (link) b.setLinkUrl(text.indexOf(link), text.indexOf(link) + link.length, link);
    return [b.build()];
  });
  if (changed) range.setRichTextValues(next);
}

/** The archive's print issues with the Sheet's: an issue in both is shown as the Sheet has it. */
function mergeIssues_(archive, sheet) {
  const ids = sheet.map(function (i) { return i.id; });
  return archive.filter(function (i) { return ids.indexOf(i.id) < 0; }).concat(sheet);
}

// ---------------------------------------------------------------------------------------------
// Setting up (for the owner, from the script editor: choose the function, then Run)

/** Once: makes the Drive folder and starts the minute-by-minute check. Safe to run again. */
function setUpPublisher() {
  const ss = book_();
  readTable_(ss);
  folders_();
  printFolder_();
  issueTab_(ss);
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; })) ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  return 'The publisher checks the Sheet every minute.';
}

/** Stops the minute-by-minute check (setUpPublisher starts it again). */
function stopPublisher_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
}

/**
 * Once: copies the archive (articles, writers, print issues, pictures and PDFs) into Drive from
 * the website's old repository. Takes a few runs if it runs out of time; safe to run again.
 */
function importArchive() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ARCHIVE_FROM') === IMPORT_FROM && props.getProperty('FILE:archive.json')) return 'The archive is already in Drive.';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return 'Busy; try again in a minute.';
  try {
    const started = Date.now();
    const res = UrlFetchApp.fetch(IMPORT_FROM + 'google-workspace/import/archive.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Could not download the archive (' + res.getResponseCode() + ').');
    const bundle = JSON.parse(res.getContentText('UTF-8'));
    const map = loadJson_('media-map.json') || {};
    for (let i = 0; i < bundle.media.length; i++) {
      const m = bundle.media[i];
      if (map[m.path]) continue;
      if (Date.now() - started > 4.5 * 60 * 1000) return 'Copied ' + Object.keys(map).length + ' of ' + bundle.media.length + ' files so far. Run importArchive again to continue.';
      const file = UrlFetchApp.fetch(IMPORT_FROM + 'public' + m.path, { muteHttpExceptions: true });
      if (file.getResponseCode() !== 200) throw new Error('Could not download ' + m.path + ' (' + file.getResponseCode() + ').');
      const name = m.path.replace(/^\//, '').replace(/\//g, '-');
      map[m.path] = uploadPublic_(file.getBlob().setName(name), name);
      saveJson_('media-map.json', map);
    }
    saveJson_('archive.json', resolveArchive_(bundle, map));
    props.setProperty('ARCHIVE_FROM', IMPORT_FROM);
    setSiteVersion_();
    return 'The archive is in Drive: ' + bundle.articles.length + ' articles and ' + bundle.media.length + ' pictures and PDFs.';
  } finally {
    lock.releaseLock();
  }
}

/** The archive with every picture and PDF pointing at its copy in Drive. */
function resolveArchive_(bundle, map) {
  const ref = function (m) { return m && map[m.path] ? { id: map[m.path], w: m.w || null, h: m.h || null } : null; };
  const brand = {};
  Object.keys(bundle.brand || {}).forEach(function (k) { brand[k] = ref(bundle.brand[k]); });
  const authors = {};
  Object.keys(bundle.authors || {}).forEach(function (slug) {
    const a = bundle.authors[slug];
    authors[slug] = { name: a.name, classYear: a.classYear, bio: a.bio, photo: ref(a.photo), visible: a.visible !== false };
  });
  return {
    version: bundle.version, from: IMPORT_FROM, contactEmail: bundle.contactEmail || null, brand: brand, authors: authors,
    issues: (bundle.issues || []).map(function (i) {
      return { id: i.id, title: i.title, season: i.season, year: i.year, number: i.number, volume: i.volume, dateLabel: i.dateLabel, notes: i.notes || [],
        pdf: i.pdf && map[i.pdf.path] ? { id: map[i.pdf.path] } : null, pages: (i.pages || []).map(ref).filter(Boolean) };
    }),
    articles: (bundle.articles || []).map(function (a) {
      const c = a.cover ? ref(a.cover) : null;
      const out = JSON.parse(JSON.stringify(a));
      out.cover = c ? { id: c.id, w: c.w, h: c.h, alt: a.cover.alt || '', caption: a.cover.caption || null, credit: a.cover.credit || null } : null;
      out.body = String(a.body).replace(/gdrive:(\/[^"?\s]+)\?w=(\d+)/g, function (m, path, w) { return map[path] ? 'https://lh3.googleusercontent.com/d/' + map[path] + '=w' + w : ''; });
      return out;
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The Homepage, Site and Masthead tabs

/** Reads the Homepage, Site and Masthead tabs. A tab that does not exist is left out. */
function readSettings_(ss) {
  const out = {};
  const kv = function (name) {
    const tab = ss.getSheetByName(name);
    if (!tab) return null;
    const map = {};
    tab.getDataRange().getValues().slice(1).forEach(function (r) { if (String(r[0]).trim()) map[String(r[0]).trim()] = String(r[1] == null ? '' : r[1]).trim(); });
    return map;
  };
  const home = kv('Homepage');
  if (home) {
    const list = function (prefix, from, to) { const a = []; for (let i = from; i <= to; i++) { const v = articleId_(home[prefix + ' ' + i]); if (v) a.push(v); } return a; };
    const banner = home['Banner link'] || '';
    out.homepage = {
      lead: articleId_(home['Lead story']) || null,
      secondary: list('Top story', 2, 5),
      editorsPicks: list("Editors' pick", 1, 4),
      currentIssue: /^[a-z0-9-]+$/.test(home['Print issue to promote'] || '') ? home['Print issue to promote'] : null,
      alert: home['Banner text'] ? { text: home['Banner text'].slice(0, 200), href: /^(https:\/\/|\/(?!\/))/.test(banner) ? banner : null } : null,
    };
  }
  const site = kv('Site');
  if (site) {
    const emails = function (v) { const list = String(v || '').split(/[,;\s]+/).filter(Boolean); return list.length && list.length <= 5 && list.every(function (e) { return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e); }) ? list.join(', ') : null; };
    out.site = { contactEmail: emails(site['Contact email']), tipsEmail: emails(site['Tips email']), mastheadYear: site['Masthead school year'] || null };
  }
  const mast = ss.getSheetByName('Masthead');
  if (mast) {
    out.masthead = mast.getDataRange().getValues().slice(1)
      .map(function (r) { return { group: String(r[0]).trim(), name: String(r[1]).trim(), role: String(r[2] == null ? '' : r[2]).trim() }; })
      .filter(function (r) { return r.group && r.name; });
  }
  return out;
}

/** A web address (…/2026/10/09/dummer-cup-2026/ or ?p=…) or an ID -> "2026-10-09-dummer-cup-2026". */
function articleId_(value) {
  let v = String(value || '').trim();
  try { v = decodeURIComponent(v); } catch (err) { /* not encoded */ }
  const m = /(\d{4})\/(\d{2})\/(\d{2})\/([a-z0-9-]+)/.exec(v);
  if (m) return m[1] + '-' + m[2] + '-' + m[3] + '-' + m[4];
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(v) ? v : '';
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function uniqueId_(base, taken) {
  if (!taken[base]) return base;
  for (let n = 2; ; n++) if (!taken[base + '-' + n]) return base + '-' + n;
}

/** The first 16 hex digits of SHA-256. */
function hash_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)).slice(0, 16);
}
function hashBytes_(bytes) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)).slice(0, 12);
}
function hex_(digest) {
  return digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
