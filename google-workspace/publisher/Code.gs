/**
 * The Governor publisher: publishing from the Sheet to the website.
 *
 * A standalone Apps Script project ("The Governor publisher") that only the Sheet's owner can open.
 * It runs as the owner, so it is deliberately kept out of the Sheet: anyone who can edit the Sheet
 * can edit the Sheet's own script, but not this one.
 *
 *   1. Every minute (tick) it reads the Articles tab, gives rows that are ready to publish an ID
 *      and a date, notices edited rows and edited Docs, and writes the "On the website" column
 *      from the site's /publishing-status.json. When something changed and the owner has added a
 *      GitHub key (Script Properties: GITHUB_KEY), it asks GitHub to update the website.
 *   2. Its web address (doGet) is what GitHub reads: the list of Published articles, then each
 *      changed article's text and pictures, one at a time. It serves Published rows only, never
 *      shows a Doc's address, and changes nothing in the Sheet.
 *
 * Setup and maintenance: google-workspace/SETUP.md in the website's repository.
 */

const SETTINGS = {
  SHEET_ID: '1n8o4n_5bSl9TOet1IvaAt7pl5FXxLWKiYek6i_2Xbsc', // "The Governor: Publication"
  GITHUB_REPO: 'nichthebest1217-droid/the-governor', // the website's repository
  SITE_URL: 'https://nichthebest1217-droid.github.io/the-governor/',
};
const WORKFLOW = 'sync-docs.yml'; // .github/workflows/sync-docs.yml: "Publish from the Google Sheet"
const BRANCH = 'main';

// ===== Shared with sheet/Code.gs: keep this block identical in both files (a test checks). =====
const ARTICLES = 'Articles';
const GUIDE = 'How to publish';
const ALL = 'All articles';
const AUTO = 'Filled in automatically by the Sheet';
const GUIDE_STATUS_ROW = 3;
const INSTANT_ON = 'Instant publishing is ON';
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
  return instant ? ' (usually live within 5 minutes)' : ' (the website checks the Sheet every few hours)';
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
function siteUrl_() {
  return setting_('SITE_URL').replace(/\/?$/, '/');
}
function book_() {
  return SpreadsheetApp.openById(setting_('SHEET_ID'));
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
 * Which rows the website should show. Published rows that are ready go in `articles`. Rows that
 * were published but now have a problem are `held` (the live version stays); rows that are not
 * Published, or are scheduled for later, are `unpublished`. Those two lists hold scrambled IDs
 * (hashes), so the public list never reveals the headline of anything not yet published.
 */
function assess_(ss, t, docs, today) {
  const index = { version: 2, generatedAt: new Date().toISOString(), fingerprint: '', articles: [], held: [], unpublished: [], settings: null };
  t.rows.forEach(function (r) {
    r.problems = [];
    r.warnings = [];
    r.scheduled = false;
    if (r.blank) return;
    if (r.status !== 'Published') { if (r.id) index.unpublished.push(hash_(r.id)); return; }
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
    if (r.problems.length) { index.held.push(hash_(r.id)); return; }
    r.date = goLiveDate_(r, today);
    r.scheduled = r.date > today;
    if (r.scheduled) { index.unpublished.push(hash_(r.id)); return; }
    r.revision = revision_(r);
    index.articles.push(publicRecord_(r));
  });
  index.articles.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  index.held.sort();
  index.unpublished.sort();
  index.settings = readSettings_(ss);
  index.fingerprint = hash_(JSON.stringify([index.articles.map(function (a) { return a.id + ':' + a.revision; }), index.held, index.unpublished, index.settings]));
  return index;
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

/** One Doc, as the last regular check saw it (so its revision matches the list GitHub just read). */
function docInfoFor_(id) {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('DOC:' + id);
  if (cached) return JSON.parse(cached);
  const updates = {};
  const info = lookUpDoc_(id, null, updates);
  if (Object.keys(updates).length) props.setProperties(updates);
  return info;
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
// The minute-by-minute check

/** Runs every minute (installed by setUpPublisher). */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    maybeDispatch_(refresh_(), false);
  } finally {
    lock.releaseLock();
  }
}

/** For the owner, from the script editor: check now and update the website even if nothing changed. */
function publishNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Logger.log('GitHub: ' + maybeDispatch_(refresh_(), true));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Gives rows that are ready an ID and a date, checks every Published row, writes the "On the
 * website" column, and returns the list GitHub publishes from.
 */
function refresh_() {
  const ss = book_();
  const t = readTable_(ss);
  const today = today_();
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();

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
  const index = assess_(ss, t, docInfo_(docIds), today);

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
    if (sameRows_(t)) writeNotes_(t, notes);
    writeAllArticles_(ss, live);
  }
  writeGuideStatus_(ss, live);
  props.setProperty('LAST_TICK', String(now));
  return { index: index, waitingSince: waitingSince };
}

