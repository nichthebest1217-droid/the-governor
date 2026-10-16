// The two Apps Script files, run outside Google against a small fake of the Sheets, Drive, URL and
// cache services: google-workspace/publisher/Code.gs (statuses, IDs, the list GitHub reads, what the
// public web address will and will not serve, asking GitHub to update) and
// google-workspace/sheet/Code.gs (instant feedback, upgrading the Sheet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { p } from '../scripts/lib/util.ts';
import { hashId } from '../scripts/lib/sheet-sync.ts';

// ---- a fake of the Google services ---------------------------------------------------------------
const chain = (target: any = {}): any => new Proxy(target, {
  get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => chain(t)),
});
class Rich {
  text: string;
  link: string | null;
  constructor(text: string, link: string | null = null) { this.text = text; this.link = link; }
  getText() { return this.text; }
  getLinkUrl() { return this.link; }
  getRuns() { return [this]; }
}
class Sheet {
  cells: any[][] = [];
  links: (string | null)[][] = [];
  name: string;
  parent: any = null;
  constructor(name: string, rows: any[][] = []) { this.name = name; rows.forEach((r, i) => r.forEach((v, j) => this.set(i + 1, j + 1, v))); }
  set(r: number, c: number, v: any, link: string | null = null) { (this.cells[r - 1] ??= [])[c - 1] = v; (this.links[r - 1] ??= [])[c - 1] = link; }
  get(r: number, c: number) { return this.cells[r - 1]?.[c - 1] ?? ''; }
  getName() { return this.name; }
  getParent() { return this.parent; }
  getLastRow() { let n = 0; this.cells.forEach((row, i) => { if (row?.some((v) => v !== '' && v != null)) n = i + 1; }); return n; }
  getLastColumn() { let n = 0; this.cells.forEach((row) => row?.forEach((v, j) => { if (v !== '' && v != null) n = Math.max(n, j + 1); })); return n; }
  getMaxRows() { return Math.max(1000, this.cells.length); }
  getMaxColumns() { return 26; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r: number, c: number, nr = 1, nc = 1) { return chain(new Range(this, r, c, nr, nc)); }
  getProtections() { return []; }
  clear() { this.cells = []; this.links = []; return this; }
  clearContents() { return this.clear(); }
  protect() { return chain(); }
  insertRowsAfter() { return this; }
  setFrozenRows() {} setFrozenColumns() {} setColumnWidth() {} setRowHeight() {} setHiddenGridlines() {} setConditionalFormatRules() {} clearConditionalFormatRules() {}
  snapshot() { return JSON.stringify([this.cells, this.links]); }
}
class Range {
  s: Sheet; r: number; c: number; nr: number; nc: number;
  constructor(s: Sheet, r: number, c: number, nr: number, nc: number) { this.s = s; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  grid<T>(f: (r: number, c: number) => T): T[][] { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => f(this.r + i, this.c + j))); }
  getValues() { return this.grid((r, c) => this.s.get(r, c)); }
  getValue() { return this.s.get(this.r, this.c); }
  setValues(v: any[][]) { v.forEach((row, i) => row.forEach((x, j) => this.s.set(this.r + i, this.c + j, x))); return chain(this); }
  setValue(x: any) { this.s.set(this.r, this.c, x); return chain(this); }
  getRichTextValues() { return this.grid((r, c) => { const v = this.s.get(r, c); return typeof v === 'string' ? new Rich(v, this.s.links[r - 1]?.[c - 1] ?? null) : null; }); }
  setRichTextValues(v: Rich[][]) { v.forEach((row, i) => row.forEach((x, j) => this.s.set(this.r + i, this.c + j, x.getText(), x.getLinkUrl()))); return chain(this); }
  clearContent() { this.grid((r, c) => this.s.set(r, c, '')); return chain(this); }
  getSheet() { return this.s; }
  getRow() { return this.r; }
  getLastRow() { return this.r + this.nr - 1; }
  getColumn() { return this.c; }
  getNumColumns() { return this.nc; }
}
class Store {
  data: Record<string, string> = {};
  getProperty(k: string) { return this.data[k] ?? null; }
  setProperty(k: string, v: string) { this.data[k] = String(v); return this; }
  setProperties(o: Record<string, string>) { for (const [k, v] of Object.entries(o)) this.data[k] = String(v); return this; }
  getProperties() { return { ...this.data }; }
  deleteProperty(k: string) { delete this.data[k]; return this; }
}
const formatDate = (d: Date, tz: string, fmt: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return fmt.replace("'T'", 'T').replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
};
const TZ = 'America/New_York';
const TODAY = formatDate(new Date(), TZ, 'yyyy-MM-dd');
const SITE = 'https://org.github.io/the-governor/';
const KEY = 'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const HEADERS = ['Status', 'On the website', 'Title', 'Author(s)', 'Category', 'Publication date', 'Google Doc link', 'Description', 'Image link', 'Image description',
  'Image caption', 'Image credit', 'Type', 'Print issue', 'Order in issue', 'Correction', 'Article text (if no Doc)', 'ID'];
