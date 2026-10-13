/**
 * The Governor: publish from Google Docs.
 *
 * Lives in a Google Sheet (Extensions > Apps Script). Editors list articles in the Sheet, one
 * per row, each pointing at a Google Doc. Rows marked Approved are offered to the website
 * through this script's web address; the website's repository collects them every half hour
 * (or at once from GitHub's "Run workflow" button), checks them, and publishes.
 *
 * No access token is stored anywhere: the Sheet never writes to GitHub. The web address only
 * ever returns articles an editor has marked Approved, which are about to be public anyway.
 *
 * Nothing here costs money and no Google Cloud project is needed. The Doc's fonts, sizes and
 * colours are ignored on purpose: the website applies its own typography.
 */

const SECTIONS = { 'news': 'news', 'opinion': 'opinion', 'arts': 'arts', 'sports': 'sports', 'humor & fun': 'humor-fun', 'humor': 'humor-fun', 'people': 'people', 'school culture': 'school-culture' };
const COLUMNS = ['Status', 'Google Doc link', 'Headline', 'Section', 'Writers', 'Publication date', 'Type', 'Cover photo link', 'Photo description', 'Caption', 'Photo credit', 'Print issue ID', 'Order in issue', 'Web address', 'Result'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('The Governor')
    .addItem('Check approved rows', 'checkApproved')
    .addItem('Mark live articles as Published', 'markLive')
    .addSeparator()
    .addItem('Set up this sheet', 'setUpSheet')
    .addToUi();
}

/** Writes the header row and the Status / Section / Type dropdowns. Safe to run twice. */
function setUpSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  const rule = (list) => SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  sheet.getRange(2, 1, 500, 1).setDataValidation(rule(['Draft', 'In edit', 'Approved', 'Published', 'Hold']));
  sheet.getRange(2, 4, 500, 1).setDataValidation(rule(['News', 'Opinion', 'Arts', 'Sports', 'Humor & Fun', 'People', 'School Culture']));
  sheet.getRange(2, 7, 500, 1).setDataValidation(rule(['Article', 'Editorial']));
  sheet.getRange(2, 6, 500, 1).setNumberFormat('yyyy-mm-dd');
}

/** Reads every Approved row and writes what would be published into the Result column. */
function checkApproved() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const out = collect_(sheet);
  for (const a of out.articles) sheet.getRange(a.row, a.resultCol).setValue('Ready: ' + a.words + ' words. Will appear at ' + a.url + ' within about 30 minutes.');
  for (const p of out.problems) sheet.getRange(p.row, p.resultCol).setValue('NOT READY: ' + p.message);
  SpreadsheetApp.getActive().toast(out.articles.length + ' ready, ' + out.problems.length + ' with problems', 'The Governor', 8);
}

/** Sets Approved rows to Published once their page is really on the website. */
function markLive() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const out = collect_(sheet);
  let n = 0;
  for (const a of out.articles) {
    const res = UrlFetchApp.fetch(a.url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) continue;
    sheet.getRange(a.row, a.statusCol).setValue('Published');
    sheet.getRange(a.row, a.urlCol).setValue(a.url);
    sheet.getRange(a.row, a.resultCol).setValue('Live since ' + new Date().toISOString().slice(0, 10));
    n++;
  }
  SpreadsheetApp.getActive().toast(n + ' article(s) marked Published', 'The Governor', 8);
}

/** The website calls this address. It answers with every Approved row, ready to publish. Read-only. */
function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const out = collect_(sheet);
  const body = {
    generatedAt: new Date().toISOString(),
    articles: out.articles.map((a) => ({ row: a.row, title: a.title, path: a.path, url: a.url, files: a.files })),
    problems: out.problems.map((p) => ({ row: p.row, headline: p.headline, message: p.message })),
  };
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function collect_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const col = (name) => rows[0].indexOf(name);
  for (const name of COLUMNS) if (col(name) < 0) throw new Error('Missing column "' + name + '". Run The Governor > Set up this sheet.');
  const at = { resultCol: col('Result') + 1, statusCol: col('Status') + 1, urlCol: col('Web address') + 1 };
  const articles = [];
  const problems = [];
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][col('Status')]).trim() !== 'Approved') continue;
    try {
      articles.push(Object.assign({ row: r + 1 }, at, buildArticle_(rows[r], col)));
    } catch (err) {
      problems.push(Object.assign({ row: r + 1, headline: String(rows[r][col('Headline')]), message: err.message }, at));
    }
  }
  return { articles: articles, problems: problems };
}