/** False when rows were added, removed or moved since the Sheet was read: the notes wait a minute. */
function sameRows_(t) {
  if (!t.rows.length) return true;
  const titles = t.sheet.getRange(2, t.col('Title'), t.rows.length, 1).getValues();
  return t.rows.every(function (r, i) { return String(titles[i][0]).trim().replace(/\s+/g, ' ') === r.title; });
}

function noteFor_(r, live, waiting, now, instant) {
  if (r.blank) return { text: '' };
  const onSite = !!(r.id && live.sheet[r.id]);
  if (r.status !== 'Published') return onSite ? { text: 'Taking it off the website…', waiting: true } : { text: offNote_(r.status) };
  if (r.problems.length) return { text: (onSite ? '⚠ The website still shows the earlier version: ' : '⚠ ') + r.problems[0] };
  if (r.scheduled) return onSite ? { text: 'Scheduled for ' + longDate_(r.date) + ' (taking it off the website until then)', waiting: true } : { text: 'Scheduled for ' + longDate_(r.date) };
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
    if (res.getResponseCode() === 404) return { sheet: {}, errors: {}, warnings: [], all: null, builtAt: '' }; // before the first publish
    if (res.getResponseCode() !== 200) return null;
    const data = JSON.parse(res.getContentText('UTF-8'));
    return { sheet: data.sheet || {}, errors: data.errors || {}, warnings: data.warnings || [], all: data.all || null, builtAt: data.builtAt || '' };
  } catch (err) {
    return null;
  }
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

/** The line at the top of the How to publish tab, and any notes from the website under it. */
function writeGuideStatus_(ss, live) {
  const tab = ss.getSheetByName(GUIDE);
  if (!tab) return;
  const props = PropertiesService.getScriptProperties();
  const problem = props.getProperty('GITHUB_PROBLEM');
  let text;
  let color = '#1e7b34';
  if (instantOn_()) text = INSTANT_ON + ': the website updates about five minutes after each change.';
  else if (props.getProperty('GITHUB_KEY') && problem) {
    text = '⚠ Instant publishing stopped: ' + problem + ' Until it is fixed, the website checks the Sheet only every few hours. The Sheet\'s owner can fix it by putting a new GitHub key in the publisher script (google-workspace/SETUP.md).';
    color = '#a50e0e';
  } else {
    text = 'Instant publishing is OFF: the website checks this Sheet only every few hours. To make it update within minutes, the Sheet\'s owner adds a GitHub key to the publisher script, once (google-workspace/SETUP.md).';
    color = '#7a4f00';
  }
  const status = tab.getRange(GUIDE_STATUS_ROW, 1);
  if (status.getValue() !== text) status.setValue(text).setFontColor(color).setFontWeight('bold');
  if (!live) return;
  const notes = live.warnings.length ? 'Notes from the website: ' + live.warnings.join(' ') : '';
  const cell = tab.getRange(GUIDE_STATUS_ROW + 1, 1);
  if (cell.getValue() !== notes) cell.setValue(notes).setFontColor('#a50e0e');
}

// ---------------------------------------------------------------------------------------------
// The web address GitHub reads. It changes nothing in the Sheet.

/**
 * No parameters: the list of Published articles (and the Homepage, Site and Masthead tabs).
 * ?article=ID&rev=REVISION: that article's text. Add &image=REF (or &image=cover) for one picture.
 * An answer with retry: true means "try again on the next run".
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.article) return json_(articleContent_(String(p.article), String(p.rev || ''), p.image ? String(p.image) : ''));
    const ss = book_();
    const t = readTable_(ss);
    const docs = {};
    t.rows.forEach(function (r) { if (r.status === 'Published' && r.docId && !docs[r.docId]) docs[r.docId] = docInfoFor_(r.docId); });
    return json_(assess_(ss, t, docs, today_()));
  } catch (err) {
    return json_({ ok: false, retry: true, error: String((err && err.message) || err) });
  }
}

function articleContent_(id, rev, image) {
  if (!throttle_(id)) return { ok: false, retry: true, error: 'busy' };
  const ss = book_();
  const t = readTable_(ss);
  const r = t.rows.filter(function (x) { return x.id === id && x.status === 'Published'; })[0];
  const today = today_();
  if (!r || goLiveDate_(r, today) > today) return { ok: false, retry: true, error: 'not-published' };
  const docs = {};
  if (r.docId) docs[r.docId] = docInfoFor_(r.docId);
  const index = assess_(ss, { rows: [r] }, docs, today);
  if (!index.articles.length) return { ok: false, error: r.problems[0] || 'not-published' };
  if (rev && rev !== r.revision) return { ok: false, retry: true, error: 'changed' };
  if (image === 'cover') return coverImage_(r);
  if (!r.docId) return { ok: true, id: id, revision: r.revision, source: 'text', markdown: r.text };
  const doc = exportDoc_(r.docId);
  if (!doc.ok) return doc;
  if (image) {
    const img = doc.images[image];
    return img ? { ok: true, ref: image, mime: img.mime, base64: img.data } : { ok: false, error: 'A picture in the Doc could not be read.' };
  }
  return { ok: true, id: id, revision: r.revision, source: 'doc', markdown: doc.markdown, images: Object.keys(doc.images) };
}

/** At most 150 requests per article in ten minutes, so nobody can use up the owner's daily allowance. */
function throttle_(id) {
  const cache = CacheService.getScriptCache();
  const key = 'n:' + hash_(id);
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 600);
  return n <= 150;
}