const DOC_A = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DOC_PRIVATE = '1PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP';
const PDF = '1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
const EXPORT = `# Campus Welcomes New Students\n\nBy Jane Doe '27\n\n![Students on the steps][image1]\n\n*Opening day.*\n\nLast week, students gathered in the **Chapel**. ${'word '.repeat(60)}\n\n![](data:image/png;base64,QUJD)\n\n[image1]: <data:image/jpeg;base64,/9j/4AAQ\nSkZJRg==>\n`;

function world(rows: Record<string, unknown>[]) {
  const articles = new Sheet('Articles', [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ''))]);
  const sheets: Sheet[] = [articles, new Sheet('How to publish', [['How to publish'], [''], ['']]), new Sheet('Homepage', [['Setting', 'Value'], ['Lead story', ''], ['Print issue to promote', '2026-27-issue-1']])];
  const w = {
    articles, sheets, script: new Store(), cache: new Map<string, string>(), fetched: [] as string[], live: null as any, github: { check: 200, dispatch: 204 },
    files: {
      [DOC_A]: { modified: new Date('2026-10-15T15:00:00Z'), mime: 'application/vnd.google-apps.document', access: 'PRIVATE', permission: 'VIEW' },
      [PDF]: { modified: new Date('2026-10-15T15:00:00Z'), mime: 'application/pdf', access: 'PRIVATE', permission: 'VIEW' },
    } as Record<string, any>,
  };
  const spreadsheet = chain({
    getSheetByName: (n: string) => sheets.find((s) => s.name === n) ?? null,
    getSheets: () => sheets,
    insertSheet: (n: string) => { const s = new Sheet(n); s.parent = spreadsheet; sheets.push(s); return s; },
    toast: () => {},
  });
  sheets.forEach((s) => { s.parent = spreadsheet; });
  const file = (id: string) => { const f = w.files[id]; if (!f) throw new Error('No item with the given ID could be found'); return { getId: () => id, getLastUpdated: () => f.modified, getMimeType: () => f.mime, getSharingAccess: () => f.access, getSharingPermission: () => f.permission }; };
  const reply = (code: number, text = '', type = 'application/json', bytes: number[] = []) => ({ getResponseCode: () => code, getContentText: () => text, getBlob: () => ({ getContentType: () => type, getBytes: () => bytes }) });
  const services: Record<string, unknown> = {
    SpreadsheetApp: { openById: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet, getUi: () => chain(), newRichTextValue: () => { let text = ''; let link: string | null = null; const b = { setText: (t: string) => { text = t; return b; }, setLinkUrl: (_a: number, _b: number, u: string) => { link = u; return b; }, build: () => new Rich(text, link) }; return b; }, newDataValidation: () => chain(), newConditionalFormatRule: () => chain(), WrapStrategy: {}, ProtectionType: {} },
    PropertiesService: { getScriptProperties: () => w.script },
    CacheService: { getScriptCache: () => ({ get: (k: string) => w.cache.get(k) ?? null, put: (k: string, v: string) => { w.cache.set(k, v); } }) },
    DriveApp: { getFileById: file, searchFiles: () => { const ids = Object.keys(w.files); let i = 0; return { hasNext: () => i < ids.length, next: () => file(ids[i++]) }; }, Permission: { EDIT: 'EDIT', VIEW: 'VIEW' }, Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' } },
    UrlFetchApp: {
      fetch: (url: string) => {
        w.fetched.push(url);
        if (url.startsWith(SITE + 'publishing-status.json')) return w.live ? reply(200, JSON.stringify(w.live)) : reply(404);
        if (url.includes(`/document/d/${DOC_A}/export`)) return reply(200, EXPORT);
        if (url.includes('drive.google.com/thumbnail')) return reply(200, '', 'image/jpeg', [1, 2, 3]);
        if (url.endsWith('/dispatches')) return reply(w.github.dispatch);
        if (url.startsWith('https://api.github.com/')) return reply(w.github.check);
        return reply(404);
      },
    },
    Utilities: {
      formatDate, base64Encode: (b: number[]) => Buffer.from(b).toString('base64'),
      computeDigest: (_a: unknown, s: string) => Array.from(createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    },
    Session: { getScriptTimeZone: () => TZ },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    ScriptApp: { getOAuthToken: () => 'token', getProjectTriggers: () => [], newTrigger: () => chain(), deleteTrigger: () => {} },
    ContentService: { createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 'json' } },
    Logger: { log: () => {} },
  };
  w.script.setProperty('SITE_URL', SITE);
  const load = (file: string, names: string) => {
    const keys = Object.keys(services);
    return new Function(...keys, `${readFileSync(p(file), 'utf8')}\nreturn { ${names} };`)(...keys.map((k) => services[k]));
  };
  const pub = load('google-workspace/publisher/Code.gs', 'refresh_, tick, publishNow, doGet, splitImages_, maybeDispatch_, HEADERS');
  const sheet = load('google-workspace/sheet/Code.gs', 'onEdit, quickNote_, rowFrom_, upgradeColumns_, HEADERS');
  const cell = (row: number, header: string) => articles.get(row, HEADERS.indexOf(header) + 1);
  const link = (row: number, header: string) => articles.links[row - 1]?.[HEADERS.indexOf(header)] ?? null;
  const guide = () => String(sheets[1].get(3, 1));
  return { w, pub, sheet, cell, link, guide };
}

