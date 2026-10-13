// Shared helpers for the migration and QA scripts.
// Plain TypeScript that Node runs directly (type stripping), so no enums or decorators.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE_ORIGIN = 'https://govsacademynews.wpcomstaging.com';
export const SOURCE_HOSTS = ['govsacademynews.wpcomstaging.com', 'i0.wp.com/govsacademynews.wpcomstaging.com'];

export const p = (...parts: string[]) => resolve(ROOT, ...parts);

export function readJson<T = any>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function writeFile(file: string, data: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

export function writeJson(file: string, data: unknown) {
  writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[ \s]+/g, ' ')
    .trim();
}

/** Words only, for comparing a source article with its migrated copy. */
export function wordTokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UA = 'GovernorMigration/1.0 (student newspaper archive migration; read-only)';

/** GET with retry, exponential backoff, and respect for 429 Retry-After. */
export async function politeFetch(url: string, tries = 5): Promise<Response> {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        if (attempt >= tries) return res;
        await sleep(retryAfter > 0 ? retryAfter : wait);
      } else return res;
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(wait);
    }
    wait *= 2;
  }
}

export function exists(file: string) {
  return existsSync(file);
}

/** Minimal YAML scalar quoting for generated frontmatter. */
export function yamlValue(v: unknown, indent = ''): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '\n' + v.map((x) => `${indent}  - ${yamlValue(x, indent + '  ')}`).join('\n');
  }
  return JSON.stringify(String(v));
}

export function frontmatter(data: Record<string, unknown>): string {
  return Object.entries(data).map(([k, v]) => `${k}: ${yamlValue(v)}`).join('\n');
}

/** Tiny frontmatter reader for files this project generates (scalars and string lists). */
export function readFrontmatter(text: string): { data: Record<string, any>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, any> = {};
  let key = '';
  const scalar = (raw: string): any => {
    const s = raw.trim();
    if (s === '' || s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === '[]') return [];
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s.startsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
    if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    return s;
  };
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(scalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv) { key = kv[1]; data[key] = scalar(kv[2]); }
  }
  return { data, body: m[2] };
}
