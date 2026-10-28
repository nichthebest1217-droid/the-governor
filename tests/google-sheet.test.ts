// The two Apps Script projects, run outside Google against a small fake of the Sheets, Drive, URL,
// cache and page services:
//   google-workspace/publisher/ (Code.gs + the generated Doc.gs and Issue.gs): statuses and IDs,
//     turning Docs into pages, taking articles down, the website's own pages and searches, the
//     one-time archive import, print issues dropped in as PDFs;
//   google-workspace/sheet/Code.gs: instant feedback and upgrading the Sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import { p } from '../scripts/lib/util.ts';

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
const blobOf = (bytes: number[] | Buffer, type: string, name = '') => {
  let n = name;
  const b = { getBytes: () => Array.from(bytes as any).map((x: any) => (x > 127 ? x - 256 : x)), getContentType: () => type, getDataAsString: () => Buffer.from(Array.from(bytes as any).map((x: any) => x & 0xff)).toString('utf8'), setName: (v: string) => { n = v; return b; }, getName: () => n };
  return b;
};
const formatDate = (d: Date, tz: string, fmt: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return fmt.replace("'T'", 'T').replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
};
const TZ = 'America/New_York';
const TODAY = formatDate(new Date(), TZ, 'yyyy-MM-dd');
const APP = 'https://script.google.com/macros/s/APP/exec';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000320000002580806000000', 'hex'); // 800 x 600
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0x01, 0x22, 0x00]); // 400 x 300

const HEADERS = ['Status', 'On the website', 'Title', 'Author(s)', 'Category', 'Publication date', 'Google Doc link', 'Description', 'Image link', 'Image description',
  'Image caption', 'Image credit', 'Type', 'Print issue', 'Order in issue', 'Correction', 'Article text (if no Doc)', 'ID'];
const DOC_A = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DOC_PRIVATE = '1PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP';
const PDF = '1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
const PHOTO = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210ab';
const b64 = (b: Buffer) => b.toString('base64');
const EXPORT = `# Campus Welcomes New Students\n\nBy Jane Doe '27\n\n![Students on the steps][image1]\n\n*Opening day.*\n\nLast week, students gathered in the **Chapel**. Read the [schedule](https://example.org/s) or [this](javascript:alert(1)). ${'word '.repeat(60)}\n\n<img src=x onerror=alert(1)>\n\n# A part\n\n![](data:image/jpeg;base64,${b64(JPEG)})\n\n[image1]: <data:image/png;base64,${b64(PNG)}>\n`;

const ISSUE_PDF = new Uint8Array(readFileSync(p('public/issues/2026-27-issue-1.pdf')));
const PRINT = '1PrintIssueOneAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // the dropped PDF's Drive ID