const ROW = {
  Status: 'Published', Title: 'Campus Welcomes New Students', 'Author(s)': "Jane Doe '27, Sam Lee '28", Category: 'Humor & Fun',
  'Google Doc link': `https://docs.google.com/document/d/${DOC_A}/edit`, Description: 'A new year begins.', Type: 'Article',
};
const ID_A = `${TODAY}-campus-welcomes-new-students`;

test('both scripts use the same columns, and their shared code is identical', () => {
  const { pub, sheet } = world([]);
  assert.deepEqual(pub.HEADERS, HEADERS);
  assert.deepEqual(sheet.HEADERS, HEADERS);
  const shared = (file: string) => { const s = readFileSync(p(file), 'utf8'); return s.slice(s.indexOf('\n', s.indexOf('// ===== Shared with')), s.indexOf('// ===== End of shared block')); };
  assert.equal(shared('google-workspace/publisher/Code.gs'), shared('google-workspace/sheet/Code.gs'));
  const manifest = (file: string) => JSON.parse(readFileSync(p(file), 'utf8'));
  assert.deepEqual(manifest('google-workspace/sheet/appsscript.json').oauthScopes.sort(), ['https://www.googleapis.com/auth/script.container.ui', 'https://www.googleapis.com/auth/spreadsheets.currentonly'], 'the Sheet\'s own script can touch nothing but the Sheet');
  assert.equal(manifest('google-workspace/sheet/appsscript.json').webapp, undefined);
});

