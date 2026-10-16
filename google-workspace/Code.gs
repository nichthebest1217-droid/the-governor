/**
 * The Governor: publishing from Google Docs, through this Sheet, to the website.
 *
 * How it fits together
 *   1. Writers write in Google Docs. Editors list each article in the Articles tab and set its
 *      Status: Draft, Ready for Review or Published.
 *   2. Once a minute (after "Turn on instant publishing") this script looks for changes: a row
 *      marked or unmarked Published, an edited row, an edited Doc. When it finds one, it asks
 *      GitHub to update the website.
 *   3. GitHub reads this script's web address, which lists Published articles only, fetches
 *      what changed, checks it, rebuilds the site and publishes it. This script then reads the
 *      site's /publishing-status.json and writes "✓ Live" with the link next to the row.
 *
 * Drafts and articles waiting for review never leave Google: the web address only ever serves
 * Published rows. Nothing here costs money and no Google Cloud project is needed. Fonts, sizes
 * and colours in the Docs are ignored on purpose: the website applies its own typography.
 * Setup and maintenance: google-workspace/SETUP.md in the website's repository.
 */

const SETTINGS = {
  GITHUB_REPO: 'nichthebest1217-droid/the-governor', // the website's repository
  SITE_URL: 'https://nichthebest1217-droid.github.io/the-governor/',
  OWNER_EMAIL: 'nicholas.zhuo@govsacademy.org', // the account that owns this Sheet; Docs are shared with it
};
const WORKFLOW = 'sync-docs.yml'; // .github/workflows/sync-docs.yml: "Publish from the Google Sheet"
const BRANCH = 'main';
const ARTICLES = 'Articles';
const GUIDE = 'How to publish';
const ALL = 'All articles';
const AUTO = 'Filled in automatically by the Sheet';
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
// Columns and statuses of the first version of this Sheet, upgraded by "Set up or repair this Sheet".
const RENAMED = { 'Headline': 'Title', 'Writers': 'Author(s)', 'Section': 'Category', 'Cover photo link': 'Image link', 'Photo description': 'Image description', 'Caption': 'Image caption', 'Photo credit': 'Image credit', 'Print issue ID': 'Print issue', 'Result': 'On the website' };
const OLD_STATUS = { 'Approved': 'Published', 'In edit': 'Ready for Review', 'Hold': 'Draft' };
const DROPPED = ['Web address'];

function setting_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || SETTINGS[key];
}
function siteUrl_() {
  return setting_('SITE_URL').replace(/\/?$/, '/');
}

// ---------------------------------------------------------------------------------------------
// Menu and instant feedback

function onOpen() {
  SpreadsheetApp.getUi().createMenu('The Governor')
    .addItem('Check the Sheet now', 'checkNow')
    .addItem('Turn on instant publishing…', 'showConnectDialog')
    .addSeparator()
    .addItem('Set up or repair this Sheet', 'setUpSheet')
    .addItem('Turn off instant publishing', 'disconnectGitHub')
    .addToUi();
}

/** As soon as a row is edited, say what will happen. The minute-by-minute check confirms it. */
function onEdit(e) {
  try {
    const range = e && e.range;
    if (!range || range.getLastRow() < 2) return;
    const sheet = range.getSheet();
    if (sheet.getName() !== ARTICLES) return;
    const width = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    const webCol = headers.indexOf('On the website') + 1;
    if (!webCol || headers.indexOf('Status') < 0) return;
    if (range.getColumn() === webCol && range.getNumColumns() === 1) return;
    const first = Math.max(2, range.getRow());
    const count = range.getLastRow() - first + 1;
    if (count > 200) return; // a big paste: the regular check catches up within a minute
    const values = sheet.getRange(first, 1, count, width).getValues();
    const links = linkColumns_(sheet, headers, first, count);
    const cells = sheet.getRange(first, webCol, count, 1);
    const current = cells.getValues();
    const instant = instantOn_();
    const today = today_();
    let changed = false;
    const next = values.map(function (v, i) {
      const note = quickNote_(rowFrom_(v, headers, links[i], i + first), String(current[i][0]), instant, today);
      if (note !== current[i][0]) changed = true;
      return [note];
    });
    if (changed) cells.setValues(next);
  } catch (err) {
    // Feedback only; the regular check corrects anything missed.
  }
}

