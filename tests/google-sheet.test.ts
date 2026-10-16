// The Google Sheet's script (google-workspace/Code.gs), run outside Google against a small fake of
// the Sheets, Drive and URL services: statuses, IDs, the list GitHub reads, and what the public
// web address will and will not serve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { p } from '../scripts/lib/util.ts';

// ---- a fake of the Google services the script uses ---------------------------------------------
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
  constructor(name: string, rows: any[][] = []) { this.name = name; rows.forEach((r, i) => r.forEach((v, j) => this.set(i + 1, j + 1, v))); }
  set(r: number, c: number, v: any, link: string | null = null) { (this.cells[r - 1] ??= [])[c - 1] = v; (this.links[r - 1] ??= [])[c - 1] = link; }
  get(r: number, c: number) { return this.cells[r - 1]?.[c - 1] ?? ''; }
  getName() { return this.name; }
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

const HEADERS = ['Status', 'On the website', 'Title', 'Author(s)', 'Category', 'Publication date', 'Google Doc link', 'Description', 'Image link', 'Image description',
  'Image caption', 'Image credit', 'Type', 'Print issue', 'Order in issue', 'Correction', 'Article text (if no Doc)', 'ID'];
const DOC_A = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DOC_PRIVATE = '1PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP';
const EXPORT = `# Campus Welcomes New Students\n\nBy Jane Doe '27\n\n![Students on the steps][image1]\n\n*Opening day.*\n\nLast week, students gathered in the **Chapel**. ${'word '.repeat(60)}\n\n![](data:image/png;base64,QUJD)\n\n[image1]: <data:image/jpeg;base64,/9j/4AAQ\nSkZJRg==>\n`;

