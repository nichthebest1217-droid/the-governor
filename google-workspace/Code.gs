/**
 * The Governor: publish from Google Docs.
 *
 * Lives in a Google Sheet (Extensions > Apps Script). Editors list articles in the Sheet, one
 * per row, each pointing at a Google Doc. "Publish approved rows" copies every row marked
 * Approved to the website's repository on GitHub; the site rebuilds itself a minute later.
 *
 * Nothing here costs money and no Google Cloud project is needed. The Doc's fonts, sizes and
 * colours are ignored on purpose: the website applies its own typography.
 *
 * Setup is in SETUP.md. Three Script Properties are required:
 *   GITHUB_TOKEN   a fine-grained token with "Contents: read and write" on the repository
 *   GITHUB_REPO    e.g. nichthebest1217-droid/the-governor
 *   GITHUB_BRANCH  e.g. main
 */

const SECTIONS = { 'news': 'news', 'opinion': 'opinion', 'arts': 'arts', 'sports': 'sports', 'humor & fun': 'humor-fun', 'humor': 'humor-fun', 'people': 'people', 'school culture': 'school-culture' };
const COLUMNS = ['Status', 'Google Doc link', 'Headline', 'Section', 'Writers', 'Publication date', 'Type', 'Cover photo link', 'Photo description', 'Caption', 'Photo credit', 'Print issue ID', 'Order in issue', 'Web address', 'Result'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('The Governor')
    .addItem('Publish approved rows', 'publishApproved')
    .addItem('Check approved rows (no changes)', 'checkApproved')
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

function checkApproved() { run_(true); }
function publishApproved() { run_(false); }

function run_(dryRun) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const rows = sheet.getDataRange().getValues();
  const col = (name) => rows[0].indexOf(name);
  for (const name of COLUMNS) if (col(name) < 0) throw new Error('Missing column "' + name + '". Run The Governor > Set up this sheet.');
  let done = 0;
  for (let r = 1; r < rows.length; r++) {
    const get = (name) => String(rows[r][col(name)] == null ? '' : rows[r][col(name)]).trim();
    if (get('Status') !== 'Approved') continue;
    const cell = (name) => sheet.getRange(r + 1, col(name) + 1);
    try {
      const article = buildArticle_(rows[r], col);
      if (dryRun) {
        cell('Result').setValue('OK to publish: ' + article.path + ' (' + article.words + ' words)');
      } else {
        for (const file of article.files) putFile_(file.path, file.content, file.isBase64, file.onlyIfMissing, 'content: ' + article.title);
        cell('Status').setValue('Published');
        cell('Web address').setValue(article.url);
        cell('Result').setValue('Published ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
      }
      done++;
    } catch (err) {
      cell('Result').setValue('NOT PUBLISHED: ' + err.message);
    }
    SpreadsheetApp.flush();
  }
  SpreadsheetApp.getActive().toast(done + (dryRun ? ' row(s) checked' : ' row(s) published. The site updates in about two minutes.'), 'The Governor', 8);
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
  const props = PropertiesService.getScriptProperties();
  const custom = props.getProperty('SITE_URL');
  if (custom) return custom.replace(/\/?$/, '/');
  const parts = (props.getProperty('GITHUB_REPO') || '/').split('/');
  return 'https://' + parts[0] + '.github.io/' + parts[1] + '/';
}

/** Creates or updates one file in the repository through GitHub's API. */
function putFile_(path, content, isBase64, onlyIfMissing, message) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  const repo = props.getProperty('GITHUB_REPO');
  const branch = props.getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) throw new Error('Script Properties GITHUB_TOKEN and GITHUB_REPO are not set (see SETUP.md).');
  const url = 'https://api.github.com/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const existing = UrlFetchApp.fetch(url + '?ref=' + encodeURIComponent(branch), { headers: headers, muteHttpExceptions: true });
  let sha;
  if (existing.getResponseCode() === 200) {
    if (onlyIfMissing) return;
    sha = JSON.parse(existing.getContentText()).sha;
  } else if (existing.getResponseCode() !== 404) {
    throw new Error('GitHub said ' + existing.getResponseCode() + ' when checking ' + path + '. Is the token still valid?');
  }
  const payload = { message: message, branch: branch, content: isBase64 ? content : Utilities.base64Encode(content, Utilities.Charset.UTF_8) };
  if (sha) payload.sha = sha;
  const res = UrlFetchApp.fetch(url, { method: 'put', headers: headers, contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('GitHub refused ' + path + ' (HTTP ' + res.getResponseCode() + ').');
}