function quickNote_(r, current, instant, today) {
  if (r.blank) return '';
  const wasOnSite = /^(✓|Updating|Taking it off|⚠ The website still shows)/.test(current);
  if (r.status !== 'Published') return wasOnSite ? 'Taking it off the website…' : offNote_(r.status);
  const problem = basicProblems_(r)[0];
  if (problem) return (wasOnSite ? '⚠ The website still shows the earlier version: ' : '⚠ ') + problem;
  if (r.date && r.date > today) return 'Scheduled for ' + longDate_(r.date);
  return (wasOnSite ? 'Updating…' : 'Publishing…') + waitNote_(instant);
}

function offNote_(status) {
  if (status === 'Ready for Review') return 'Not on the website (waiting for review)';
  if (status === 'Draft') return 'Not on the website (draft)';
  return 'Not on the website';
}
function waitNote_(instant) {
  return instant ? ' (usually live within 5 minutes)' : ' (the website checks the Sheet every few hours)';
}
function instantOn_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('INSTANT') === 'on' && !props.getProperty('GITHUB_PROBLEM');
}

// ---------------------------------------------------------------------------------------------
// Reading the Articles tab

function articlesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(ARTICLES) || ss.getSheets()[0];
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

function readTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  HEADERS.forEach(function (h) {
    if (headers.indexOf(h) < 0) throw new Error('The Articles tab has no "' + h + '" column. Use The Governor > Set up or repair this Sheet.');
  });
  const count = values.length - 1;
  const links = linkColumns_(sheet, headers, 2, count);
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(rowFrom_(values[i + 1], headers, links[i], i + 2));
  return { headers: headers, rows: rows, col: function (name) { return headers.indexOf(name) + 1; } };
}