test('only Published rows are offered; IDs and dates are filled in; drafts stay private', () => {
  const { w, pub, cell } = world([
    ROW,
    { ...ROW, Status: 'Draft', Title: 'Secret draft', 'Google Doc link': `https://docs.google.com/document/d/${DOC_PRIVATE}/edit` },
    { ...ROW, Status: 'Ready for Review', Title: 'Waiting for an editor' },
    { ...ROW, Title: 'No section yet', Category: '' },
    { ...ROW, Title: 'Embargoed until 2099', 'Publication date': '2099-01-05' },
    { ...ROW, Title: 'Private doc', 'Google Doc link': `https://docs.google.com/document/d/${DOC_PRIVATE}/edit`, ID: '2026-10-01-private-doc' },
    { ...ROW, Title: 'Pasted text', 'Google Doc link': '', 'Article text (if no Doc)': 'First paragraph.\nSecond paragraph.' },
    { ...ROW, Title: 'A PDF', 'Google Doc link': `https://drive.google.com/file/d/${PDF}/view`, ID: '2026-10-02-a-pdf' },
  ]);
  const { index } = pub.refresh_();
  assert.equal(cell(2, 'ID'), ID_A, 'an ID is written into the row');
  assert.ok(cell(2, 'Publication date') instanceof Date, 'an empty date becomes today');
  assert.equal(cell(3, 'ID'), '', 'drafts get no ID');
  assert.equal(cell(5, 'ID'), '', 'a row with something missing gets no ID yet');
  assert.deepEqual(index.articles.map((a: any) => a.id), [ID_A, `${TODAY}-pasted-text`].sort());
  const a = index.articles.find((x: any) => x.id === ID_A);
  assert.deepEqual([a.section, a.source, a.description], ['humor-fun', 'doc', 'A new year begins.']);
  assert.match(a.revision, /^[0-9a-f]{16}$/);
  assert.deepEqual(index.held, [hashId('2026-10-01-private-doc'), hashId('2026-10-02-a-pdf')].sort(), 'published rows with a problem keep their live version');
  assert.deepEqual(index.unpublished, [hashId('2099-01-05-embargoed-until-2099')], 'a scheduled row is not live yet');
  const text = JSON.stringify(index);
  for (const secret of ['Secret draft', 'Waiting for an editor', 'Embargoed', 'embargoed', 'No section yet', 'private-doc', DOC_A, 'docs.google.com']) assert.ok(!text.includes(secret), `the public list must not contain "${secret}"`);
  assert.equal(cell(2, 'On the website'), 'Publishing… (the website checks the Sheet every few hours)');
  assert.equal(cell(3, 'On the website'), 'Not on the website (draft)');
  assert.equal(cell(4, 'On the website'), 'Not on the website (waiting for review)');
  assert.equal(cell(5, 'On the website'), '⚠ Choose a Category.');
  assert.equal(cell(6, 'On the website'), 'Scheduled for January 5, 2099');
  assert.match(cell(7, 'On the website'), /^⚠ The Sheet can't open this Doc\. Share it with/);
  assert.match(cell(9, 'On the website'), /^⚠ The Google Doc link points to a file that is not a Google Doc/);
  pub.refresh_();
  assert.match(cell(9, 'On the website'), /not a Google Doc/, 'the problem is still reported once the Doc details are remembered');
  assert.ok(w.fetched.every((u) => !u.includes(DOC_PRIVATE)), 'a draft Doc is never read');
});

test('the public web address changes nothing and lists only rows that are ready', () => {
  const { w, pub } = world([ROW, { ...ROW, Title: 'New row, not yet seen by the minute check' }]);
  w.articles.set(2, HEADERS.indexOf('ID') + 1, ID_A);
  const before = w.articles.snapshot();
  const list = pub.doGet({});
  assert.equal(w.articles.snapshot(), before, 'doGet wrote nothing to the Sheet');
  assert.equal(list.version, 2);
  assert.deepEqual(list.articles.map((a: any) => a.id), [ID_A]);
  assert.ok(!('problems' in list));
});

test('"✓ Live" with the link once the site shows this version; "Taking it off" after unpublishing', () => {
  const { w, pub, cell, link } = world([ROW]);
  const first = pub.refresh_().index.articles[0];
  const url = `${SITE}${TODAY.replaceAll('-', '/')}/campus-welcomes-new-students/`;
  w.live = { builtAt: 'b1', sheet: { [first.id]: { revision: first.revision, url } }, errors: {}, warnings: [], all: [{ date: TODAY, title: ROW.Title, section: 'Humor & Fun', authors: 'Jane Doe ’27', url, fromSheet: true }] };
  pub.refresh_();
  assert.equal(cell(2, 'On the website'), `✓ Live: ${url}`);
  assert.equal(link(2, 'On the website'), url);
  assert.equal(w.sheets.find((s) => s.name === 'All articles')!.get(2, 2), ROW.Title, 'the All articles tab lists the site');

  w.articles.set(2, HEADERS.indexOf('Description') + 1, 'A changed description.');
  const revised = pub.refresh_().index.articles[0].revision;
  assert.match(cell(2, 'On the website'), /^Updating…/);
  w.live.errors = { [first.id]: { revision: revised, message: 'the picture needs an Image description' } };
  pub.refresh_();
  assert.equal(cell(2, 'On the website'), '⚠ The website could not publish this version: the picture needs an Image description');

  w.live.warnings = ['5 published articles have disappeared from the Sheet.'];
  w.articles.set(2, 1, 'Draft');
  const { index } = pub.refresh_();
  assert.equal(index.articles.length, 0);
  assert.deepEqual(index.unpublished, [hashId(first.id)]);
  assert.equal(cell(2, 'On the website'), 'Taking it off the website…');
  assert.match(String(w.sheets[1].get(4, 1)), /disappeared from the Sheet/, 'notes from the website appear on the How to publish tab');
  w.live.sheet = {};
  pub.refresh_();
  assert.equal(cell(2, 'On the website'), 'Not on the website (draft)');
  assert.equal(cell(2, 'ID'), first.id, 'the ID stays, so republishing keeps the address');
});

test('a copied row never takes the live article\'s ID; a Doc anyone can edit is flagged', () => {
  const { w, pub, cell } = world([{ ...ROW, Status: 'Draft', ID: '2026-10-01-campus-welcomes-new-students' }, { ...ROW, ID: '2026-10-01-campus-welcomes-new-students' }]);
  w.files[DOC_A].access = 'ANYONE_WITH_LINK';
  w.files[DOC_A].permission = 'EDIT';
  const { index } = pub.refresh_();
  assert.equal(cell(3, 'ID'), '2026-10-01-campus-welcomes-new-students', 'the Published original keeps its ID even below its copy');
  assert.equal(cell(2, 'ID'), '');
  const a = index.articles[0];
  w.live = { builtAt: 'b', sheet: { [a.id]: { revision: a.revision, url: SITE + 'x/' } }, errors: {}, warnings: [], all: [] };
  pub.refresh_();
  assert.match(cell(3, 'On the website'), /^✓ Live: .*⚠ anyone with the Doc's link can edit it/);
});

test('the web address serves Published articles only, and only the version it listed', () => {
  const { pub } = world([ROW, { ...ROW, Status: 'Draft', Title: 'Secret draft', ID: '2026-10-02-secret-draft' }]);
  const a = pub.refresh_().index.articles[0];
  const content = pub.doGet({ parameter: { article: a.id, rev: a.revision } });
  assert.equal(content.ok, true);
  assert.deepEqual(content.images, ['image1', 'inline1']);
  assert.ok(!content.markdown.includes('data:image'), 'pictures are sent one at a time, not inside the text');
  const picture = pub.doGet({ parameter: { article: a.id, rev: a.revision, image: 'image1' } });
  assert.deepEqual([picture.ok, picture.mime, picture.base64], [true, 'image/jpeg', '/9j/4AAQSkZJRg==']);
  assert.deepEqual(pub.doGet({ parameter: { article: a.id, rev: 'older' } }), { ok: false, retry: true, error: 'changed' });
  assert.equal(pub.doGet({ parameter: { article: '2026-10-02-secret-draft' } }).error, 'not-published');
  assert.equal(pub.doGet({ parameter: { article: 'anything-else' } }).error, 'not-published');
  for (let i = 0; i < 150; i++) pub.doGet({ parameter: { article: 'x' } });
  assert.deepEqual(pub.doGet({ parameter: { article: 'x' } }), { ok: false, retry: true, error: 'busy' }, 'requests for one article are limited');
});

test('instant publishing: the key is checked once, GitHub is asked once per change, problems show in the Sheet', () => {
  const { w, pub, guide } = world([ROW]);
  assert.equal(pub.maybeDispatch_(pub.refresh_(), false), 'off', 'no key, no request');
  assert.match(guide(), /^Instant publishing is OFF/);
  w.script.setProperty('GITHUB_KEY', 'ghp_classicTokenWithTooMuchPower0000000000');
  assert.equal(pub.maybeDispatch_(pub.refresh_(), false), 'error');
  assert.match(w.script.getProperty('GITHUB_PROBLEM')!, /fine-grained/);
  w.script.setProperty('GITHUB_KEY', KEY);
  assert.equal(pub.maybeDispatch_(pub.refresh_(), false), 'sent');
  pub.refresh_();
  assert.match(guide(), /^Instant publishing is ON/);
  assert.equal(pub.maybeDispatch_(pub.refresh_(), false), 'idle', 'nothing changed since');
  w.articles.set(2, HEADERS.indexOf('Title') + 1, 'A new headline');
  w.script.setProperty('DISPATCHED_AT', '0');
  w.github.dispatch = 401;
  assert.equal(pub.maybeDispatch_(pub.refresh_(), false), 'error');
  pub.refresh_();
  assert.match(guide(), /^⚠ Instant publishing stopped: GitHub no longer accepts the key/);
  assert.equal(w.fetched.filter((u) => u.endsWith('/dispatches')).length, 2);
});

test('pictures are taken out of the Doc export, in both of Google\'s forms', () => {
  const { pub } = world([]);
  const out = pub.splitImages_('Text ![a](data:image/png;base64,AAA=) more\n\n![b][image7]\n\n[image7]: <data:image/jpeg;base64,BB\nCC>\n');
  assert.deepEqual(Object.keys(out.images).sort(), ['image7', 'inline1']);
  assert.equal(out.images.image7.data, 'BBCC');
  assert.equal(out.markdown, 'Text ![a][inline1] more\n\n![b][image7]');
});

test('the Sheet\'s own script: instant feedback when a row is edited', () => {
  const { w, sheet, cell } = world([]);
  const row = (o: Record<string, unknown>) => sheet.rowFrom_(HEADERS.map((h) => o[h] ?? ''), HEADERS, {}, 2);
  assert.equal(sheet.quickNote_(row(ROW), '', true, TODAY), 'Publishing… (usually live within 5 minutes)');
  assert.equal(sheet.quickNote_(row(ROW), '✓ Live: x', true, TODAY), 'Updating… (usually live within 5 minutes)');
  assert.equal(sheet.quickNote_(row({ ...ROW, Status: 'Draft' }), '✓ Live: x', true, TODAY), 'Taking it off the website…');
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Author(s)': '' }), '', true, TODAY), "⚠ Add the author(s), for example Jane Doe '27.");
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Image link': 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210/view' }), '', true, TODAY), "⚠ Add an Image description: what the picture shows, for readers who can't see it.");
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Google Doc link': 'see my email' }), '', true, TODAY), '⚠ The Google Doc link is not a link to a Google Doc.');
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Publication date': '2099-01-05' }), '', true, TODAY), 'Scheduled for January 5, 2099');
  assert.equal(sheet.quickNote_(row({}), '', true, TODAY), '');
  // onEdit reads whether instant publishing is on from the How to publish tab.
  HEADERS.forEach((h, j) => w.articles.set(2, j + 1, (ROW as any)[h] ?? ''));
  w.sheets[1].set(3, 1, 'Instant publishing is ON: the website updates about five minutes after each change.');
  sheet.onEdit({ range: w.articles.getRange(2, 1) });
  assert.equal(cell(2, 'On the website'), 'Publishing… (usually live within 5 minutes)');
});