/** The Doc as Markdown, with its pictures taken out and returned separately. */
function exportDoc_(docId) {
  const res = UrlFetchApp.fetch('https://docs.google.com/document/d/' + docId + '/export?format=md', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) return { ok: false, retry: code === 429 || code >= 500, error: 'Could not read the Doc (Google answered ' + code + ').' };
  const out = splitImages_(res.getContentText('UTF-8'));
  out.ok = true;
  return out;
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
  const drive = driveId_(r.imageLink);
  // From Drive: a 2,000-pixel copy, sharp on any screen. The full-size original stays in Drive.
  const res = drive
    ? UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + drive + '&sz=w2000', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true })
    : UrlFetchApp.fetch(r.imageLink, { muteHttpExceptions: true, followRedirects: true });
  const code = res.getResponseCode();
  if (code !== 200) return { ok: false, retry: code === 429 || code >= 500, error: 'The picture at the Image link could not be downloaded (' + code + '). Is it shared with ' + ownerEmail_() + '?' };
  const blob = res.getBlob();
  if (!/^image\//.test(blob.getContentType())) return { ok: false, error: 'The Image link does not point to a picture.' };
  return { ok: true, ref: 'cover', mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------------------------------------------------------------------------------------------
// Telling GitHub to update the website

function maybeDispatch_(result, force) {
  const props = PropertiesService.getScriptProperties();
  const key = String(props.getProperty('GITHUB_KEY') || '').trim();
  if (!key) return 'off';
  if (!keyWorks_(key)) return 'error';
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
    props.setProperties({ GITHUB_PROBLEM: sent.message, KEY_CHECKED: '' });
    return 'error';
  }
  props.setProperties({ DISPATCHED: result.index.fingerprint, DISPATCHED_AT: String(now), RETRIES: String(changed ? 0 : retries + 1), GITHUB_PROBLEM: '' });
  return 'sent';
}

/** Checks a new key with GitHub once (and again whenever it is replaced). */
function keyWorks_(key) {
  const props = PropertiesService.getScriptProperties();
  const id = hash_(key);
  if (props.getProperty('KEY_CHECKED') === id) return true;
  if (props.getProperty('KEY_FAILED') === id) return false;
  let problem = '';
  if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(key)) problem = 'The GitHub key is not a fine-grained key (it should start with github_pat_).';
  else {
    const res = UrlFetchApp.fetch('https://api.github.com/repos/' + setting_('GITHUB_REPO') + '/actions/workflows/' + WORKFLOW, { headers: githubHeaders_(key), muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code === 200) { props.setProperties({ KEY_CHECKED: id, KEY_FAILED: '', GITHUB_PROBLEM: '' }); return true; }
    if (code >= 500 || code === 429) return false; // GitHub is having trouble; ask again next minute
    problem = code === 401 ? 'GitHub does not accept the key (it may have expired or been deleted).'
      : code === 404 ? 'The key cannot see the website\'s repository (' + setting_('GITHUB_REPO') + ').'
        : 'GitHub answered ' + code + ' when the key was checked.';
  }
  props.setProperties({ KEY_FAILED: id, KEY_CHECKED: '', GITHUB_PROBLEM: problem });
  return false;
}

function instantOn_() {
  const props = PropertiesService.getScriptProperties();
  const key = String(props.getProperty('GITHUB_KEY') || '').trim();
  return !!key && props.getProperty('KEY_CHECKED') === hash_(key) && !props.getProperty('GITHUB_PROBLEM');
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

// ---------------------------------------------------------------------------------------------
// For the owner, from the script editor (select the function, then Run)

/** Once: lets the publisher read the Sheet and starts the minute-by-minute check. */
function setUpPublisher() {
  readTable_(book_());
  stopPublisher();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  tick();
  Logger.log('The publisher now checks the Sheet every minute. ' + (instantOn_() ? 'Instant publishing is on.' : 'Add GITHUB_KEY under Project Settings > Script properties to publish within minutes.'));
}

function stopPublisher() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
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

function uniqueId_(base, taken) {
  if (!taken[base]) return base;
  for (let n = 2; ; n++) if (!taken[base + '-' + n]) return base + '-' + n;
}

/** The first 16 hex digits of SHA-256: the same as hashId() on the website side. */
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 16);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