function rowFrom_(v, headers, links, rowNumber) {
  const raw = function (name) { const i = headers.indexOf(name); return i < 0 || v[i] == null ? '' : v[i]; };
  const text = function (name) { return String(raw(name)).trim(); };
  const docCell = text('Google Doc link');
  const docLink = (links && links['Google Doc link']) || docCell;
  const imageCell = text('Image link');
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
    imageLink: (links && links['Image link']) || imageCell,
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

/** Changes whenever anything that shows on the website changes, including the Doc's text. */
function revision_(r) {
  return hash_(JSON.stringify([r.title, r.authors, r.category, r.date, r.description, r.imageLink, r.imageAlt, r.imageCaption,
    r.imageCredit, r.type, r.issue, r.order, r.correction, r.text, r.docId, r.docVersion || '']));
}

/** What the website receives for one article. The Doc's address stays private. */
function publicRecord_(r) {
  return {
    id: r.id, revision: r.revision, title: r.title, authors: r.authors, section: CATEGORIES[r.category], date: r.date,
    kind: r.type === 'Editorial' ? 'editorial' : 'article', description: r.description,
    image: r.imageLink ? { alt: r.imageAlt, caption: r.imageCaption, credit: r.imageCredit } : null,
    issue: r.issue, order: r.order, correction: r.correction, source: r.docId ? 'doc' : 'text',
  };
}

/**
 * When each Doc was last edited, whether this account can open it, and whether anyone with its
 * link may edit it. Edit times are remembered; each run asks Drive only for Docs edited since the
 * last run, and looks every Doc up again once an hour.
 */
function docInfo_(ids) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  const full = now - Number(all.DOCS_FULL_SCAN || 0) > 60 * 60 * 1000;
  const fresh = {};
  if (!full && all.DOCS_SCAN && ids.length) {
    try {
      const since = new Date(Number(all.DOCS_SCAN) - 5 * 60 * 1000);
      const found = DriveApp.searchFiles("modifiedDate > '" + Utilities.formatDate(since, 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + "' and mimeType = 'application/vnd.google-apps.document'");
      while (found.hasNext()) { const f = found.next(); fresh[f.getId()] = f; }
    } catch (err) { /* look each Doc up instead */ }
  }
  const out = {};
  const updates = {};
  ids.forEach(function (id) {
    const cached = all['DOC:' + id];
    if (cached && !full && !fresh[id]) out[id] = JSON.parse(cached);
    else out[id] = lookUpDoc_(id, fresh[id], updates);
  });
  updates.DOCS_SCAN = String(now);
  if (full) {
    updates.DOCS_FULL_SCAN = String(now);
    Object.keys(all).forEach(function (k) { if (k.indexOf('DOC:') === 0 && ids.indexOf(k.slice(4)) < 0) props.deleteProperty(k); });
  }
  props.setProperties(updates);
  return out;
}

/** One Doc, as the last regular check saw it (so its revision matches the list GitHub just read). */
function docInfoFor_(id) {
  const cached = PropertiesService.getScriptProperties().getProperty('DOC:' + id);
  if (cached) return JSON.parse(cached);
  const updates = {};
  const info = lookUpDoc_(id, null, updates);
  PropertiesService.getScriptProperties().setProperties(updates);
  return info;
}

function lookUpDoc_(id, file, updates) {
  let info;
  try {
    const f = file || DriveApp.getFileById(id);
    info = { version: f.getLastUpdated().toISOString(), mime: f.getMimeType() };
    try {
      const access = f.getSharingAccess();
      info.publicEdit = f.getSharingPermission() === DriveApp.Permission.EDIT && (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK);
    } catch (err) { /* sharing details are not available for every file */ }
    updates['DOC:' + id] = JSON.stringify(info);
  } catch (err) {
    return { error: "The Sheet can't open this Doc. Share it with " + setting_('OWNER_EMAIL') + ' (Viewer is enough).' };
  }
  if (info.mime !== 'application/vnd.google-apps.document') info.error = 'The Google Doc link points to a file that is not a Google Doc. Open it, use File > Save as Google Docs, and paste the new link.';
  return info;
}

// ---------------------------------------------------------------------------------------------
// The regular check

/**
 * Checks every Published row, fills in the ID and date of rows that are ready, works out what
 * the website should show, writes the "On the website" column, and returns the list GitHub
 * publishes from.
 */
function refresh_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = articlesSheet_();
  const t = readTable_(sheet);
  const today = today_();
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();

  // IDs are kept for good, so an article's web address never changes by accident.
  const taken = {};
  const idCells = [];
  const dateCells = [];
  t.rows.forEach(function (r) {
    if (!r.id) return;
    if (taken[r.id] || !/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id)) { r.id = ''; idCells.push(r); } // a copied row gets its own ID
    else taken[r.id] = true;
  });

  // Check each Published row.
  const docIds = [];
  t.rows.forEach(function (r) { if (r.status === 'Published' && r.docId && docIds.indexOf(r.docId) < 0) docIds.push(r.docId); });
  const docs = docInfo_(docIds);
  const index = { version: 2, generatedAt: new Date(now).toISOString(), fingerprint: '', articles: [], held: [], problems: [], settings: null };
  t.rows.forEach(function (r) {
    r.problems = [];
    r.warnings = [];
    if (r.status !== 'Published') return;
    r.problems = basicProblems_(r);
    if (r.docId) {
      const d = docs[r.docId];
      if (d.error) r.problems.push(d.error);
      else {
        r.docVersion = d.version;
        if (d.publicEdit) r.warnings.push("anyone with the Doc's link can edit it, and edits go live; set its sharing to Restricted");
      }
    }
    if (r.problems.length) {
      index.problems.push({ row: r.row, title: r.title, message: r.problems[0] });
      if (r.id) index.held.push(r.id); // keep whatever version is live until the row is fixed
      return;
    }
    // Ready to go: an empty date becomes today, and the row gets its ID (from the date and title).
    if (!r.date) { r.date = today; dateCells.push(r); }
    if (!r.id) { r.id = uniqueId_(r.date + '-' + (slugify_(r.title) || 'article'), taken); taken[r.id] = true; if (idCells.indexOf(r) < 0) idCells.push(r); }
    r.scheduled = r.date > today;
    if (!r.scheduled) {
      r.revision = revision_(r);
      index.articles.push(publicRecord_(r));
    }
  });
  idCells.forEach(function (r) { sheet.getRange(r.row, t.col('ID')).setValue(r.id); });
  dateCells.forEach(function (r) { sheet.getRange(r.row, t.col('Publication date')).setValue(new Date(r.date + 'T12:00:00')); });
  index.settings = readSettings_();
  index.fingerprint = hash_(JSON.stringify([index.articles.map(function (a) { return a.id + ':' + a.revision; }), index.held, index.settings]));

  // What the website shows now, and the "On the website" column.
  const live = fetchLiveStatus_();
  let waitingSince = 0;
  if (live) {
    const waiting = JSON.parse(props.getProperty('WAITING') || '{}');
    const stillWaiting = {};
    const instant = instantOn_();
    const notes = t.rows.map(function (r) {
      const note = noteFor_(r, live, waiting, now, instant);
      if (note.waiting && r.id) {
        stillWaiting[r.id] = waiting[r.id] || now;
        if (!waitingSince || stillWaiting[r.id] < waitingSince) waitingSince = stillWaiting[r.id];
      }
      return note;
    });
    props.setProperty('WAITING', JSON.stringify(stillWaiting));
    writeNotes_(sheet, t, notes);
    writeAllArticles_(ss, live);
  }
  writeGuideStatus_(ss);
  return { index: index, waitingSince: waitingSince, problemCount: index.problems.length };
}

