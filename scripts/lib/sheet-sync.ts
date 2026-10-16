// Brings the website in line with the Google Sheet. Rows marked Published are added or updated;
// articles whose row is no longer Published (or was deleted) are taken down. Used by
// scripts/sync-docs.ts, which GitHub runs when the Sheet asks it to (see google-workspace/SETUP.md).
//
// The Sheet's web address is public, so everything it sends is treated as untrusted input:
// fields are validated, pictures are re-encoded (which also drops camera data such as GPS
// position), HTML typed into a Doc is shown as text, and only files this sync created are ever
// replaced or removed. What it did is recorded in src/data/cms-sync.json, which the site
// publishes as /publishing-status.json so the Sheet can show "✓ Live" next to each row.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { frontmatter, readFrontmatter } from './util.ts';
import { cleanDocMarkdown, imageRefs, parseWriter, splitWriters, textToMarkdown } from './doc-markdown.ts';

/** Bump when the conversion changes: every Sheet article is then rebuilt on the next run. */
export const PROCESSOR = 2;
export const MANIFEST = 'src/data/cms-sync.json';

const SECTIONS = ['news', 'opinion', 'arts', 'sports', 'humor-fun', 'people', 'school-culture'];
const ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_IMAGES = 40;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
/** Taking down more than this many articles at once (and over half of them) needs a person. */
const MASS_REMOVAL = 3;

export interface ManifestEntry { revision: string; file: string; media: string[]; title: string }
export interface Manifest {
  fingerprint: string | null;
  processor: number;
  articles: Record<string, ManifestEntry>;
  /** Articles that could not be published, with the row version that failed and why. */
  errors: Record<string, { revision: string; message: string }>;
  warnings: string[];
}
export interface SyncOptions {
  root: string;
  endpoint: string;
  /** The website's address, to check that what is live matches the repository (optional). */
  site?: string;
  dryRun?: boolean;
  getJson?: (url: string) => Promise<any>;
  log?: (line: string) => void;
}
export interface SyncResult {
  changed: boolean;
  summary: string[];
  errors: Manifest['errors'];
  warnings: string[];
  retryLater: boolean;
}

/** Something that may work on the next run (Google busy, a row edited mid-sync). */
export class TryAgain extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url: string, tries = 3): Promise<any> {
  let last = '';
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(attempt * 8000);
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(150_000) });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) return JSON.parse(text);
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = (err as Error).message;
    }
  }
  throw new TryAgain(`the Sheet did not answer (${last})`);
}

export function readManifest(root: string): Manifest {
  const file = join(root, MANIFEST);
  const empty: Manifest = { fingerprint: null, processor: PROCESSOR, articles: {}, errors: {}, warnings: [] };
  if (!existsSync(file)) return empty;
  return { ...empty, ...JSON.parse(readFileSync(file, 'utf8')) };
}

interface IndexArticle {
  id: string; revision: string; title: string; authors: string; section: string; date: string;
  kind: string; description: string; image: { alt: string; caption: string; credit: string } | null;
  issue: string; order: string | number; correction: string; source: 'doc' | 'text';
}
/** `held` and `unpublished` are scrambled IDs (see hashId), so the list never reveals unpublished headlines. */
interface Index { fingerprint: string; articles: IndexArticle[]; held: Set<string>; unpublished: Set<string>; settings: any }

/** The same scrambling as hash_() in the publisher script: the first 16 hex digits of SHA-256. */
export const hashId = (id: string) => createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 16);

/** The Sheet's list of Published articles. Anything unexpected stops the sync before it changes anything. */
export function readIndex(raw: any): Index {
  if (raw && raw.ok === false) throw new TryAgain(`the Sheet reported a problem: ${String(raw.error).slice(0, 300)}`);
  if (!raw || raw.version !== 2 || typeof raw.fingerprint !== 'string' || !Array.isArray(raw.articles) || !Array.isArray(raw.held) || !Array.isArray(raw.unpublished)) {
    throw new Error('the Sheet answered in an unexpected format. Is the newest publisher script deployed? (google-workspace/SETUP.md)');
  }
  return { fingerprint: raw.fingerprint, articles: raw.articles, held: new Set(raw.held.map(String)), unpublished: new Set(raw.unpublished.map(String)), settings: raw.settings ?? {} };
}