test('the Sheet\'s own script upgrades the first version of the Sheet in place, keeping what was typed', () => {
  const { w, sheet, cell } = world([]);
  w.articles.clear();
  const old = ['Status', 'Google Doc link', 'Headline', 'Section', 'Writers', 'Publication date', 'Type', 'Cover photo link', 'Photo description', 'Caption', 'Photo credit', 'Print issue ID', 'Order in issue', 'Web address', 'Result'];
  [old, ['Approved', `https://docs.google.com/document/d/${DOC_A}/edit`, 'Old headline', 'News', "Jane Doe '27", '', 'Article', '', '', '', '', '', '', 'x', 'NOT READY: y']].forEach((r, i) => r.forEach((v, j) => w.articles.set(i + 1, j + 1, v)));
  sheet.upgradeColumns_({ getSheetByName: () => null }, Object.assign(w.articles, { copyTo: () => ({ setName: () => {} }) }));
  assert.deepEqual(HEADERS.map((_, j) => w.articles.get(1, j + 1)), HEADERS);
  assert.deepEqual([cell(2, 'Status'), cell(2, 'Title'), cell(2, 'Category'), cell(2, 'Author(s)'), cell(2, 'On the website')], ['Published', 'Old headline', 'News', "Jane Doe '27", '']);
});