function noteFor_(r, live, waiting, now, instant) {
  if (r.blank) return { text: '' };
  const onSite = !!(r.id && live.sheet[r.id]);
  if (r.status !== 'Published') return onSite ? { text: 'Taking it off the website…', waiting: true } : { text: offNote_(r.status) };
  if (r.problems.length) return { text: (onSite ? '⚠ The website still shows the earlier version: ' : '⚠ ') + r.problems[0] };
  if (r.scheduled) return { text: 'Scheduled for ' + longDate_(r.date) + (onSite ? ' (off the website until then)' : '') };
  if (onSite && live.sheet[r.id].revision === r.revision) {
    const url = live.sheet[r.id].url;
    return { text: '✓ Live: ' + url + (r.warnings.length ? '   ⚠ ' + r.warnings[0] : ''), link: url };
  }
  const error = live.errors[r.id];
  if (error && error.revision === r.revision) return { text: '⚠ The website could not publish this version: ' + error.message };
  let text = (onSite ? 'Updating…' : 'Publishing…') + waitNote_(instant);
  if (waiting[r.id] && now - waiting[r.id] > 30 * 60 * 1000) text += ' This is taking longer than usual: tell the web editor.';
  return { text: text, waiting: true };
}

/** The site's /publishing-status.json, or null when the site cannot be reached. */
function fetchLiveStatus_() {
  try {
    const res = UrlFetchApp.fetch(siteUrl_() + 'publishing-status.json?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() === 404) return { sheet: {}, errors: {}, all: null, builtAt: '' }; // before the first publish
    if (res.getResponseCode() !== 200) return null;
    const data = JSON.parse(res.getContentText('UTF-8'));
    return { sheet: data.sheet || {}, errors: data.errors || {}, all: data.all || null, builtAt: data.builtAt || '' };
  } catch (err) {
    return null;
  }
}

function writeNotes_(sheet, t, notes) {
  if (!notes.length) return;
  const range = sheet.getRange(2, t.col('On the website'), notes.length, 1);
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

function writeAllArticles_(ss, live) {
  if (!live.all || !live.builtAt) return;
  const props = PropertiesService.getScriptProperties();
  let tab = ss.getSheetByName(ALL);
  if (tab && props.getProperty('ALL_BUILT') === live.builtAt) return;
  if (!tab) {
    tab = ss.insertSheet(ALL);
    tab.protect().setDescription(AUTO).setWarningOnly(true);
    tab.setFrozenRows(1);
    [110, 380, 130, 260, 420, 110].forEach(function (w, i) { tab.setColumnWidth(i + 1, w); });
  }
  const rows = [['Date', 'Title', 'Category', 'Author(s)', 'Web address', 'From this Sheet']].concat(live.all.map(function (a) {
    return [a.date, a.title, a.section, a.authors, a.url, a.fromSheet ? 'Yes' : ''];
  }));
  if (tab.getMaxRows() < rows.length + 1) tab.insertRowsAfter(tab.getMaxRows(), rows.length + 1 - tab.getMaxRows());
  tab.clearContents();
  tab.getRange(1, 1, rows.length, 6).setValues(rows);
  tab.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#141312').setFontColor('#ffffff');
  props.setProperty('ALL_BUILT', live.builtAt);
}

// ---------------------------------------------------------------------------------------------
// The web address GitHub reads

/**
 * No parameters: the list of Published articles (and the Homepage, Site and Masthead tabs).
 * ?article=ID&rev=REVISION: that article's text. Add &image=REF (or &image=cover) for a picture.
 * Only Published rows are ever served.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.article) return json_(articleContent_(String(p.article), String(p.rev || ''), p.image ? String(p.image) : ''));
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { return json_(refresh_().index); } finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function articleContent_(id, rev, image) {
  const t = readTable_(articlesSheet_());
  const r = t.rows.filter(function (x) { return x.id === id && x.status === 'Published'; })[0];
  if (!r || !r.date || r.date > today_()) return { ok: false, error: 'not-published' };
  const problems = basicProblems_(r);
  if (r.docId) {
    const d = docInfoFor_(r.docId);
    if (d.error) problems.push(d.error);
    else r.docVersion = d.version;
  }
  if (problems.length) return { ok: false, error: problems[0] };
  r.revision = revision_(r);
  if (rev && rev !== r.revision) return { ok: false, error: 'changed' };
  if (image === 'cover') return coverImage_(r);
  if (!r.docId) return { ok: true, id: id, revision: r.revision, source: 'text', markdown: r.text };
  const doc = exportDoc_(r.docId);
  if (image) {
    const img = doc.images[image];
    return img ? { ok: true, ref: image, mime: img.mime, base64: img.data } : { ok: false, error: 'A picture in the Doc could not be read.' };
  }
  return { ok: true, id: id, revision: r.revision, source: 'doc', markdown: doc.markdown, images: Object.keys(doc.images) };
}

/** The Doc as Markdown, with its pictures taken out and returned separately. */
function exportDoc_(docId) {
  const res = UrlFetchApp.fetch('https://docs.google.com/document/d/' + docId + '/export?format=md', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Could not read the Doc (Google answered ' + res.getResponseCode() + ').');
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

function coverImage_(r) {
  if (!r.imageLink) return { ok: false, error: 'There is no Image link.' };
  const drive = driveId_(r.imageLink);
  // From Drive: a 2,000-pixel copy, sharp on any screen. The full-size original stays in Drive.
  const res = drive
    ? UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + drive + '&sz=w2000', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true })
    : UrlFetchApp.fetch(r.imageLink, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'The picture at the Image link could not be downloaded (' + res.getResponseCode() + '). Is it shared with ' + setting_('OWNER_EMAIL') + '?' };
  const blob = res.getBlob();
  if (!/^image\//.test(blob.getContentType())) return { ok: false, error: 'The Image link does not point to a picture.' };
  return { ok: true, ref: 'cover', mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------------------------------------------------------------------------------------------
// Telling GitHub to update the website (instant publishing)

/** Runs every minute once instant publishing is on. */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    maybeDispatch_(refresh_(), false);
  } finally {
    lock.releaseLock();
  }
}

/** Menu: check every row now (and start a website update if anything changed). */
function checkNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { toast_('The Sheet is busy checking. Try again in a minute.'); return; }
  try {
    const result = refresh_();
    const sent = maybeDispatch_(result, true);
    toast_(result.index.articles.length + ' published, ' + result.problemCount + ' need attention.' + (sent === 'sent' ? ' The website is updating.' : sent === 'off' ? ' (Instant publishing is off.)' : ''));
  } finally {
    lock.releaseLock();
  }
}

function maybeDispatch_(result, force) {
  const key = PropertiesService.getUserProperties().getProperty('GITHUB_KEY');
  if (!key) return 'off';
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  const lastAt = Number(all.DISPATCHED_AT || 0);
  const changed = result.index.fingerprint !== (all.DISPATCHED || '');
  const retries = Number(all.RETRIES || 0);
  // Nothing new, but a change has waited 15 minutes: ask again (at most three times).
  const retry = !changed && result.waitingSince && now - result.waitingSince > 15 * 60 * 1000 && now - lastAt > 15 * 60 * 1000 && retries < 3;
  if (!changed && !retry && !force) return 'idle';
  if (now - lastAt < 45 * 1000) return 'wait';
  const sent = dispatch_(key);
  if (!sent.ok) {
    props.setProperty('GITHUB_PROBLEM', sent.message);
    writeGuideStatus_(SpreadsheetApp.getActiveSpreadsheet());
    return 'error';
  }
  props.setProperties({ DISPATCHED: result.index.fingerprint, DISPATCHED_AT: String(now), RETRIES: String(changed ? 0 : retries + 1), GITHUB_PROBLEM: '' });
  return 'sent';
}

function dispatch_(key) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + setting_('GITHUB_REPO') + '/actions/workflows/' + WORKFLOW + '/dispatches', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ ref: BRANCH }), headers: githubHeaders_(key), muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 204) return { ok: true };
  if (code === 401) return { ok: false, message: 'GitHub no longer accepts the key (it expired or was deleted).' };
  if (code === 403) return { ok: false, message: 'The GitHub key is not allowed to start website updates (it needs Actions: Read and write).' };
  if (code === 404) return { ok: false, message: 'The GitHub key cannot see the website\'s repository (' + setting_('GITHUB_REPO') + ').' };
  return { ok: false, message: 'GitHub answered ' + code + '.' };
}

