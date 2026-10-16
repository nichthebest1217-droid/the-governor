import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { p, readFrontmatter, exists } from '../scripts/lib/util.ts';

const SECTIONS = JSON.parse(readFileSync(p('src/data/navigation.json'), 'utf8')).sections.map((s: any) => s.slug);
const articles = readdirSync(p('src/content/articles')).filter((f) => f.endsWith('.md')).map((f) => ({ f, ...readFrontmatter(readFileSync(p('src/content/articles', f), 'utf8')) }));
const authors = new Set(readdirSync(p('src/content/authors')).map((f) => f.replace(/\.json$/, '')));
const issues = new Set(readdirSync(p('src/content/issues')).map((f) => f.replace(/\.json$/, '')));
const published = articles.filter((a) => a.data.published === true);

test('every article has the required fields and valid references', () => {
  for (const { f, data, body } of articles) {
    assert.ok(typeof data.title === 'string' && data.title.length > 0, `${f}: title`);
    assert.match(String(data.publishedAt), /^\d{4}-\d{2}-\d{2}/, `${f}: publishedAt`);
    assert.ok(SECTIONS.includes(data.section), `${f}: unknown section ${data.section}`);
    for (const a of data.authors ?? []) assert.ok(authors.has(a), `${f}: author "${a}" has no file in src/content/authors`);
    if (data.issueId) assert.ok(issues.has(data.issueId), `${f}: issue "${data.issueId}" does not exist`);
    if (data.coverImage) assert.ok(exists(p('public' + data.coverImage)), `${f}: cover image missing`);
    if (data.published === true) assert.ok(body.trim().length > 200 || /!\[/.test(body) || data.coverImage, `${f}: published with an empty body`);
  }
});

test('filenames start with the publication date; legacy paths agree with it', () => {
  for (const { f, data } of published) {
    assert.ok(f.startsWith(String(data.publishedAt).slice(0, 10) + '-'), `${f}: filename date differs from publishedAt`);
    if (data.legacyPath) assert.ok(data.legacyPath.startsWith('/' + String(data.publishedAt).slice(0, 10).replaceAll('-', '/') + '/'), `${f}: legacyPath date`);
  }
});

test('no two published articles share a web address', () => {
  const seen = new Map<string, string>();
  for (const { f, data } of published) {
    const path = data.legacyPath ?? `/${String(data.publishedAt).slice(0, 10).replaceAll('-', '/')}/${f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '')}/`;
    assert.ok(!seen.has(path), `${f} and ${seen.get(path)} both resolve to ${path}`);
    seen.set(path, f);
  }
});

test('an article is unpublished unless it says published: true', () => {
  const schema = readFileSync(p('src/content.config.ts'), 'utf8');
  assert.match(schema, /published: z\.boolean\(\)\.default\(false\)/);
});

test('author and issue files are consistent', () => {
  for (const slug of authors) {
    const d = JSON.parse(readFileSync(p('src/content/authors', slug + '.json'), 'utf8'));
    assert.equal(d.slug, slug, `authors/${slug}.json: slug must equal the filename`);
    assert.ok(d.name, `authors/${slug}.json: name`);
  }
  for (const slug of issues) {
    const d = JSON.parse(readFileSync(p('src/content/issues', slug + '.json'), 'utf8'));
    assert.equal(d.slug, slug);
    assert.ok((d.sourceEvidence ?? []).length > 0, `issues/${slug}.json: an issue needs evidence`);
    if (d.pdf) assert.ok(exists(p('public' + d.pdf)), `issues/${slug}.json: PDF missing`);
  }
});

test('homepage and CMS configuration reference real things', () => {
  const home = JSON.parse(readFileSync(p('src/data/homepage.json'), 'utf8'));
  const ids = new Set(published.map((a) => a.f.replace(/\.md$/, '')));
  for (const ref of [home.lead, ...(home.secondary ?? []), ...(home.editorsPicks ?? [])].filter(Boolean)) {
    assert.ok(ids.has(String(ref).split('/').pop()!.replace(/\.md$/, '')), `homepage.json: "${ref}" is not a published article`);
  }
  if (home.currentIssue) assert.ok(issues.has(home.currentIssue));
  const cms = readFileSync(p('.pages.yml'), 'utf8');
  for (const s of SECTIONS) assert.ok(cms.includes(`value: ${s},`), `.pages.yml is missing section ${s}`);
  for (const path of ['src/content/articles', 'src/content/authors', 'src/content/issues', 'src/data/homepage.json', 'public/media']) assert.ok(cms.includes(path), `.pages.yml: ${path}`);
});
