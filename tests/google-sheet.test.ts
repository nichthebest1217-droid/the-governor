// Runs the Google Sheets publishing script outside Google, with its services stubbed, to check
// that a sheet row plus a Doc's Markdown export becomes a valid article file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { p, readFrontmatter } from '../scripts/lib/util.ts';

const DOC = `# Campus Welcomes New Students

by Jane Doe '27

Last week, students gathered in the **Chapel** for the start of *another* year. Read the [schedule](https://example.org/s).

* First item
* Second item

It was a 9\\-10 week program\\.

![][image1]

` + 'word '.repeat(60) + `

[image1]: <data:image/png;base64,AAAA>
`;

function load(fetch: (url: string) => { code: number; text?: string }) {
  const src = readFileSync(p('google-workspace/Code.gs'), 'utf8');
  const stubs = {
    Session: { getScriptTimeZone: () => 'America/New_York' },
    ScriptApp: { getOAuthToken: () => 'x' },
    Utilities: {
      formatDate: (d: Date) => d.toISOString().slice(0, 10),
      base64Encode: (v: unknown) => Buffer.from(v as any).toString('base64'),
      Charset: { UTF_8: 'utf8' },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => ({ SITE_URL: 'https://org.github.io/the-governor' } as Record<string, string>)[k] ?? null }) },
    UrlFetchApp: { fetch: (url: string) => { const r = fetch(url); return { getResponseCode: () => r.code, getContentText: () => r.text ?? '', getBlob: () => ({ getBytes: () => [1, 2, 3] }) }; } },
    SpreadsheetApp: {},
  };
  const names = Object.keys(stubs);
  return new Function(...names, `${src}\nreturn { buildArticle_, parseWriter_, slugify_, idFromLink_, cleanMarkdown_, COLUMNS };`)(...names.map((n) => (stubs as any)[n]));
}

const gas = load((url) => (url.includes('/export') ? { code: 200, text: DOC } : { code: 200 }));
const row = (over: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = {
    Status: 'Approved', 'Google Doc link': 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit', Headline: 'Campus Welcomes New Students',
    Section: 'Humor & Fun', Writers: "Jane Doe '27, Sam O’Neil ’28 and Lee Park", 'Publication date': '2026-10-20', Type: 'Article',
    'Cover photo link': 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210/view', 'Photo description': 'Students on the chapel steps', Caption: 'Opening day', 'Photo credit': 'Photo by A. B.',
    'Print issue ID': '2026-27-issue-2', 'Order in issue': 3, ...over,
  };
  return gas.COLUMNS.map((c: string) => base[c] ?? '');
};
const col = (name: string) => gas.COLUMNS.indexOf(name);

test('sheet row + Doc export becomes a valid article, writers and photo', () => {
  const a = gas.buildArticle_(row(), col);
  assert.equal(a.path, 'src/content/articles/2026-10-20-campus-welcomes-new-students.md');
  assert.equal(a.url, 'https://org.github.io/the-governor/2026/10/20/campus-welcomes-new-students/');
  const paths = a.files.map((f: any) => f.path);
  assert.deepEqual(paths, ['src/content/authors/jane-doe.json', 'src/content/authors/sam-oneil.json', 'src/content/authors/lee-park.json', 'public/media/2026/10/campus-welcomes-new-students.jpg', a.path]);
  assert.ok(a.files.slice(0, 3).every((f: any) => f.onlyIfMissing), 'existing writer files are never overwritten');
  assert.deepEqual(JSON.parse(a.files[1].content), { slug: 'sam-oneil', name: 'Sam O’Neil', classYear: 2028, bio: null, photo: null, visible: true, needsReview: false, sourceEvidence: 'Added from the publication sheet.' });
  const { data, body } = readFrontmatter(a.files[4].content);
  assert.equal(data.title, 'Campus Welcomes New Students');
  assert.equal(data.section, 'humor-fun');
  assert.equal(data.publishedAt, '2026-10-20');
  assert.deepEqual(data.authors, ['jane-doe', 'sam-oneil', 'lee-park']);
  assert.equal(data.coverImage, '/media/2026/10/campus-welcomes-new-students.jpg');
  assert.equal(data.coverAlt, 'Students on the chapel steps');
  assert.equal(data.issueId, '2026-27-issue-2');
  assert.equal(data.printOrder, 3);
  assert.equal(data.published, true);
  // the Doc's own title and byline lines are dropped; structure and words are kept
  assert.ok(body.trim().startsWith('Last week, students gathered in the **Chapel** for the start of *another* year.'));
  assert.ok(!/Campus Welcomes New Students/.test(body) && !/by Jane Doe/.test(body));
  assert.match(body, /\[schedule\]\(https:\/\/example\.org\/s\)/);
  assert.match(body, /^\* First item$/m);
  assert.match(body, /9-10 week program\./);
  assert.ok(!/image1|data:image/.test(body), 'embedded pictures are removed');
});

test('missing or wrong inputs stop the row with a plain message', () => {
  assert.throws(() => gas.buildArticle_(row({ Headline: '' }), col), /Headline is empty/);
  assert.throws(() => gas.buildArticle_(row({ Section: '' }), col), /Choose a Section/);
  assert.throws(() => gas.buildArticle_(row({ 'Publication date': 'soon' }), col), /Publication date/);
  assert.throws(() => gas.buildArticle_(row({ 'Google Doc link': 'see email' }), col), /Google Doc link/);
  assert.throws(() => gas.buildArticle_(row({ Writers: '' }), col), /at least one writer/);
  assert.throws(() => gas.buildArticle_(row({ 'Photo description': '' }), col), /Photo description/);
  const denied = load(() => ({ code: 403 }));
  assert.throws(() => denied.buildArticle_(row(), col), /Could not read the Doc/);
  const short = load((url) => (url.includes('/export') ? { code: 200, text: '# T\n\nToo short.' } : { code: 200 }));
  assert.throws(() => short.buildArticle_(row(), col), /only \d+ words/);
});

test('a story without a photo needs no photo fields; dates may be real dates', () => {
  const a = gas.buildArticle_(row({ 'Cover photo link': '', 'Photo description': '', 'Publication date': new Date('2026-11-03T12:00:00Z'), Type: 'Editorial', 'Print issue ID': '', 'Order in issue': '' }), col);
  const { data } = readFrontmatter(a.files[a.files.length - 1].content);
  assert.equal(data.coverImage, null);
  assert.equal(data.kind, 'editorial');
  assert.equal(data.publishedAt, '2026-11-03');
  assert.equal(data.issueId, null);
  assert.equal(data.printOrder, null);
});

test('helpers', () => {
  assert.deepEqual(gas.parseWriter_('Adam Krogmeier 27’'), { name: 'Adam Krogmeier', classYear: 2027, slug: 'adam-krogmeier' });
  assert.deepEqual(gas.parseWriter_('DK Rhee'), { name: 'DK Rhee', classYear: null, slug: 'dk-rhee' });
  assert.equal(gas.idFromLink_('https://drive.google.com/open?id=1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210'), '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210');
  assert.equal(gas.idFromLink_('nonsense'), '');
});