function githubHeaders_(key) {
  return { Authorization: 'Bearer ' + key, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

/** Menu: the window where the Sheet's owner pastes a GitHub key, once. */
function showConnectDialog() {
  const owner = setting_('GITHUB_REPO').split('/')[0];
  const keyPage = 'https://github.com/settings/personal-access-tokens/new?name=The+Governor+publishing+Sheet'
    + '&description=Lets+the+Google+Sheet+start+the+website+update.&target_name=' + encodeURIComponent(owner) + '&expires_in=none&actions=write';
  const html = '<style>body{font:14px/1.5 Arial,sans-serif;color:#222;margin:0 6px}ol{padding-left:20px}li{margin:9px 0}'
    + 'input{width:100%;padding:9px;font:13px monospace;box-sizing:border-box;border:1px solid #bbb;border-radius:4px}'
    + 'button{background:#9b1b30;color:#fff;border:0;border-radius:4px;padding:9px 18px;font-weight:bold;cursor:pointer}'
    + 'button:disabled{opacity:.5}a{color:#9b1b30;font-weight:bold}.err{color:#a50e0e}.ok{color:#1e7b34;font-weight:bold}</style>'
    + '<p>Without this, the website looks at the Sheet only every few hours. With it, the Sheet tells the website to update as soon as something changes, and articles go live within about five minutes.</p>'
    + '<ol><li><a href="' + keyPage + '" target="_blank">Open GitHub to create a key</a> (sign in as the owner of the website\'s repository). GitHub fills in the name and the one permission needed, <b>Actions: Read and write</b>.</li>'
    + '<li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <b>' + setting_('GITHUB_REPO').split('/')[1] + '</b>. Click <b>Generate token</b> and copy it.</li>'
    + '<li>Paste it here and click <b>Connect</b>.</li></ol>'
    + '<input id="key" type="password" placeholder="github_pat_…" autocomplete="off"><p><button id="go">Connect</button></p><p id="msg"></p>'
    + '<script>document.getElementById("go").onclick=function(){var b=this,m=document.getElementById("msg"),k=document.getElementById("key");'
    + 'b.disabled=true;m.className="";m.textContent="Checking the key with GitHub…";'
    + 'google.script.run.withSuccessHandler(function(t){m.className="ok";m.textContent=t;k.value="";b.disabled=false;})'
    + '.withFailureHandler(function(e){m.className="err";m.textContent=e.message||String(e);b.disabled=false;}).connectGitHub(k.value);};</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(430), 'Turn on instant publishing');
}

/** Called by the window above. The key is kept in the owner's private script storage, never in the Sheet. */
function connectGitHub(key) {
  key = String(key || '').trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(key)) throw new Error('That does not look like a GitHub key. It starts with github_pat_.');
  const check = UrlFetchApp.fetch('https://api.github.com/repos/' + setting_('GITHUB_REPO') + '/actions/workflows/' + WORKFLOW, { headers: githubHeaders_(key), muteHttpExceptions: true });
  const code = check.getResponseCode();
  if (code === 401) throw new Error('GitHub did not accept this key. Copy it again: it starts with github_pat_.');
  if (code === 404) throw new Error('This key cannot see ' + setting_('GITHUB_REPO') + '. On GitHub, edit the key: Repository access > Only select repositories > ' + setting_('GITHUB_REPO').split('/')[1] + '.');
  if (code !== 200) throw new Error('GitHub answered ' + code + '. Try again in a minute.');
  const sent = dispatch_(key);
  if (!sent.ok) throw new Error(sent.message);
  PropertiesService.getUserProperties().setProperty('GITHUB_KEY', key);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().setProperties({ INSTANT: 'on', INSTANT_SINCE: today_(), GITHUB_PROBLEM: '' });
  writeGuideStatus_(SpreadsheetApp.getActiveSpreadsheet());
  return 'Connected. From now on the website updates within about five minutes of every change. You can close this window.';
}

function disconnectGitHub() {
  PropertiesService.getUserProperties().deleteProperty('GITHUB_KEY');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  PropertiesService.getScriptProperties().setProperty('INSTANT', 'off');
  writeGuideStatus_(SpreadsheetApp.getActiveSpreadsheet());
  toast_('Instant publishing is off. The website will check the Sheet every few hours.');
}

// ---------------------------------------------------------------------------------------------
// Setting up the Sheet

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
  keyValueTab_(ss, 'Homepage', HOME_ROWS);
  keyValueTab_(ss, 'Site', SITE_ROWS);
  if (!ss.getSheetByName('Masthead')) {
    const m = ss.insertSheet('Masthead');
    m.getRange(1, 1, 1, 3).setValues([['Group', 'Name', 'Role (optional)']]).setFontWeight('bold');
    m.setFrozenRows(1);
  }
  writeGuide_(ss);
  ss.setActiveSheet(sheet);
  toast_('The Sheet is set up.');
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
    sheet.getRange(1, i + 1).setNote(c[2].replace('OWNER', setting_('OWNER_EMAIL')));
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

const GUIDE_STATUS_ROW = 3;
function writeGuide_(ss) {
  const tab = ss.getSheetByName(GUIDE) || ss.insertSheet(GUIDE, 1);
  const owner = setting_('OWNER_EMAIL');
  const lines = [
    ['h1', "How to publish on The Governor's website"],
    ['p', ''],
    ['status', ''],
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
  });
  tab.setColumnWidth(1, 900);
  tab.setHiddenGridlines(true);
  tab.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  tab.protect().setDescription(AUTO).setWarningOnly(true);
  writeGuideStatus_(ss, true);
}