function world(rows: Record<string, unknown>[]) {
  const articles = new Sheet('Articles', [HEADERS, ...rows.map((r) => HEADERS.map((h) => r[h] ?? ''))]);
  const sheets: Sheet[] = [articles, new Sheet('How to publish', [['How to publish'], [''], ['']]), new Sheet('Homepage', [['Setting', 'Value'], ['Lead story', ''], ['Print issue to promote', '2026-27-issue-1']])];
  const w = {
    articles, sheets, script: new Store(), cache: new Map<string, string>(), fetched: [] as string[], drive: new Map<string, { name: string; bytes: number[]; trashed: boolean; public: boolean }>(), exportText: EXPORT, exportCode: 200, raw: {} as Record<string, { code: number; text?: string; bytes?: Buffer; type?: string }>,
    files: {
      [DOC_A]: { modified: new Date('2026-10-15T15:00:00Z'), mime: 'application/vnd.google-apps.document', access: 'PRIVATE', permission: 'VIEW' },
      [PDF]: { modified: new Date('2026-10-15T15:00:00Z'), mime: 'application/pdf', access: 'PRIVATE', permission: 'VIEW' },
    } as Record<string, any>,
    pages: [] as any[],
    docs: new Map<string, { name: string; html: string; parent: string }>(),
    folders: new Map<string, { name: string; parent: string }>(),
    pdfs: new Map<string, { name: string; bytes: Uint8Array; modifiedTime: string; parent: string }>(),
    shared: [] as string[],
  };
  let nextId = 0;
  const newId = () => 'drv' + String(++nextId).padStart(30, '0'); // as long as Drive's own IDs
  const spreadsheet = chain({
    getSheetByName: (n: string) => sheets.find((s) => s.name === n) ?? null,
    getSheets: () => sheets,
    insertSheet: (n: string) => { const s = new Sheet(n); s.parent = spreadsheet; sheets.push(s); return s; },
    toast: () => {},
    getEditors: () => [{ getEmail: () => 'nicholas.zhuo@govsacademy.org' }, { getEmail: () => 'Editor@govsacademy.org' }],
  });
  sheets.forEach((s) => { s.parent = spreadsheet; });
  const driveFile = (id: string) => {
    const f = w.files[id];
    if (f) return { getId: () => id, getLastUpdated: () => f.modified, getMimeType: () => f.mime, getSharingAccess: () => f.access, getSharingPermission: () => f.permission };
    const own = w.drive.get(id);
    if (own) return { getId: () => id, getBlob: () => blobOf(own.bytes, 'application/json') };
    throw new Error('No item with the given ID could be found');
  };
  const reply = (code: number, text = '', type = 'application/json', bytes: Buffer = Buffer.alloc(0), headers: Record<string, string> = {}) => ({ getResponseCode: () => code, getContentText: () => text, getHeaders: () => headers, getBlob: () => blobOf(bytes, type), getContent: () => Array.from(bytes).map((x) => (x > 127 ? x - 256 : x)) });
  const services: Record<string, unknown> = {
    SpreadsheetApp: { openById: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet, getUi: () => chain(), newRichTextValue: () => { let text = ''; let link: string | null = null; const b = { setText: (t: string) => { text = t; return b; }, setLinkUrl: (_a: number, _b: number, u: string) => { link = u; return b; }, build: () => new Rich(text, link) }; return b; }, newDataValidation: () => chain(), newConditionalFormatRule: () => chain(), WrapStrategy: {}, ProtectionType: {} },
    PropertiesService: { getScriptProperties: () => w.script },
    CacheService: { getScriptCache: () => ({ get: (k: string) => w.cache.get(k) ?? null, put: (k: string, v: string) => { w.cache.set(k, v); }, putAll: (o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) w.cache.set(k, v); }, getAll: (keys: string[]) => Object.fromEntries(keys.filter((k) => w.cache.has(k)).map((k) => [k, w.cache.get(k)])) }) },
    DriveApp: { getFileById: driveFile, searchFiles: () => { const ids = Object.keys(w.files); let i = 0; return { hasNext: () => i < ids.length, next: () => driveFile(ids[i++]) }; }, Permission: { EDIT: 'EDIT', VIEW: 'VIEW' }, Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' } },
    Drive: {
      Files: {
        create: (meta: any, blob?: any) => {
          const id = newId();
          if (meta.mimeType === 'application/vnd.google-apps.document') {
            w.docs.set(id, { name: meta.name, html: blob.getDataAsString(), parent: meta.parents[0] });
            w.files[id] = { modified: new Date('2026-10-28T12:00:00Z'), mime: meta.mimeType, access: 'PRIVATE', permission: 'VIEW' };
            return { id };
          }
          if (meta.mimeType === 'application/vnd.google-apps.folder') w.folders.set(id, { name: meta.name, parent: (meta.parents || [])[0] || 'root' });
          w.drive.set(id, { name: meta.name, bytes: blob ? blob.getBytes() : [], trashed: false, public: false });
          return { id };
        },
        update: (meta: any, id: string, blob?: any) => { const f = w.drive.get(id)!; if (meta.trashed) f.trashed = true; if (blob) f.bytes = blob.getBytes(); return { id }; },
        list: (opts: any) => ({ files: [...w.pdfs.entries()].filter(([, f]) => opts.q.includes(`'${f.parent}' in parents`)).map(([id, f]) => ({ id, name: f.name, modifiedTime: f.modifiedTime, size: String(f.bytes.length) })) }),
        get: (id: string) => { const f = w.pdfs.get(id); if (!f) throw new Error('File not found: ' + id); return { id, name: f.name, modifiedTime: f.modifiedTime }; },
        copy: (meta: any, id: string) => { const f = w.pdfs.get(id)!; const copy = newId(); w.drive.set(copy, { name: meta.name, bytes: Array.from(f.bytes), trashed: false, public: false }); return { id: copy }; },
      },
      Permissions: { create: (perm: any, id: string) => { if (perm.type === 'anyone') w.drive.get(id)!.public = true; if (perm.type === 'user') w.shared.push(perm.emailAddress); } },
    },
    UrlFetchApp: {
      fetch: (url: string, opts: any = {}) => {
        w.fetched.push(url);
        if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) return reply(200, '', 'application/json', Buffer.alloc(0), { Location: 'https://upload.example/session/' + encodeURIComponent(JSON.parse(opts.payload).name) });
        if (url.startsWith('https://upload.example/session/')) { assert.ok(opts.payload && typeof opts.payload.getBytes === 'function', 'uploads send the blob itself'); const id = newId(); w.drive.set(id, { name: decodeURIComponent(url.split('/').pop()!), bytes: opts.payload.getBytes(), trashed: false, public: false }); return reply(200, JSON.stringify({ id })); }
        const doc = /\/document\/d\/([^/]+)\/export/.exec(url);
        if (doc && (doc[1] === DOC_A || w.docs.has(doc[1]))) return reply(w.exportCode, w.exportText);
        const media = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media$/.exec(url);
        if (media) {
          const f = w.pdfs.get(media[1]);
          if (!f) return reply(404);
          const [a, b] = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range)!.slice(1).map(Number);
          return reply(206, '', 'application/pdf', Buffer.from(f.bytes.subarray(a, b + 1)));
        }
        if (url.includes('drive.google.com/thumbnail')) return reply(200, '', 'image/jpeg', JPEG);
        if (w.raw[url]) { const r = w.raw[url]; return reply(r.code, r.text ?? '', r.type ?? 'application/octet-stream', r.bytes ?? Buffer.from(r.text ?? '')); }
        return reply(404);
      },
    },
    Utilities: {
      formatDate, base64Encode: (b: number[]) => Buffer.from(b.map((x) => x & 0xff)).toString('base64'),
      base64Decode: (s: string) => Array.from(Buffer.from(s, 'base64')).map((x) => (x > 127 ? x - 256 : x)),
      newBlob: (bytes: any, type: string, name: string) => blobOf(typeof bytes === 'string' ? Buffer.from(bytes) : bytes, type, name),
      computeDigest: (_a: unknown, s: any) => Array.from(createHash('sha256').update(typeof s === 'string' ? Buffer.from(s, 'utf8') : Buffer.from(s.map((x: number) => x & 0xff))).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    },
    Session: { getScriptTimeZone: () => TZ },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    ScriptApp: { getOAuthToken: () => 'token', getService: () => ({ getUrl: () => APP }), getProjectTriggers: () => [], newTrigger: () => chain(), deleteTrigger: () => {} },
    HtmlService: { createTemplateFromFile: (name: string) => { const t: any = { evaluate: () => { w.pages.push({ name, boot: JSON.parse(t.boot) }); const out: any = chain({}); return out; } }; return t; }, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
    Logger: { log: () => {} },
  };
  const load = (files: string[], names: string, transform = (src: string) => src) => {
    const keys = Object.keys(services);
    const src = transform(files.map((f) => readFileSync(p(f), 'utf8')).join('\n'));
    return new Function(...keys, `${src}\nreturn { ${names} };`)(...keys.map((k) => services[k]));
  };
  const PUBLISHER = ['google-workspace/publisher/Code.gs', 'google-workspace/publisher/Doc.gs', 'google-workspace/publisher/Issue.gs'];
  const NAMES = 'refresh_, tick, publishNow, doGet, api, importArchive, splitImages_, imageSize_, HEADERS, loadJson_, checkPrintIssues_, printFolder_, base64_';
  const pub = load(PUBLISHER, NAMES);
  /** The same publisher one PROCESSOR earlier, sharing this fake Google. */
  const olderPublisher = () => load(PUBLISHER, NAMES, (src) => src.replace(/const PROCESSOR = (\d+);/, (_m, n) => 'const PROCESSOR = ' + (Number(n) - 1) + ';'));
  const sheet = load(['google-workspace/sheet/Code.gs'], 'onEdit, quickNote_, rowFrom_, upgradeColumns_, HEADERS');
  const cell = (row: number, header: string) => articles.get(row, HEADERS.indexOf(header) + 1);
  const link = (row: number, header: string) => articles.links[row - 1]?.[HEADERS.indexOf(header)] ?? null;
  const guide = (row = 3) => String(sheets[1].get(row, 1));
  const live = () => pub.loadJson_('live.json');
  return { w, pub, sheet, cell, link, guide, live, olderPublisher };
}