/**
 * Cheap check before any work: has the Sheet changed since the last sync, and is the website
 * showing what the repository holds? (A failed publish is retried by the next run this way.)
 */
export async function checkSheet(opts: SyncOptions): Promise<{ changed: boolean; redeploy: boolean; reason: string }> {
  const index = readIndex(await (opts.getJson ?? fetchJson)(opts.endpoint));
  const manifest = readManifest(opts.root);
  if (manifest.processor !== PROCESSOR) return { changed: true, redeploy: false, reason: 'the conversion was updated' };
  if (manifest.fingerprint !== index.fingerprint) return { changed: true, redeploy: false, reason: 'the Sheet changed' };
  if (opts.site) {
    try {
      const res = await fetch(`${opts.site.replace(/\/?$/, '/')}publishing-status.json?t=${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const live = (await res.json()).sheet ?? {};
        const want = manifest.articles;
        const same = Object.keys(live).length === Object.keys(want).length && Object.entries(want).every(([id, e]) => live[id]?.revision === e.revision);
        if (!same) return { changed: true, redeploy: true, reason: 'the website is behind the repository (an earlier publish did not finish)' };
      }
    } catch { /* the site could not be reached; nothing to compare */ }
  }
  return { changed: false, redeploy: false, reason: 'nothing changed in the Sheet' };
}

const str = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z')) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

/** Whatever Google sent becomes a plain JPEG (or PNG when it has transparency), at most 2000 px wide. */
async function reencode(bytes: Buffer): Promise<{ data: Buffer; ext: 'jpg' | 'png' }> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('a picture is empty or larger than 30 MB');
  const { default: sharp } = await import('sharp');
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
  const meta = await image.metadata();
  const resized = image.resize({ width: 2000, withoutEnlargement: true });
  if (meta.hasAlpha) return { data: await resized.png({ compressionLevel: 9 }).toBuffer(), ext: 'png' };
  return { data: await resized.flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer(), ext: 'jpg' };
}

export async function syncSheet(opts: SyncOptions): Promise<SyncResult> {
  const { root, endpoint, dryRun = false } = opts;
  const getJson = opts.getJson ?? fetchJson;
  const log = opts.log ?? ((line: string) => console.log(line));
  const at = (rel: string) => join(root, rel);
  const index = readIndex(await getJson(endpoint));
  const before = readManifest(root);
  const next: Manifest = { fingerprint: index.fingerprint, processor: PROCESSOR, articles: {}, errors: {}, warnings: [] };
  const summary: string[] = [];
  let retryLater = false;
  let changed = false;

  const write = (rel: string, data: string | Buffer) => {
    const file = at(rel);
    if (existsSync(file) && Buffer.compare(readFileSync(file), Buffer.from(data)) === 0) return;
    changed = true;
    if (dryRun) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  const remove = (rel: string) => {
    if (!existsSync(at(rel))) return;
    changed = true;
    if (!dryRun) rmSync(at(rel), { recursive: true, force: true });
  };
  const ask = (id: string, revision: string, image?: string) =>
    getJson(`${endpoint}?article=${encodeURIComponent(id)}&rev=${encodeURIComponent(revision)}${image ? `&image=${encodeURIComponent(image)}` : ''}`);
  const issueExists = (id: string) => /^[a-z0-9-]{1,80}$/.test(id) && existsSync(at(`src/content/issues/${id}.json`));
  const fileOwner = (rel: string) => (existsSync(at(rel)) ? readFrontmatter(readFileSync(at(rel), 'utf8')).data.cmsId ?? null : null);

  // Articles marked Published -------------------------------------------------------------
  const listed = new Set<string>(index.articles.map((a) => String(a.id)));
  const isHeld = (id: string) => index.held.has(hashId(id));
  const claimed = new Map<string, string>(); // file -> id, so two rows never share an address
  for (const a of index.articles) {
    const id = String(a.id);
    const revision = str(a.revision, 64);
    const prev = before.articles[id];
    const keepPrevious = () => { if (prev) { next.articles[id] = prev; claimed.set(prev.file, id); } };
    const fail = (message: string) => { next.errors[id] = { revision, message }; log(`  ! ${a.title || id}: ${message}`); keepPrevious(); };
    if (!ID.test(id) || id.length > 110) { next.warnings.push(`A row has an unusable ID (${id.slice(0, 40)}); it was skipped.`); continue; }
    // Fields: the Sheet already checked them; check again, since this is what gets built.
    const title = str(a.title, 200);
    const date = str(a.date, 10);
    const section = str(a.section, 40);
    const writers = splitWriters(str(a.authors, 600)).slice(0, 12).map(parseWriter).filter((w) => w.slug);
    const description = str(a.description, 400);
    if (!title || !validDate(date) || !SECTIONS.includes(section) || !writers.length || !revision) { fail('the row is missing its title, date, category or writers'); continue; }
    if (a.image && !str(a.image.alt, 300)) { fail('the picture needs an Image description'); continue; }
    const fileId = `${date}-${id.replace(/^\d{4}-\d{2}-\d{2}-/, '')}`;
    const file = `src/content/articles/${fileId}.md`;
    const owner = fileOwner(file);
    if (claimed.has(file) || (existsSync(at(file)) && owner !== id)) { fail('another article already has this web address. Change the Title a little and clear the ID cell, and the row gets a new address'); continue; }
    if (prev && prev.revision === revision && prev.file === file && before.processor === PROCESSOR && existsSync(at(file))) { keepPrevious(); continue; }

    try {
      const content = await ask(id, revision);
      if (!content || content.ok !== true) {
        if (content?.retry) throw new TryAgain(str(content.error, 200) || 'the Sheet was busy');
        fail(str(content?.error, 300) || 'the Sheet could not send the article');
        continue;
      }
      const media: string[] = [];
      const folder = `public/media/sheet/${id}`;
      const save = async (ref: string, stem: string) => {
        const img = await ask(id, revision, ref);
        if (!img || img.ok !== true || typeof img.base64 !== 'string') {
          if (img?.retry) throw new TryAgain(str(img.error, 200) || 'the Sheet was busy');
          throw new Error(str(img?.error, 200) || 'a picture could not be downloaded');
        }
        const out = await reencode(Buffer.from(img.base64, 'base64'));
        const rel = `${folder}/${stem}-${sha(out.data).slice(0, 8)}.${out.ext}`;
        write(rel, out.data);
        media.push(rel);
        return rel.slice('public'.length);
      };

      let cover: string | null = null;
      if (a.image) cover = await save('cover', 'cover');
      let body: string;
      let lead: { src: string; alt: string; caption: string | null } | null = null;
      if (content.source === 'text') body = textToMarkdown(str(content.markdown, 200_000));
      else {
        const markdown = str(content.markdown, 2_000_000);
        const refs = imageRefs(markdown);
        if (refs.length > MAX_IMAGES) throw new Error(`the Doc has ${refs.length} pictures; the most an article can carry is ${MAX_IMAGES}`);
        const images: Record<string, string> = {};
        for (const [n, ref] of refs.entries()) images[ref] = await save(ref, String(n + 1));
        const cleaned = cleanDocMarkdown(markdown, { title, images, leadImage: !cover });
        body = cleaned.body;
        lead = cleaned.lead;
        if (cleaned.missing.length) next.warnings.push(`${title}: ${cleaned.missing.length} picture(s) could not be read and were left out.`);
      }
      // A photo story may be short; a text article that is nearly empty is probably the wrong Doc.
      const words = body.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).length;
      if (body.length <= 200 && !/!\[/.test(body) && !cover && !lead) throw new Error(`the article has only ${words} words; is the Doc link right, and is it the finished Doc?`);

      // Writers: an existing writer file is never changed; a new name gets a new file.
      for (const w of writers) {
        const rel = `src/content/authors/${w.slug}.json`;
        if (!existsSync(at(rel))) write(rel, JSON.stringify({ slug: w.slug, name: w.name, classYear: w.classYear, bio: null, photo: null, visible: true, needsReview: false, sourceEvidence: 'Added from the publication Sheet.' }, null, 2) + '\n');
      }
      const issue = str(a.issue, 80);
      if (issue && !issueExists(issue)) next.warnings.push(`${title}: print issue "${issue}" does not exist on the site; left out.`);
      const order = Number(a.order);
      const fm = frontmatter({
        title,
        publishedAt: date,
        section,
        kind: str(a.kind, 20).toLowerCase() === 'editorial' ? 'editorial' : 'article',
        authors: writers.map((w) => w.slug),
        excerpt: description || null,
        coverImage: cover ?? lead?.src ?? null,
        coverAlt: cover ? str(a.image!.alt, 300) : lead?.alt || null,
        coverCaption: cover ? str(a.image!.caption, 400) || null : lead?.caption ?? null,
        coverCredit: cover ? str(a.image!.credit, 200) || null : null,
        issueId: issue && issueExists(issue) ? issue : null,
        printOrder: str(a.order, 10) && Number.isFinite(order) ? order : null,
        correction: str(a.correction, 600) || null,
        published: true,
        cmsId: id,
      });
      write(file, `---\n${fm}\n---\n\n${body}\n`);
      if (prev && prev.file !== file && fileOwner(prev.file) === id) remove(prev.file);
      // Pictures this version no longer uses.
      if (existsSync(at(folder))) for (const f of readdirSync(at(folder))) if (!media.includes(`${folder}/${f}`)) remove(`${folder}/${f}`);
      next.articles[id] = { revision, file, media, title };
      claimed.set(file, id);
      summary.push(`${prev ? 'Updated' : 'Published'}: ${title}`);
      log(`  ${prev ? 'updated' : 'published'} ${file}`);
    } catch (err) {
      // Pictures saved for the version that failed are not kept.
      const folder = at(`public/media/sheet/${id}`);
      if (existsSync(folder)) for (const f of readdirSync(folder)) { const rel = `public/media/sheet/${id}/${f}`; if (!prev?.media.includes(rel)) remove(rel); }
      if (err instanceof TryAgain) { retryLater = true; log(`  ~ ${title}: ${err.message}; will try again`); keepPrevious(); continue; }
      fail((err as Error).message);
    }
  }
  // Rows marked Published that have a problem: the version already on the site stays.
  for (const id of Object.keys(before.articles)) if (!listed.has(id) && isHeld(id) && !next.articles[id]) { next.articles[id] = before.articles[id]; claimed.set(before.articles[id].file, id); }

  // Articles no longer marked Published ---------------------------------------------------
  // A row set to Draft or Ready for Review (or scheduled for later) is taken down. A row that has
  // disappeared from the Sheet is taken down too, unless many disappeared at once: a deleted tab,
  // a filter or a bad paste should not empty the website.
  const gone = Object.keys(before.articles).filter((id) => !listed.has(id) && !isHeld(id));
  const vanished = gone.filter((id) => !index.unpublished.has(hashId(id)));
  const managed = Object.keys(before.articles).length;
  const holdVanished = vanished.length > MASS_REMOVAL && vanished.length > managed / 2;
  if (holdVanished) next.warnings.push(`${vanished.length} published articles have disappeared from the Sheet, so they were left on the website in case this is a mistake. To take them down, put their rows back and set them to Draft.`);
  for (const id of gone) {
    const entry = before.articles[id];
    if (holdVanished && vanished.includes(id)) { next.articles[id] = entry; continue; }
    if (fileOwner(entry.file) === id) remove(entry.file);
    remove(`public/media/sheet/${id}`);
    summary.push(`Taken down: ${entry.title || entry.file}`);
    log(`  took down ${entry.file}`);
  }

  // Front page, masthead and contact details (the Homepage, Site and Masthead tabs) -------
  applySettings(index.settings, { root, write: (rel, value) => write(rel, JSON.stringify(value, null, 2) + '\n'), warn: (w) => next.warnings.push(w) });

  if (retryLater) next.fingerprint = null; // something will be tried again on the next run
  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  const manifestText = JSON.stringify({ ...next, articles: sorted(next.articles), errors: sorted(next.errors) }, null, 2) + '\n';
  if (!existsSync(at(MANIFEST)) || readFileSync(at(MANIFEST), 'utf8') !== manifestText) write(MANIFEST, manifestText);
  return { changed, summary, errors: next.errors, warnings: next.warnings, retryLater };
}

interface SettingsIO { root: string; write: (rel: string, value: unknown) => void; warn: (w: string) => void }

/** Each value is checked; anything that does not fit is ignored and the current setting kept. */
export function applySettings(settings: any, io: SettingsIO) {
  const at = (rel: string) => join(io.root, rel);
  const readJson = (rel: string) => JSON.parse(readFileSync(at(rel), 'utf8'));
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
  const articleExists = (id: unknown) => typeof id === 'string' && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(id) && existsSync(at(`src/content/articles/${id}.md`));
  const s = settings && typeof settings === 'object' ? settings : {};
  if (s.homepage && typeof s.homepage === 'object') {
    const h = s.homepage;
    const current = readJson('src/data/homepage.json');
    const ids = (list: unknown, max: number) => (Array.isArray(list) ? list : []).filter((id) => {
      const ok = articleExists(id);
      if (!ok) io.warn(`Homepage tab: "${String(id).slice(0, 80)}" is not an article on the site.`);
      return ok;
    }).slice(0, max);
    if (h.lead && !articleExists(h.lead)) io.warn(`Homepage tab: the lead story "${String(h.lead).slice(0, 80)}" is not an article on the site.`);
    const issue = text(h.currentIssue, 80);
    const issueOk = issue && /^[a-z0-9-]+$/.test(issue) && existsSync(at(`src/content/issues/${issue}.json`));
    if (issue && !issueOk) io.warn(`Homepage tab: print issue "${issue}" does not exist.`);
    const bannerText = text(h.alert?.text, 200);
    const bannerLink = text(h.alert?.href, 300);
    io.write('src/data/homepage.json', {
      lead: articleExists(h.lead) ? h.lead : null,
      secondary: ids(h.secondary, 5),
      editorsPicks: ids(h.editorsPicks, 4),
      currentIssue: issueOk ? issue : current.currentIssue ?? null,
      alert: bannerText ? { text: bannerText, href: bannerLink && /^(https:\/\/|\/(?!\/))/.test(bannerLink) ? bannerLink : null } : null,
    });
  }
  if (s.site && typeof s.site === 'object') {
    const current = readJson('src/data/site.json');
    // One address, or several separated by commas.
    const email = (v: unknown, label: string) => {
      const raw = text(v, 300);
      if (!raw) return null;
      const list = raw.split(/[,;\s]+/).filter(Boolean);
      if (list.length > 5 || list.some((e) => !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e))) { io.warn(`Site tab: ${label} "${raw}" is not a list of email addresses.`); return null; }
      return list.join(', ');
    };
    // An empty (or unusable) contact email keeps the current one, so the Contact page is never left without one.
    io.write('src/data/site.json', { ...current, contactEmail: email(s.site.contactEmail, 'contact email') ?? current.contactEmail ?? null, tipsEmail: email(s.site.tipsEmail, 'tips email') });
  }
  if (Array.isArray(s.masthead) && s.masthead.length > 0) {
    // An empty Masthead tab changes nothing, so the page is never wiped by accident.
    const current = readJson('src/data/masthead.json');
    const groups: { title: string; members: { name: string; role: string | null }[] }[] = [];
    for (const row of s.masthead.slice(0, 300)) {
      const title = text(row?.group, 60);
      const name = text(row?.name, 80);
      if (!title || !name) continue;
      let g = groups.find((x) => x.title === title);
      if (!g) { g = { title, members: [] }; groups.push(g); }
      g.members.push({ name, role: text(row?.role, 80) });
    }
    if (groups.length) io.write('src/data/masthead.json', { academicYear: text(s.site?.mastheadYear, 20) ?? current.academicYear ?? null, groups });
  }
}