function writeGuideStatus_(ss, force) {
  const tab = ss.getSheetByName(GUIDE);
  if (!tab) return;
  const props = PropertiesService.getScriptProperties();
  const problem = props.getProperty('GITHUB_PROBLEM');
  let text;
  let color = '#1e7b34';
  if (props.getProperty('INSTANT') === 'on' && !problem) text = 'Instant publishing is ON: the website updates about five minutes after each change.';
  else if (props.getProperty('INSTANT') === 'on') { text = '⚠ Instant publishing stopped: ' + problem + ' Until it is fixed, the website checks the Sheet only every few hours. To fix it, the Sheet\'s owner uses The Governor menu > Turn on instant publishing.'; color = '#a50e0e'; }
  else { text = 'Instant publishing is OFF: the website checks this Sheet only every few hours. To make it update within minutes, the Sheet\'s owner uses The Governor menu > Turn on instant publishing (once).'; color = '#7a4f00'; }
  const cell = tab.getRange(GUIDE_STATUS_ROW, 1);
  if (!force && cell.getValue() === text) return;
  cell.setValue(text).setFontColor(color).setFontWeight('bold');
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
  ['Contact email', 'Shown on the Contact, Corrections and Join pages. Several addresses may be separated by commas.'],
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

/** Reads the Homepage, Site and Masthead tabs. A tab that does not exist is left out. */
function readSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    out.homepage = {
      lead: articleId_(home['Lead story']) || null,
      secondary: list('Top story', 2, 5),
      editorsPicks: list("Editors' pick", 1, 4),
      currentIssue: home['Print issue to promote'] || null,
      alert: home['Banner text'] ? { text: home['Banner text'], href: home['Banner link'] || null } : null,
    };
  }
  const site = kv('Site');
  if (site) out.site = { contactEmail: site['Contact email'] || null, tipsEmail: site['Tips email'] || null, mastheadYear: site['Masthead school year'] || null };
  const mast = ss.getSheetByName('Masthead');
  if (mast) {
    out.masthead = mast.getDataRange().getValues().slice(1)
      .map(function (r) { return { group: String(r[0]).trim(), name: String(r[1]).trim(), role: String(r[2] == null ? '' : r[2]).trim() }; })
      .filter(function (r) { return r.group && r.name; });
  }
  return out;
}