const ROW = {
  Status: 'Published', Title: 'Campus Welcomes New Students', 'Author(s)': "Jane Doe '27, Sam Lee '28", Category: 'Humor & Fun',
  'Google Doc link': `https://docs.google.com/document/d/${DOC_A}/edit`, Description: 'A new year begins.', Type: 'Article',
};
const ID_A = `${TODAY}-campus-welcomes-new-students`;
const PATH_A = `/${TODAY.replaceAll('-', '/')}/campus-welcomes-new-students/`;

test('both scripts use the same columns and the same shared code; Apps Script can read every file', () => {
  const { pub, sheet } = world([]);
  assert.deepEqual(pub.HEADERS, HEADERS);
  assert.deepEqual(sheet.HEADERS, HEADERS);
  const shared = (file: string) => { const s = readFileSync(p(file), 'utf8'); return s.slice(s.indexOf('\n', s.indexOf('// ===== Shared with')), s.indexOf('// ===== End of shared block')); };
  assert.equal(shared('google-workspace/publisher/Code.gs'), shared('google-workspace/sheet/Code.gs'));
  for (const f of ['google-workspace/publisher/Code.gs', 'google-workspace/publisher/Doc.gs', 'google-workspace/publisher/Issue.gs', 'google-workspace/sheet/Code.gs']) {
    assert.doesNotThrow(() => acorn.parse(readFileSync(p(f), 'utf8'), { ecmaVersion: 2019, sourceType: 'script' }), `${f} must be ES2019 for Apps Script`);
  }
  const manifest = (file: string) => JSON.parse(readFileSync(p(file), 'utf8'));
  assert.deepEqual(manifest('google-workspace/sheet/appsscript.json').oauthScopes.sort(), ['https://www.googleapis.com/auth/script.container.ui', 'https://www.googleapis.com/auth/spreadsheets.currentonly'], 'the Sheet\'s own script can touch nothing but the Sheet');
  assert.equal(manifest('google-workspace/sheet/appsscript.json').webapp, undefined);
  const pubManifest = manifest('google-workspace/publisher/appsscript.json');
  assert.ok(!pubManifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'), 'the publisher never gets full Drive access');
  assert.deepEqual(pubManifest.dependencies.enabledAdvancedServices.map((s: any) => s.serviceId), ['drive']);
  const publicFunctions = [...readFileSync(p('google-workspace/publisher/Code.gs'), 'utf8').matchAll(/^function ([A-Za-z0-9]+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(publicFunctions, ['api', 'doGet', 'importArchive', 'publishNow', 'setUpPublisher', 'tick'], 'readers can call only these; everything else ends in _');
});

test('Published rows become pages within the minute: IDs, dates, Doc text, pictures, byline', () => {
  const { w, pub, cell, link, live } = world([
    ROW,
    { ...ROW, Status: 'Draft', Title: 'Secret draft', 'Google Doc link': `https://docs.google.com/document/d/${DOC_PRIVATE}/edit` },
    { ...ROW, Status: 'Ready for Review', Title: 'Waiting for an editor' },
    { ...ROW, Title: 'No section yet', Category: '' },
    { ...ROW, Title: 'Embargoed', 'Publication date': '2099-01-05' },
    { ...ROW, Title: 'Pasted text', 'Google Doc link': '', 'Article text (if no Doc)': 'First paragraph about the play.\nSecond <b>paragraph</b>. ' + 'More text. '.repeat(30), 'Image link': `https://drive.google.com/file/d/${PHOTO}/view`, 'Image description': 'The cast' },
  ]);
  pub.refresh_();
  assert.equal(cell(2, 'ID'), ID_A);
  assert.ok(cell(2, 'Publication date') instanceof Date, 'an empty date becomes today');
  assert.equal(cell(3, 'ID'), '', 'drafts get no ID');
  const state = live();
  assert.deepEqual(Object.keys(state.articles).sort(), [ID_A, `${TODAY}-pasted-text`].sort());
  const a = state.articles[ID_A];
  assert.equal(a.path, PATH_A);
  assert.deepEqual([a.title, a.section, a.deck, a.authors], ['Campus Welcomes New Students', 'humor-fun', 'A new year begins.', ['jane-doe', 'sam-lee']]);
  assert.deepEqual(a.writers['sam-lee'], { name: 'Sam Lee', classYear: 2028 });
  assert.equal(a.cover.alt, 'Students on the steps', 'the picture at the top of the Doc became the cover');
  assert.equal(a.cover.caption, 'Opening day.');
  assert.deepEqual([a.cover.w, a.cover.h], [800, 600]);
  assert.ok(w.drive.get(a.cover.id)!.public, 'pictures are shared so readers can see them');
  assert.match(a.body, /^<p>Last week, students gathered in the <strong>Chapel<\/strong>/);
  assert.match(a.body, /<a href="https:\/\/example\.org\/s" target="_blank" rel="noopener">schedule<\/a>/);
  assert.ok(!a.body.includes('javascript:') && !a.body.includes('<img src=x'), 'no code from the Doc reaches the page');
  assert.ok(a.body.includes('&lt;img src=x onerror=alert(1)&gt;'), 'HTML typed into the Doc shows as text');
  assert.match(a.body, /<h2[^>]*>A part<\/h2>/, 'Doc headings sit below the headline');
  assert.match(a.body, /<img src="https:\/\/lh3\.googleusercontent\.com\/d\/drv\d+=w400" srcset="[^"]+=w400 400w" sizes="[^"]+" width="400" height="300" alt="" loading="lazy" decoding="async">/);
  assert.ok(!a.body.includes('Campus Welcomes New Students') && !a.body.includes('By Jane Doe'), 'headline and byline come from the Sheet');
  const text = state.articles[`${TODAY}-pasted-text`];
  assert.match(text.body, /<p>First paragraph about the play\.<\/p>\n<p>Second &lt;b&gt;paragraph&lt;\/b&gt;\./);
  assert.deepEqual([text.cover.alt, text.cover.w], ['The cast', 400]);
  assert.equal(cell(2, 'On the website'), `✓ Live: ${APP}?p=${encodeURIComponent(PATH_A)}`);
  assert.equal(link(2, 'On the website'), `${APP}?p=${encodeURIComponent(PATH_A)}`);
  assert.equal(cell(3, 'On the website'), 'Not on the website (draft)');
  assert.equal(cell(4, 'On the website'), 'Not on the website (waiting for review)');
  assert.equal(cell(5, 'On the website'), '⚠ Choose a Category.');
  assert.equal(cell(6, 'On the website'), 'Scheduled for January 5, 2099');
  assert.ok(w.fetched.every((u) => !u.includes(DOC_PRIVATE)), 'a draft Doc is never read');
  assert.match(String(w.sheets[1].get(3, 1)), /^Publishing is ON/);
  assert.equal(w.sheets.find((s) => s.name === 'All articles')!.get(2, 2), 'Campus Welcomes New Students');
});

test('edits rebuild the page; Draft takes it down and its pictures go to the trash', () => {
  const { w, pub, cell, live } = world([ROW]);
  pub.refresh_();
  const first = live().articles[ID_A];
  const fetchesBefore = w.fetched.filter((u) => u.includes('/export')).length;
  pub.refresh_();
  assert.equal(w.fetched.filter((u) => u.includes('/export')).length, fetchesBefore, 'nothing changed, nothing re-read');
  w.files[DOC_A].modified = new Date('2026-10-16T09:00:00Z');
  w.exportText = '# Campus Welcomes New Students\n\nA corrected report. ' + 'Words. '.repeat(60);
  w.script.setProperty('DOCS_FULL_SCAN', '0');
  pub.refresh_();
  const second = live().articles[ID_A];
  assert.notEqual(second.revision, first.revision);
  assert.match(second.body, /A corrected report/);
  assert.ok(w.drive.get(first.cover.id)!.trashed, 'pictures the new version no longer uses are trashed');
  assert.equal(cell(2, 'On the website'), `✓ Live: ${APP}?p=${encodeURIComponent(PATH_A)}`);
  w.articles.set(2, 1, 'Draft');
  pub.refresh_();
  assert.equal(live().articles[ID_A], undefined);
  assert.equal(cell(2, 'On the website'), 'Not on the website (draft)');
  assert.equal(cell(2, 'ID'), ID_A, 'the ID stays, so republishing keeps the address');
});

test('raising PROCESSOR rebuilds every article from its Doc and the rebuilt pages are saved', () => {
  const { w, pub, live, olderPublisher } = world([ROW]);
  olderPublisher().refresh_();
  const older = live().articles[ID_A].processor;
  w.exportText = w.exportText.replace('Last week', 'This week'); // the Doc reads differently; its row and edit time do not change
  pub.refresh_();
  assert.equal(live().articles[ID_A].processor, older + 1, 'rebuilt by the current processor');
  assert.match(live().articles[ID_A].body, /This week, students gathered/, 'and the rebuilt page is saved');
  const exports = w.fetched.filter((u) => u.includes('/export')).length;
  pub.refresh_();
  assert.equal(w.fetched.filter((u) => u.includes('/export')).length, exports, 'once saved, it is not rebuilt again');
});

test('a row with a problem keeps the live version; Google being busy is simply retried', () => {
  const { w, pub, cell, live } = world([ROW, { ...ROW, Title: 'Second story' }]);
  pub.refresh_();
  delete w.files[DOC_A];
  w.script.setProperty('DOCS_FULL_SCAN', '0');
  pub.refresh_();
  assert.ok(live().articles[ID_A], 'still live');
  assert.match(cell(2, 'On the website'), /^⚠ The website still shows the earlier version: The Sheet can't open this Doc/);
  const w2 = world([ROW]);
  w2.w.exportCode = 503;
  w2.pub.refresh_();
  assert.equal(w2.live().articles[ID_A], undefined);
  assert.deepEqual(w2.live().errors, {}, 'a busy Google is not an error');
  assert.match(w2.cell(2, 'On the website'), /^Publishing… \(usually live within a minute\)/);
  w2.w.exportCode = 200;
  w2.w.script.setProperty('LAST_TICK', '0');
  w2.pub.refresh_();
  assert.ok(w2.live().articles[ID_A], 'published on the next check');
});

test('rows vanishing all at once leave the website alone; a not-a-Doc link keeps saying so', () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ ...ROW, Title: `Story ${n}` }));
  const { w, pub, live, guide } = world(rows);
  pub.refresh_();
  assert.equal(Object.keys(live().articles).length, 5);
  w.articles.cells = [w.articles.cells[0]];
  pub.refresh_();
  assert.equal(Object.keys(live().articles).length, 5);
  assert.match(guide(4), /5 published articles disappeared from the Sheet at once/);
  const pdf = world([{ ...ROW, 'Google Doc link': `https://drive.google.com/file/d/${PDF}/view` }]);
  pdf.pub.refresh_();
  pdf.pub.refresh_();
  assert.match(pdf.cell(2, 'On the website'), /^⚠ The Google Doc link points to a file that is not a Google Doc/);
});

test('a copied row never takes the live article\'s ID; a Doc anyone can edit is flagged', () => {
  const { w, pub, cell } = world([{ ...ROW, Status: 'Draft', ID: '2026-10-01-campus-welcomes-new-students' }, { ...ROW, 'Publication date': '2026-10-01', ID: '2026-10-01-campus-welcomes-new-students' }]);
  w.files[DOC_A].access = 'ANYONE_WITH_LINK';
  w.files[DOC_A].permission = 'EDIT';
  pub.refresh_();
  assert.equal(cell(3, 'ID'), '2026-10-01-campus-welcomes-new-students');
  assert.equal(cell(2, 'ID'), '');
  assert.match(cell(3, 'On the website'), /^✓ Live: .*⚠ anyone with the Doc's link can edit it/);
});

test('the website: one page with the data, article texts on request, search; it writes nothing to the Sheet', () => {
  const { w, pub } = world([ROW]);
  pub.refresh_();
  const before = w.articles.snapshot();
  pub.doGet({ parameter: { p: PATH_A } });
  pub.doGet({});
  assert.equal(w.articles.snapshot(), before);
  const [withArticle, home] = w.pages;
  assert.equal(withArticle.name, 'Page');
  assert.equal(withArticle.boot.appUrl, APP);
  assert.deepEqual(withArticle.boot.data.articles.map((a: any) => a.id), [ID_A]);
  assert.ok(!('body' in withArticle.boot.data.articles[0]) && !('text' in withArticle.boot.data.articles[0]), 'texts are not sent with the list');
  assert.match(withArticle.boot.bodies[ID_A], /Last week, students gathered/);
  assert.deepEqual(home.boot.bodies, {});
  assert.deepEqual(withArticle.boot.data.authors['jane-doe'], { name: 'Jane Doe', classYear: 2027, bio: null, photo: null, visible: true });
  assert.match(pub.api({ op: 'body', id: ID_A }).body, /Chapel/);
  assert.deepEqual(pub.api({ op: 'search', q: 'chapel students' }).results.map((r: any) => r.id), [ID_A]);
  assert.deepEqual(pub.api({ op: 'search', q: 'nothing like this' }).results, []);
  assert.throws(() => pub.api({ op: 'tick' }), /Unknown request/);
  assert.equal(pub.tick(), 'too soon', 'the check cannot be hammered from outside');
});

test('the archive is copied into Drive once: pictures and PDFs shared, addresses swapped in', () => {
  const { w, pub } = world([]);
  const from = readFileSync(p('google-workspace/publisher/Code.gs'), 'utf8').match(/const IMPORT_FROM = '([^']+)'/)![1];
  const bundle = {
    version: 1, contactEmail: 'a@b.org',
    articles: [{ id: '2026-05-01-old', title: 'Old', publishedAt: '2026-05-01T10:00:00-04:00', section: 'news', kind: 'article', authors: ['amy'], paras: ['Old news.'], minutes: 1,
      cover: { path: '/media/a.jpg', w: 1200, h: 800, alt: 'A', caption: null, credit: null }, path: '/2026/05/01/old/', text: 'old news',
      body: '<p><img src="gdrive:/media/b.png?w=960" srcset="gdrive:/media/b.png?w=480 480w, gdrive:/media/b.png?w=960 960w"></p>' }],
    authors: { amy: { name: 'Amy', classYear: 2026, bio: null, photo: null, visible: true } },
    issues: [{ id: 'issue-1', title: 'Issue I', year: 2026, pdf: { path: '/issues/i.pdf' }, pages: [{ path: '/media/a.jpg', w: 1200, h: 800 }], notes: [] }],
    brand: { seal: { path: '/media/b.png', w: 512, h: 512 } },
    media: [{ path: '/media/a.jpg', w: 1200, h: 800, bytes: 3 }, { path: '/media/b.png', w: 512, h: 512, bytes: 3 }, { path: '/issues/i.pdf', bytes: 3 }],
  };
  w.raw[from + 'google-workspace/import/archive.json'] = { code: 200, text: JSON.stringify(bundle) };
  for (const m of bundle.media) w.raw[from + 'public' + m.path] = { code: 200, bytes: Buffer.from('abc'), type: m.path.endsWith('pdf') ? 'application/pdf' : 'image/png' };
  assert.match(pub.importArchive(), /The archive is in Drive: 1 articles and 3 pictures and PDFs/);
  const archive = pub.loadJson_('archive.json');
  const ids = pub.loadJson_('media-map.json');
  assert.equal(archive.articles[0].cover.id, ids['/media/a.jpg']);
  assert.equal(archive.articles[0].body, `<p><img src="https://lh3.googleusercontent.com/d/${ids['/media/b.png']}=w960" srcset="https://lh3.googleusercontent.com/d/${ids['/media/b.png']}=w480 480w, https://lh3.googleusercontent.com/d/${ids['/media/b.png']}=w960 960w"></p>`);
  assert.deepEqual(archive.issues[0].pdf, { id: ids['/issues/i.pdf'] });
  const copies = [...w.drive.values()].filter((f) => /^(media|issues)-.*\.(jpg|png|pdf)$/.test(f.name));
  assert.equal(copies.length, 3);
  assert.ok(copies.every((f) => f.public), 'pictures and PDFs are shared so readers can see them');
  assert.ok([...w.drive.values()].filter((f) => f.name.endsWith('.json')).every((f) => !f.public), 'data files stay private');
  assert.equal(pub.importArchive(), 'The archive is already in Drive.');
  pub.doGet({});
  assert.deepEqual(w.pages[0].boot.data.articles.map((a: any) => a.id), ['2026-05-01-old']);
});

test('a print issue dropped into the folder becomes a Doc and a row for each article, waiting for review', () => {
  const { w, pub, cell, live } = world([ROW]);
  const folder = pub.printFolder_();
  assert.equal(w.folders.get(folder)!.name, 'The Governor: print issues');
  w.pdfs.set(PRINT, { name: 'The Governor Issue 1.pdf', bytes: ISSUE_PDF, modifiedTime: '2026-10-28T12:00:00.000Z', parent: folder });
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  // 14 articles after the row that was already there, in print order, waiting for an editor.
  const made = Array.from({ length: 14 }, (_, i) => i + 3);
  assert.deepEqual(made.map((r) => cell(r, 'Status')), made.map(() => 'Ready for Review'));
  assert.equal(cell(3, 'Title'), 'The New and Improved Weight Room');
  assert.equal(cell(3, 'Author(s)'), "Parker Baker '27");
  assert.deepEqual(made.map((r) => cell(r, 'Order in issue')), made.map((_, i) => i + 1));
  assert.deepEqual(new Set(made.map((r) => cell(r, 'Print issue'))), new Set(['2026-27-issue-1']));
  assert.ok(made.every((r) => cell(r, 'Publication date') instanceof Date));
  assert.equal(cell(5, 'Type'), 'Editorial');
  assert.ok(made.every((r) => /^https:\/\/docs\.google\.com\/document\/d\/drv\d+\/edit$/.test(cell(r, 'Google Doc link'))));
  // The Docs, in a folder for the issue inside the print-issues folder.
  assert.equal(w.docs.size, 14);
  const weight = [...w.docs.values()].find((d) => d.name === 'The New and Improved Weight Room')!;
  assert.equal(w.folders.get(weight.parent)!.name, 'Issue I, 2026–27 articles');
  assert.equal(w.folders.get(weight.parent)!.parent, folder);
  assert.match(weight.html, /<h1>The New and Improved Weight Room<\/h1>\n<p[^>]*>By Parker Baker '27<\/p>/);
  assert.match(weight.html, /<img src="data:image\/(png|jpeg);base64,[A-Za-z0-9+/]{100,}={0,2}" alt="Coach KK, class of 2021">/, 'the photo is in the Doc, with its caption');
  // The issue's row.
  const tab = w.sheets.find((x) => x.name === 'Issues')!;
  assert.deepEqual([tab.get(2, 1), tab.get(2, 3), tab.get(2, 4), tab.get(2, 6)], ['Ready for Review', 'Issue I, 2026⁠–⁠27', '2026-27-issue-1', `https://drive.google.com/file/d/${PRINT}/view`]);
  assert.match(String(tab.get(2, 8)), /^Made from The Governor Issue 1\.pdf on .*: 14 articles\. .*MAD LIB/);
  assert.equal(cell(2, 'Title'), ROW.Title, 'rows already there are left alone');
  // Nothing is public yet.
  pub.refresh_();
  assert.deepEqual(Object.keys(live().articles), [ID_A]);
  assert.equal(cell(3, 'On the website'), 'Not on the website (waiting for review)');
  assert.equal(tab.get(2, 2), 'Not on the website (waiting for review)');
  assert.deepEqual(live().issues, []);
  // Dropping the same PDF again does nothing; a replaced PDF adds only what is new.
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  assert.equal(w.docs.size, 14);
  w.pdfs.get(PRINT)!.modifiedTime = '2026-10-28T13:00:00.000Z';
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  assert.equal(w.docs.size, 14);
  assert.equal(w.articles.getLastRow(), 16);
  assert.match(String(tab.get(2, 8)), /14 articles \(14 were already in the Sheet\)/);
});

test('publishing the issue puts its PDF on the website and its waiting articles with it', () => {
  const { w, pub, cell, live } = world([]);
  w.sheets.find((x) => x.name === 'Homepage')!.set(3, 2, '2026-spring-issue-4');
  const folder = pub.printFolder_();
  w.pdfs.set(PRINT, { name: 'The Governor Issue 1.pdf', bytes: ISSUE_PDF, modifiedTime: '2026-10-28T12:00:00.000Z', parent: folder });
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  w.articles.set(3, 1, 'Draft'); // an editor holds one article back
  const tab = w.sheets.find((x) => x.name === 'Issues')!;
  tab.set(2, 1, 'Published');
  pub.refresh_();
  assert.equal(cell(2, 'Status'), 'Published');
  assert.equal(cell(3, 'Status'), 'Draft', 'an article an editor set back to Draft stays a draft');
  assert.equal(Object.keys(live().articles).length, 13);
  const issue = live().issues[0];
  assert.equal(issue.id, '2026-27-issue-1');
  assert.deepEqual([issue.title, issue.dateLabel, issue.season, issue.year, issue.number], ['Issue I, 2026⁠–⁠27', 'October 9, 2026', 'Fall', 2026, 1]);
  assert.ok(w.drive.get(issue.pdf.id)!.public, 'the website shows a public copy of the PDF');
  assert.equal(issue.cover.id, issue.pdf.id, 'Drive draws the cover from the PDF');
  assert.equal(String(tab.get(2, 2)), `✓ Live: ${APP}?p=${encodeURIComponent('/issues/2026-27-issue-1/')}`);
  assert.equal(w.sheets.find((x) => x.name === 'Homepage')!.get(3, 2), '2026-27-issue-1', 'the front page promotes the new issue');
  pub.doGet({ parameter: { p: '/issues/2026-27-issue-1/' } });
  const boot = w.pages[w.pages.length - 1].boot;
  assert.equal(boot.data.issues.find((i: any) => i.id === '2026-27-issue-1').pdf.id, issue.pdf.id);
  // Publishing happens once: an article taken down afterwards stays down.
  w.articles.set(4, 1, 'Draft');
  pub.refresh_();
  assert.equal(cell(4, 'Status'), 'Draft');
  assert.ok(w.shared.includes('editor@govsacademy.org') && !w.shared.includes('nicholas.zhuo@govsacademy.org'), 'the Sheet\'s editors may use the print-issues folder');
});

test('an issue dated a few days ahead goes up, articles and all, the moment it is Published', () => {
  const { w, pub, cell, live } = world([]);
  const folder = pub.printFolder_();
  w.pdfs.set(PRINT, { name: 'The Governor Issue 1.pdf', bytes: ISSUE_PDF, modifiedTime: '2026-10-28T12:00:00.000Z', parent: folder });
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  const later = new Date('2099-10-30T12:00:00');
  for (let r = 2; r <= 15; r++) w.articles.set(r, HEADERS.indexOf('Publication date') + 1, later);
  pub.refresh_();
  assert.equal(cell(2, 'On the website'), 'Not on the website (waiting for review)');
  w.sheets.find((x) => x.name === 'Issues')!.set(2, 1, 'Published');
  pub.refresh_();
  assert.equal(Object.keys(live().articles).length, 14, 'not held back as scheduled');
  assert.match(cell(2, 'On the website'), /^✓ Live: /);
  assert.ok(Object.values<any>(live().articles).every((a) => a.publishedAt === '2099-10-30'), 'they keep the date printed on the issue');
});

test('a long issue is made over several checks without making anything twice; an unreadable PDF is reported', () => {
  const { w, pub } = world([]);
  const folder = pub.printFolder_();
  w.pdfs.set(PRINT, { name: 'The Governor Issue 1.pdf', bytes: ISSUE_PDF, modifiedTime: '2026-10-28T12:00:00.000Z', parent: folder });
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now() - 4.4 * 60 * 1000);
  assert.equal(w.docs.size, 0, 'out of time: nothing more is started');
  assert.equal(w.articles.getLastRow(), 1);
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  assert.equal(w.docs.size, 14);
  assert.equal(w.articles.getLastRow(), 15);
  w.pdfs.set('1BrokenPdfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { name: 'Not really a PDF.pdf', bytes: new Uint8Array(Buffer.from('this is not a pdf at all')), modifiedTime: '2026-10-28T12:00:00.000Z', parent: folder });
  pub.checkPrintIssues_(w.sheets[0].getParent(), Date.now());
  const tab = w.sheets.find((x) => x.name === 'Issues')!;
  assert.match(String(tab.get(3, 8)), /^⚠ This PDF could not be read: /);
  assert.equal(pub.base64_(new Uint8Array([104, 105, 33, 255])), Buffer.from([104, 105, 33, 255]).toString('base64'));
});

test('picture sizes are read from the file itself', () => {
  const { pub } = world([]);
  assert.deepEqual(pub.imageSize_(Array.from(PNG)), { w: 800, h: 600 });
  assert.deepEqual(pub.imageSize_(Array.from(JPEG)), { w: 400, h: 300 });
  const out = pub.splitImages_('Text ![a](data:image/png;base64,AAA=) more\n\n![b][image7]\n\n[image7]: <data:image/jpeg;base64,BB\nCC>\n');
  assert.deepEqual(Object.keys(out.images).sort(), ['image7', 'inline1']);
  assert.equal(out.markdown, 'Text ![a][inline1] more\n\n![b][image7]');
});

test('the Sheet\'s own script: instant feedback when a row is edited', () => {
  const { w, sheet, cell } = world([]);
  const row = (o: Record<string, unknown>) => sheet.rowFrom_(HEADERS.map((h) => o[h] ?? ''), HEADERS, {}, 2);
  assert.equal(sheet.quickNote_(row(ROW), '', true, TODAY), 'Publishing… (usually live within a minute)');
  assert.equal(sheet.quickNote_(row(ROW), '✓ Live: x', true, TODAY), 'Updating… (usually live within a minute)');
  assert.equal(sheet.quickNote_(row(ROW), '', false, TODAY), 'Publishing… (the publisher is not running: tell the web editor)');
  assert.equal(sheet.quickNote_(row({ ...ROW, Status: 'Draft' }), '✓ Live: x', true, TODAY), 'Taking it off the website…');
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Author(s)': '' }), '', true, TODAY), "⚠ Add the author(s), for example Jane Doe '27.");
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Google Doc link': 'see my email' }), '', true, TODAY), '⚠ The Google Doc link is not a link to a Google Doc.');
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Publication date': '2099-01-05' }), '', true, TODAY), 'Scheduled for January 5, 2099');
  assert.equal(sheet.quickNote_(row({ ...ROW, 'Publication date': '2099-01-05', 'Print issue': '2026-27-issue-2' }), '', true, TODAY, { '2026-27-issue-2': true }), 'Publishing… (usually live within a minute)', 'an article of a Published issue is not scheduled');
  assert.equal(sheet.quickNote_(row({}), '', true, TODAY), '');
  HEADERS.forEach((h, j) => w.articles.set(2, j + 1, (ROW as any)[h] ?? ''));
  w.sheets[1].set(3, 1, 'Publishing is ON: articles appear on the website about a minute after they are marked Published.');
  sheet.onEdit({ range: w.articles.getRange(2, 1) });
  assert.equal(cell(2, 'On the website'), 'Publishing… (usually live within a minute)');
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