function world(rows: Record<string, unknown>[]) {
  const articles = new Sheet('Articles', [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ''))]);
  const sheets: Sheet[] = [articles, new Sheet('Homepage', [['Setting', 'Value'], ['Lead story', ''], ['Print issue to promote', '2026-27-issue-1']])];
  const w = {
    articles, sheets, script: new Store(), user: new Store(), fetched: [] as string[],
    live: null as any,
    files: { [DOC_A]: { modified: new Date('2026-10-15T15:00:00Z'), mime: 'application/vnd.google-apps.document', access: 'PRIVATE', permission: 'VIEW' } } as Record<string, any>,
    github: 204,
  };
  const spreadsheet = chain({
    getSheetByName: (n: string) => sheets.find((s) => s.name === n) ?? null,
    getSheets: () => sheets,
    insertSheet: (n: string) => { const s = new Sheet(n); sheets.push(s); return s; },
    toast: () => {},
  });
  const file = (id: string) => { const f = w.files[id]; if (!f) throw new Error('No item with the given ID could be found'); return { getId: () => id, getLastUpdated: () => f.modified, getMimeType: () => f.mime, getSharingAccess: () => f.access, getSharingPermission: () => f.permission }; };
  const reply = (code: number, text = '', type = 'application/json', bytes: number[] = []) => ({ getResponseCode: () => code, getContentText: () => text, getBlob: () => ({ getContentType: () => type, getBytes: () => bytes }) });
  const services: Record<string, unknown> = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => chain(), newRichTextValue: () => { let text = ''; let link: string | null = null; const b = { setText: (t: string) => { text = t; return b; }, setLinkUrl: (_a: number, _b: number, u: string) => { link = u; return b; }, build: () => new Rich(text, link) }; return b; }, newDataValidation: () => chain(), newConditionalFormatRule: () => chain(), WrapStrategy: {}, ProtectionType: {} },
    PropertiesService: { getScriptProperties: () => w.script, getUserProperties: () => w.user },
    DriveApp: { getFileById: file, searchFiles: () => { const ids = Object.keys(w.files); let i = 0; return { hasNext: () => i < ids.length, next: () => file(ids[i++]) }; }, Permission: { EDIT: 'EDIT', VIEW: 'VIEW' }, Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' } },
    UrlFetchApp: {
      fetch: (url: string) => {
        w.fetched.push(url);
        if (url.startsWith(SITE + 'publishing-status.json')) return w.live ? reply(200, JSON.stringify(w.live)) : reply(404);
        if (url.includes(`/document/d/${DOC_A}/export`)) return reply(200, EXPORT);
        if (url.includes('drive.google.com/thumbnail')) return reply(200, '', 'image/jpeg', [1, 2, 3]);
        if (url.startsWith('https://api.github.com/')) return reply(w.github);
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
    HtmlService: chain(),
  };
  w.script.setProperty('SITE_URL', SITE);
  const src = readFileSync(p('google-workspace/Code.gs'), 'utf8');
  const names = Object.keys(services);
  const gas = new Function(...names, `${src}\nreturn { refresh_, doGet, onEdit, quickNote_, splitImages_, rowFrom_, basicProblems_, maybeDispatch_, upgradeColumns_, HEADERS };`)(...names.map((n) => services[n]));
  const cell = (row: number, header: string) => articles.get(row, HEADERS.indexOf(header) + 1);
  const link = (row: number, header: string) => articles.links[row - 1]?.[HEADERS.indexOf(header)] ?? null;
  return { w, gas, cell, link };
}

const ROW = {
  Status: 'Published', Title: 'Campus Welcomes New Students', 'Author(s)': "Jane Doe '27, Sam Lee '28", Category: 'Humor & Fun',
  'Google Doc link': `https://docs.google.com/document/d/${DOC_A}/edit`, Description: 'A new year begins.', Type: 'Article',
};

test('the Sheet script uses the same columns as the tests', () => {
  assert.deepEqual(world([]).gas.HEADERS, HEADERS);
});

test('only Published rows are offered; IDs and dates are filled in; drafts stay private', () => {
  const { w, gas, cell } = world([
    ROW,
    { ...ROW, Status: 'Draft', Title: 'Secret draft', 'Google Doc link': `https://docs.google.com/document/d/${DOC_PRIVATE}/edit` },
    { ...ROW, Status: 'Ready for Review', Title: 'Waiting for an editor' },
    { ...ROW, Title: 'No section yet', Category: '' },
    { ...ROW, Title: 'Next week', 'Publication date': '2099-01-05' },
    { ...ROW, Title: 'Private doc', 'Google Doc link': `https://docs.google.com/document/d/${DOC_PRIVATE}/edit`, ID: '2026-10-01-private-doc' },
    { ...ROW, Title: 'Pasted text', 'Google Doc link': '', 'Article text (if no Doc)': 'First paragraph.\nSecond paragraph.' },
  ]);
  const { index } = gas.refresh_();
  const id = `${TODAY}-campus-welcomes-new-students`;
  assert.equal(cell(2, 'ID'), id, 'an ID is written into the row');
  assert.ok(cell(2, 'Publication date') instanceof Date, 'an empty date becomes today');
  assert.deepEqual(index.articles.map((a: any) => a.id), [id, `${TODAY}-pasted-text`]);
  assert.equal(index.articles[0].section, 'humor-fun');
  assert.equal(index.articles[0].source, 'doc');
  assert.equal(index.articles[1].source, 'text');
  assert.match(index.articles[0].revision, /^[0-9a-f]{16}$/);
  assert.deepEqual(index.held, ['2026-10-01-private-doc'], 'a live article whose row has a problem keeps its current version');
  const text = JSON.stringify(index);
  assert.ok(!text.includes('Secret draft') && !text.includes('Waiting for an editor'), 'drafts and rows waiting for review never leave Google');
  assert.ok(!text.includes(DOC_A) && !text.includes('docs.google.com'), 'Doc addresses stay private');
  assert.equal(cell(3, 'ID'), '', 'drafts get no ID');
  assert.equal(cell(2, 'On the website'), 'Publishing… (the website checks the Sheet every few hours)');
  assert.equal(cell(3, 'On the website'), 'Not on the website (draft)');
  assert.equal(cell(4, 'On the website'), 'Not on the website (waiting for review)');
  assert.equal(cell(5, 'On the website'), '⚠ Choose a Category.');
  assert.match(cell(6, 'On the website'), /^Scheduled for January 5, 2099/);
  assert.match(cell(7, 'On the website'), /^⚠ The Sheet can't open this Doc\. Share it with/);
  assert.ok(index.fingerprint.length === 16);
  assert.ok(w.fetched.every((u) => !u.includes(DOC_PRIVATE)), 'a draft Doc is never read');
});

test('"✓ Live" with the link once the site shows this version; "Taking it off" after unpublishing', () => {
  const { w, gas, cell, link } = world([ROW]);
  const first = gas.refresh_().index.articles[0];
  const url = `${SITE}${TODAY.replaceAll('-', '/')}/campus-welcomes-new-students/`;
  w.live = { builtAt: 'b1', sheet: { [first.id]: { revision: first.revision, url } }, errors: {}, all: [{ date: TODAY, title: ROW.Title, section: 'Humor & Fun', authors: 'Jane Doe ’27', url, fromSheet: true }] };
  gas.refresh_();
  assert.equal(cell(2, 'On the website'), `✓ Live: ${url}`);
  assert.equal(link(2, 'On the website'), url);
  assert.equal(w.sheets.find((s) => s.name === 'All articles')!.get(2, 2), ROW.Title, 'the All articles tab lists the site');

  w.articles.set(2, HEADERS.indexOf('Description') + 1, 'A changed description.');
  gas.refresh_();
  assert.match(cell(2, 'On the website'), /^Updating…/);

  w.live.errors = { [first.id]: { revision: gas.refresh_().index.articles[0].revision, message: 'the picture needs an Image description' } };
  gas.refresh_();
  assert.equal(cell(2, 'On the website'), '⚠ The website could not publish this version: the picture needs an Image description');

  w.articles.set(2, 1, 'Draft');
  const { index } = gas.refresh_();
  assert.equal(index.articles.length, 0);
  assert.equal(cell(2, 'On the website'), 'Taking it off the website…');
  w.live.sheet = {};
  gas.refresh_();
  assert.equal(cell(2, 'On the website'), 'Not on the website (draft)');
  assert.equal(cell(2, 'ID'), first.id, 'the ID stays, so republishing keeps the address');
});

test('a copied row gets its own ID; a Doc anyone can edit is flagged', () => {
  const { w, gas, cell } = world([ROW, ROW]);
  w.files[DOC_A].access = 'ANYONE_WITH_LINK';
  w.files[DOC_A].permission = 'EDIT';
  const { index } = gas.refresh_();
  assert.equal(cell(3, 'ID'), `${cell(2, 'ID')}-2`);
  assert.equal(index.articles.length, 2);
  const a = index.articles[0];
  w.live = { builtAt: 'b', sheet: { [a.id]: { revision: a.revision, url: SITE + 'x/' } }, errors: {}, all: [] };
  gas.refresh_();
  assert.match(cell(2, 'On the website'), /^✓ Live: .*⚠ anyone with the Doc's link can edit it/);
});

test('the web address serves Published articles only, and only the version it listed', () => {
  const { gas } = world([ROW, { ...ROW, Status: 'Draft', Title: 'Secret draft', ID: '2026-10-02-secret-draft' }]);
  const a = gas.refresh_().index.articles[0];
  const content = gas.doGet({ parameter: { article: a.id, rev: a.revision } });
  assert.equal(content.ok, true);
  assert.equal(content.source, 'doc');
  assert.deepEqual(content.images, ['image1', 'inline1']);
  assert.ok(!content.markdown.includes('data:image'), 'pictures are sent one at a time, not inside the text');
  assert.match(content.markdown, /!\[\]\[inline1\]/);
  const picture = gas.doGet({ parameter: { article: a.id, rev: a.revision, image: 'image1' } });
  assert.deepEqual([picture.ok, picture.mime, picture.base64], [true, 'image/jpeg', '/9j/4AAQSkZJRg==']);
  assert.equal(gas.doGet({ parameter: { article: a.id, rev: 'older' } }).error, 'changed');
  assert.equal(gas.doGet({ parameter: { article: '2026-10-02-secret-draft' } }).error, 'not-published');
  assert.equal(gas.doGet({ parameter: { article: 'anything-else' } }).error, 'not-published');
  const list = gas.doGet({});
  assert.equal(list.version, 2);
  assert.equal(list.articles.length, 1);
});

test('instant publishing asks GitHub once per change, and reports a broken key', () => {
  const { w, gas } = world([ROW]);
  assert.equal(gas.maybeDispatch_(gas.refresh_(), false), 'off', 'no key, no request');
  w.user.setProperty('GITHUB_KEY', 'github_pat_x');
  assert.equal(gas.maybeDispatch_(gas.refresh_(), false), 'sent');
  assert.equal(gas.maybeDispatch_(gas.refresh_(), false), 'idle', 'nothing changed since');
  w.articles.set(2, HEADERS.indexOf('Title') + 1, 'A new headline');
  w.script.setProperty('DISPATCHED_AT', '0');
  w.github = 401;
  assert.equal(gas.maybeDispatch_(gas.refresh_(), false), 'error');
  assert.match(w.script.getProperty('GITHUB_PROBLEM')!, /expired/);
  assert.equal(w.fetched.filter((u) => u.includes('/dispatches')).length, 2);
});

test('instant feedback when a row is edited', () => {
  const { gas } = world([]);
  const row = (o: Record<string, unknown>) => gas.rowFrom_(HEADERS.map((h) => o[h] ?? ''), HEADERS, {}, 2);
  assert.equal(gas.quickNote_(row(ROW), '', true, TODAY), 'Publishing… (usually live within 5 minutes)');
  assert.equal(gas.quickNote_(row(ROW), '✓ Live: x', true, TODAY), 'Updating… (usually live within 5 minutes)');
  assert.equal(gas.quickNote_(row({ ...ROW, Status: 'Draft' }), '✓ Live: x', true, TODAY), 'Taking it off the website…');
  assert.equal(gas.quickNote_(row({ ...ROW, 'Author(s)': '' }), '', true, TODAY), "⚠ Add the author(s), for example Jane Doe '27.");
  assert.equal(gas.quickNote_(row({ ...ROW, 'Image link': 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210/view' }), '', true, TODAY), "⚠ Add an Image description: what the picture shows, for readers who can't see it.");
  assert.equal(gas.quickNote_(row({ ...ROW, 'Google Doc link': 'see my email' }), '', true, TODAY), 'The Google Doc link is not a link to a Google Doc.'.replace(/^/, '⚠ '));
  assert.equal(gas.quickNote_(row({}), '', true, TODAY), '');
});

test('pictures are taken out of the Doc export, in both of Google\'s forms', () => {
  const { gas } = world([]);
  const out = gas.splitImages_('Text ![a](data:image/png;base64,AAA=) more\n\n![b][image7]\n\n[image7]: <data:image/jpeg;base64,BB\nCC>\n');
  assert.deepEqual(Object.keys(out.images).sort(), ['image7', 'inline1']);
  assert.equal(out.images.image7.data, 'BBCC');
  assert.equal(out.markdown, 'Text ![a][inline1] more\n\n![b][image7]');
});

test('the first version of the Sheet is upgraded in place, keeping what was typed', () => {
  const { w, gas, cell } = world([]);
  w.articles.clear();
  const old = ['Status', 'Google Doc link', 'Headline', 'Section', 'Writers', 'Publication date', 'Type', 'Cover photo link', 'Photo description', 'Caption', 'Photo credit', 'Print issue ID', 'Order in issue', 'Web address', 'Result'];
  [old, ['Approved', `https://docs.google.com/document/d/${DOC_A}/edit`, 'Old headline', 'News', "Jane Doe '27", '', 'Article', '', '', '', '', '', '', 'x', 'NOT READY: y']].forEach((r, i) => r.forEach((v, j) => w.articles.set(i + 1, j + 1, v)));
  gas.upgradeColumns_({ getSheetByName: () => null }, Object.assign(w.articles, { copyTo: () => ({ setName: () => {} }) }));
  assert.deepEqual(HEADERS.map((_, j) => w.articles.get(1, j + 1)), HEADERS);
  assert.equal(cell(2, 'Status'), 'Published');
  assert.equal(cell(2, 'Title'), 'Old headline');
  assert.equal(cell(2, 'Category'), 'News');
  assert.equal(cell(2, 'Author(s)'), "Jane Doe '27");
  assert.equal(cell(2, 'On the website'), '');
});