/** "https://.../2026/10/09/dummer-cup-2026/" or "2026-10-09-dummer-cup-2026" -> "2026-10-09-dummer-cup-2026". */
function articleId_(value) {
  const v = String(value || '').trim();
  const m = /(\d{4})\/(\d{2})\/(\d{2})\/([a-z0-9-]+)/.exec(v);
  if (m) return m[1] + '-' + m[2] + '-' + m[3] + '-' + m[4];
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(v) ? v : '';
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function slugify_(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

function uniqueId_(base, taken) {
  if (!taken[base]) return base;
  for (let n = 2; ; n++) if (!taken[base + '-' + n]) return base + '-' + n;
}

function idFromLink_(link) {
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(link) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(link) || /^([A-Za-z0-9_-]{25,})$/.exec(link);
  return m ? m[1] : '';
}

/** The file ID of a Google Drive link (or of a bare file ID), or '' for any other address. */
function driveId_(link) {
  return /^https:\/\/(drive|docs)\.google\.com\//.test(link) || /^[A-Za-z0-9_-]{25,}$/.test(link) ? idFromLink_(link) : '';
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 16);
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function longDate_(day) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[Number(day.slice(5, 7)) - 1] + ' ' + Number(day.slice(8, 10)) + ', ' + day.slice(0, 4);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function toast_(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'The Governor', 8);
}