/** Turns one sheet row into the files the website needs. Throws a plain-English error if anything is missing. */
function buildArticle_(row, col) {
  const get = (name) => String(row[col(name)] == null ? '' : row[col(name)]).trim();
  const title = get('Headline');
  if (!title) throw new Error('Headline is empty.');
  const section = SECTIONS[get('Section').toLowerCase()];
  if (!section) throw new Error('Choose a Section.');
  const rawDate = row[col('Publication date')];
  const date = rawDate instanceof Date ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : get('Publication date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Publication date must be a date (YYYY-MM-DD).');
  const docId = idFromLink_(get('Google Doc link'));
  if (!docId) throw new Error('Google Doc link is missing or not a Google Docs link.');

  const writers = get('Writers').split(/\s*[,;]\s*|\s+and\s+/).map((w) => w.trim()).filter(Boolean).map(parseWriter_);
  if (writers.length === 0) throw new Error('Add at least one writer, e.g. Jane Doe \'27.');

  const body = cleanMarkdown_(exportDocAsMarkdown_(docId), title);
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 50) throw new Error('The Doc has only ' + words + ' words. Is the link right, and is the Doc shared with the account running this?');

  const slug = slugify_(title);
  const files = [];
  for (const w of writers) {
    files.push({ path: 'src/content/authors/' + w.slug + '.json', onlyIfMissing: true, content: JSON.stringify({ slug: w.slug, name: w.name, classYear: w.classYear, bio: null, photo: null, visible: true, needsReview: false, sourceEvidence: 'Added from the publication sheet.' }, null, 2) + '\n' });
  }
  let cover = null;
  const photoId = idFromLink_(get('Cover photo link'));
  if (photoId) {
    cover = '/media/' + date.slice(0, 4) + '/' + date.slice(5, 7) + '/' + slug + '.jpg';
    // A 2000-pixel copy: sharp on any screen, a fraction of the original's size. The original stays in Drive.
    const blob = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + photoId + '&sz=w2000', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (blob.getResponseCode() !== 200) throw new Error('Could not read the cover photo (HTTP ' + blob.getResponseCode() + '). Is it an image in Drive that this account can open?');
    files.push({ path: 'public' + cover, content: Utilities.base64Encode(blob.getBlob().getBytes()), isBase64: true });
    if (!get('Photo description')) throw new Error('Add a Photo description (what the picture shows, for readers who cannot see it).');
  }
  const q = (v) => (v === null || v === '' ? 'null' : JSON.stringify(String(v)));
  const order = get('Order in issue');
  const front = [
    'title: ' + q(title),
    'publishedAt: "' + date + '"',
    'section: "' + section + '"',
    'kind: "' + (get('Type').toLowerCase() === 'editorial' ? 'editorial' : 'article') + '"',
    'authors:', ...writers.map((w) => '  - "' + w.slug + '"'),
    'coverImage: ' + q(cover),
    'coverAlt: ' + q(cover ? get('Photo description') : null),
    'coverCaption: ' + q(cover ? get('Caption') : null),
    'coverCredit: ' + q(cover ? get('Photo credit') : null),
    'issueId: ' + q(get('Print issue ID') || null),
    'printOrder: ' + (order && !isNaN(Number(order)) ? Number(order) : 'null'),
    'sourceDoc: ' + q('https://docs.google.com/document/d/' + docId),
    'published: true',
  ].join('\n');
  const path = 'src/content/articles/' + date + '-' + slug + '.md';
  files.push({ path: path, content: '---\n' + front + '\n---\n\n' + body + '\n' });
  return { title: title, path: path, words: words, files: files, url: siteUrl_() + date.replace(/-/g, '/') + '/' + slug + '/' };
}

function parseWriter_(text) {
  const m = /^(.*?)[\s,]*['’‘`]?\s*(\d{2})['’]?$/.exec(text);
  const name = (m ? m[1] : text).trim();
  return { name: name, classYear: m ? 2000 + Number(m[2]) : null, slug: slugify_(name) };
}

function slugify_(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function idFromLink_(link) {
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(link) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(link) || /^([A-Za-z0-9_-]{25,})$/.exec(link);
  return m ? m[1] : '';
}

function exportDocAsMarkdown_(docId) {
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/markdown', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Could not read the Doc (HTTP ' + res.getResponseCode() + '). Share it with the account that runs this script.');
  return res.getContentText('UTF-8');
}

/** Keeps the words and structure of the Doc; drops everything that is only formatting. */
function cleanMarkdown_(md, title) {
  let text = md.replace(/\r\n/g, '\n');
  text = text.replace(/^\[image\d+\]:\s*<data:[^>]*>\s*$/gm, '');      // embedded pictures (add photos through the sheet)
  text = text.replace(/!\[[^\]]*\]\[image\d+\]/g, '');
  text = text.replace(/\\([-.!#()+_>~])/g, '$1');                        // needless escapes
  const lines = text.split('\n');
  // Drop a leading title line, and a "by ..." line under it: both come from the sheet.
  while (lines.length && !lines[0].trim()) lines.shift();
  const plain = (s) => s.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim().toLowerCase();
  if (lines.length && plain(lines[0]) === title.trim().toLowerCase()) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && /^by\s+\S+/i.test(plain(lines[0])) && plain(lines[0]).length < 120) lines.shift();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function siteUrl_() {
  const custom = PropertiesService.getScriptProperties().getProperty('SITE_URL');
  return (custom || 'https://nichthebest1217-droid.github.io/the-governor/').replace(/\/?$/, '/');
}
