// Reads what a print issue's PDF shows: every letter with its font, size and place on the page,
// the pictures with their place, and the long horizontal rules that separate articles.
//
// Made for the PDFs Canva writes (fonts with a ToUnicode table, every letter placed on its own),
// but it follows the PDF standard closely enough for other tidy PDFs. It runs in Node (the tests)
// and in Apps Script (the publisher), so it is plain code: no Node modules, no classes with fields.
// The caller supplies the file's bytes (a ByteSource, so a large file can be read in pieces) and
// zlib (fflate in Apps Script).

export interface ByteSource { size: number; read(start: number, end: number): Uint8Array }
export interface Zlib { inflate(data: Uint8Array): Uint8Array; deflate(data: Uint8Array): Uint8Array }
/** One letter. x and y are the left end of its baseline, in points from the page's top left. */
export interface Glyph { text: string; font: string; bold: boolean; italic: boolean; size: number; x: number; y: number; w: number; bt: number }
/** The visible part of a picture on the page (points from the top left; a cropped picture's crop) and its size in pixels. */
export interface PageImage { id: number; x0: number; y0: number; x1: number; y1: number; width: number; height: number; alpha: boolean }
export interface Rule { x0: number; x1: number; y: number }
export interface VRule { x: number; y0: number; y1: number }
export interface PdfPage { number: number; width: number; height: number; glyphs: Glyph[]; images: PageImage[]; rules: Rule[]; vrules: VRule[] }
export interface PdfFile { mime: string; bytes: Uint8Array; width: number; height: number }
export interface Pdf { pageCount: number; info: Record<string, string>; page(n: number): PdfPage; image(id: number): PdfFile | null }

type Obj = number | boolean | null | PName | PStr | PRef | PDict | PStream | Obj[];
interface PName { t: 'N'; v: string }
interface PStr { t: 'S'; v: string }
interface PRef { t: 'R'; num: number; gen: number }
interface PDict { t: 'D'; v: Record<string, Obj> }
interface PStream { t: 'T'; dict: Record<string, Obj>; start: number; length: number; inline?: Uint8Array }
interface POp { t: 'O'; v: string }
type Tok = Obj | POp | typeof END_ARRAY | typeof END_DICT | typeof EOF;
type Matrix = number[];

const END_ARRAY = { t: ']' } as const;
const END_DICT = { t: '>>' } as const;
const EOF = { t: 'EOF' } as const;
const SHORT = 'pdf-read: window too short';

// ---------------------------------------------------------------------------------------------
// Tokens

interface Lex { b: Uint8Array; i: number; refs: boolean }

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

function skipSpace(s: Lex) {
  const b = s.b;
  for (;;) {
    while (s.i < b.length && isWhite(b[s.i])) s.i++;
    if (s.i < b.length && b[s.i] === 37) { while (s.i < b.length && b[s.i] !== 10 && b[s.i] !== 13) s.i++; continue; }
    return;
  }
}

function latin1(b: Uint8Array, from = 0, to = b.length): string {
  let out = '';
  for (let i = from; i < to; i += 8192) out += String.fromCharCode.apply(null, Array.prototype.slice.call(b.subarray(i, Math.min(to, i + 8192))) as number[]);
  return out;
}

function next(s: Lex): Tok {
  skipSpace(s);
  const b = s.b;
  if (s.i >= b.length) return EOF;
  const c = b[s.i];
  if (c === 91) { s.i++; return parseArray(s); }
  if (c === 93) { s.i++; return END_ARRAY; }
  if (c === 60 && b[s.i + 1] === 60) { s.i += 2; return parseDict(s); }
  if (c === 62 && b[s.i + 1] === 62) { s.i += 2; return END_DICT; }
  if (c === 40) return { t: 'S', v: literalString(s) };
  if (c === 60) return { t: 'S', v: hexString(s) };
  if (c === 47) {
    s.i++;
    let name = '';
    while (s.i < b.length && !isWhite(b[s.i]) && !isDelim(b[s.i])) {
      if (b[s.i] === 35 && s.i + 2 < b.length) { name += String.fromCharCode(parseInt(String.fromCharCode(b[s.i + 1], b[s.i + 2]), 16)); s.i += 3; }
      else name += String.fromCharCode(b[s.i++]);
    }
    return { t: 'N', v: name };
  }
  if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
    let j = s.i + 1;
    while (j < b.length && ((b[j] >= 48 && b[j] <= 57) || b[j] === 46)) j++;
    const n = parseFloat(latin1(b, s.i, j));
    s.i = j;
    if (s.refs && Number.isInteger(n) && n >= 0) {
      const save = s.i;
      skipSpace(s);
      let k = s.i;
      while (k < b.length && b[k] >= 48 && b[k] <= 57) k++;
      if (k > s.i && k < b.length) {
        const gen = parseInt(latin1(b, s.i, k), 10);
        s.i = k;
        skipSpace(s);
        if (b[s.i] === 82 && (s.i + 1 >= b.length || isWhite(b[s.i + 1]) || isDelim(b[s.i + 1]))) { s.i++; return { t: 'R', num: n, gen }; }
      }
      if (k >= b.length && s.i < b.length) throw new Error(SHORT);
      s.i = save;
    }
    return isNaN(n) ? 0 : n;
  }
  let j = s.i;
  while (j < b.length && !isWhite(b[j]) && !isDelim(b[j])) j++;
  if (j === s.i) { s.i++; return next(s); } // a stray delimiter such as ) or }
  const word = latin1(b, s.i, j);
  s.i = j;
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (word === 'null') return null;
  return { t: 'O', v: word };
}

function parseArray(s: Lex): Obj[] {
  const out: Obj[] = [];
  for (;;) {
    const t = next(s);
    if (t === END_ARRAY) return out;
    if (t === EOF) throw new Error(SHORT);
    if (t === END_DICT || (t && typeof t === 'object' && (t as POp).t === 'O')) continue;
    out.push(t as Obj);
  }
}

function parseDict(s: Lex): PDict {
  const v: Record<string, Obj> = {};
  for (;;) {
    const k = next(s);
    if (k === END_DICT) return { t: 'D', v };
    if (k === EOF) throw new Error(SHORT);
    if (!k || typeof k !== 'object' || (k as PName).t !== 'N') continue;
    const val = next(s);
    if (val === EOF) throw new Error(SHORT);
    if (val === END_DICT) return { t: 'D', v };
    if (val !== END_ARRAY && !(val && typeof val === 'object' && (val as POp).t === 'O')) v[(k as PName).v] = val as Obj;
  }
}

function literalString(s: Lex): string {
  const b = s.b;
  s.i++;
  let depth = 1;
  let out = '';
  while (s.i < b.length) {
    const c = b[s.i++];
    if (c === 92) {
      const d = b[s.i++];
      if (d === 110) out += '\n'; else if (d === 114) out += '\r'; else if (d === 116) out += '\t';
      else if (d === 98) out += '\b'; else if (d === 102) out += '\f';
      else if (d === 13) { if (b[s.i] === 10) s.i++; }
      else if (d === 10) { /* line continuation */ }
      else if (d >= 48 && d <= 55) {
        let n = d - 48;
        for (let k = 0; k < 2 && b[s.i] >= 48 && b[s.i] <= 55; k++) n = n * 8 + (b[s.i++] - 48);
        out += String.fromCharCode(n & 255);
      } else out += String.fromCharCode(d);
    } else if (c === 40) { depth++; out += '('; }
    else if (c === 41) { if (--depth === 0) return out; out += ')'; }
    else out += String.fromCharCode(c);
  }
  throw new Error(SHORT);
}

function hexString(s: Lex): string {
  const b = s.b;
  s.i++;
  let digits = '';
  while (s.i < b.length && b[s.i] !== 62) { if (!isWhite(b[s.i])) digits += String.fromCharCode(b[s.i]); s.i++; }
  if (s.i >= b.length) throw new Error(SHORT);
  s.i++;
  if (digits.length % 2) digits += '0';
  let out = '';
  for (let k = 0; k < digits.length; k += 2) out += String.fromCharCode(parseInt(digits.substr(k, 2), 16));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

const isName = (o: unknown, v?: string): o is PName => !!o && typeof o === 'object' && (o as PName).t === 'N' && (v === undefined || (o as PName).v === v);
const nameOf = (o: unknown) => (isName(o) ? o.v : '');
const isDict = (o: unknown): o is PDict => !!o && typeof o === 'object' && (o as PDict).t === 'D';
const isStream = (o: unknown): o is PStream => !!o && typeof o === 'object' && (o as PStream).t === 'T';
const isRef = (o: unknown): o is PRef => !!o && typeof o === 'object' && (o as PRef).t === 'R';
const num = (o: unknown, d = 0) => (typeof o === 'number' ? o : d);
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  parts.forEach((p) => { n += p.length + 1; });
  const out = new Uint8Array(n);
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; out[at++] = 10; });
  return out;
}

/** Undoes the PNG and TIFF predictors that compressed streams (cross-reference streams, pictures) may use. */
function unpredict(data: Uint8Array, parms: Record<string, Obj> | null): Uint8Array {
  const predictor = parms ? num(parms.Predictor, 1) : 1;
  if (predictor < 2) return data;
  const colors = num(parms!.Colors, 1);
  const bpc = num(parms!.BitsPerComponent, 8);
  const columns = num(parms!.Columns, 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const row = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) {
    const out = data.slice();
    if (bpc === 8) for (let r = 0; r + row <= out.length; r += row) for (let i = bpp; i < row; i++) out[r + i] = (out[r + i] + out[r + i - bpp]) & 255;
    return out;
  }
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (row + 1)];
    const src = r * (row + 1) + 1;
    const dst = r * row;
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const up = r > 0 ? out[dst - row + i] : 0;
      const ul = r > 0 && i >= bpp ? out[dst - row + i - bpp] : 0;
      let v = data[src + i];
      if (type === 1) v += a;
      else if (type === 2) v += up;
      else if (type === 3) v += (a + up) >> 1;
      else if (type === 4) { const p = a + up - ul; const pa = Math.abs(p - a); const pb = Math.abs(p - up); const pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 126) break; // ~>
    if (isWhite(c)) continue;
    if (c === 122 && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    group.push(c - 33);
    if (group.length === 5) {
      let v = 0;
      group.forEach((g) => { v = v * 85 + g; });
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    group.forEach((g) => { v = v * 85 + g; });
    [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1).forEach((x) => out.push(x));
  }
  return new Uint8Array(out);
}

/** UTF-16 text (a ToUnicode destination, or a string marked with a byte-order mark). */
function utf16(bytes: string): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
  return out;
}

function textString(o: unknown): string {
  if (!o || typeof o !== 'object' || (o as PStr).t !== 'S') return '';
  const v = (o as PStr).v;
  return v.charCodeAt(0) === 0xfe && v.charCodeAt(1) === 0xff ? utf16(v.slice(2)) : v;
}

// Single-byte fonts without a ToUnicode table: WinAnsi's extra characters and a few glyph names.
const WIN_ANSI: Record<number, string> = {
  128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž',
  145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ',
};
const GLYPH_NAMES: Record<string, string> = {
  space: ' ', quoteright: '’', quoteleft: '‘', quotedblleft: '“', quotedblright: '”', quotesingle: "'", quotedbl: '"', endash: '–', emdash: '—',
  hyphen: '-', bullet: '•', ellipsis: '…', fi: 'fi', fl: 'fl', period: '.', comma: ',', colon: ':', semicolon: ';', exclam: '!', question: '?',
  parenleft: '(', parenright: ')', ampersand: '&', slash: '/', percent: '%', dollar: '$', numbersign: '#', at: '@', asterisk: '*', plus: '+',
  equal: '=', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

// ---------------------------------------------------------------------------------------------
// The file

export function openPdf(src: ByteSource, zlib: Zlib): Pdf {
  const CHUNK = 65536;
  const chunks: Record<number, Uint8Array> = {};
  function bytes(start: number, end: number): Uint8Array {
    end = Math.min(end, src.size);
    if (end <= start) return new Uint8Array(0);
    if (end - start > 2 * CHUNK) return src.read(start, end);
    const out = new Uint8Array(end - start);
    let pos = start;
    while (pos < end) {
      const k = Math.floor(pos / CHUNK);
      if (!chunks[k]) chunks[k] = src.read(k * CHUNK, Math.min(src.size, (k + 1) * CHUNK));
      const c = chunks[k];
      const from = pos - k * CHUNK;
      const n = Math.min(c.length - from, end - pos);
      if (n <= 0) break;
      out.set(c.subarray(from, from + n), pos - start);
      pos += n;
    }
    return out;
  }

  // Parses the object (or cross-reference section) that starts at `offset`, widening the window until it fits.
  function parseAt<T>(offset: number, fn: (s: Lex) => T): T {
    for (let size = 4096; ; size *= 4) {
      const s: Lex = { b: bytes(offset, offset + size), i: 0, refs: true };
      try { return fn(s); } catch (err) {
        if (String((err as Error).message) !== SHORT || offset + size >= src.size) throw err;
      }
    }
  }

  const where: Record<number, { off: number } | { stm: number; idx: number }> = {};
  const cache: Record<number, Obj> = {};
  let trailer: Record<string, Obj> = {};

  function readObject(s: Lex, offset: number): Obj {
    next(s); next(s);
    const kw = next(s);
    if (!kw || (kw as POp).v !== 'obj') throw new Error('pdf-read: no object at ' + offset);
    const value = next(s);
    const after = s.i;
    const k = next(s);
    if (k && typeof k === 'object' && (k as POp).v === 'stream' && isDict(value)) {
      let i = s.i;
      if (s.b[i] === 13) i++;
      if (s.b[i] === 10) i++;
      return { t: 'T', dict: value.v, start: offset + i, length: -1 };
    }
    if (k === EOF && after >= s.b.length - 1) throw new Error(SHORT);
    return value as Obj;
  }

  function get(num: number): Obj {
    if (num in cache) return cache[num];
    const w = where[num];
    if (!w) return (cache[num] = null);
    cache[num] = null; // guards against loops while the object is read
    if ('off' in w) {
      const o = parseAt(w.off, (s) => readObject(s, w.off));
      if (isStream(o) && o.length < 0) {
        const len = resolve(o.dict.Length);
        o.length = typeof len === 'number' ? len : findEndstream(o.start);
      }
      return (cache[num] = o);
    }
    const stm = resolve(get(w.stm));
    if (!isStream(stm)) return null;
    const data = decoded(stm);
    const first = num(stm.dict.First);
    const s: Lex = { b: data, i: 0, refs: true };
    const n = num(stm.dict.N);
    const heads: number[][] = [];
    for (let k = 0; k < n; k++) heads.push([next(s) as number, next(s) as number]);
    heads.forEach((h) => {
      const t: Lex = { b: data, i: first + h[1], refs: true };
      if (!(h[0] in cache) || h[0] === num) cache[h[0]] = next(t) as Obj;
    });
    return cache[num];
  }

  function findEndstream(start: number): number {
    for (let size = 65536; ; size *= 4) {
      const text = latin1(bytes(start, start + size));
      const at = text.indexOf('endstream');
      if (at >= 0) return at;
      if (start + size >= src.size) return text.length;
    }
  }

  function resolve(o: Obj | undefined): Obj {
    for (let k = 0; k < 20 && isRef(o); k++) o = get(o.num);
    return o === undefined ? null : o;
  }
  const dictOf = (o: Obj | undefined): Record<string, Obj> => {
    const r = resolve(o);
    return isDict(r) ? r.v : isStream(r) ? r.dict : {};
  };

  function raw(st: PStream): Uint8Array {
    return st.inline || bytes(st.start, st.start + st.length);
  }

  /** The stream's bytes with every filter undone, except picture codecs (DCT, JPX), which stay encoded. */
  function decoded(st: PStream, stopAtImage = false): Uint8Array {
    let data = raw(st);
    const f = resolve(st.dict.Filter);
    const filters = Array.isArray(f) ? f.map((x) => nameOf(resolve(x))) : f ? [nameOf(f)] : [];
    const p = resolve(st.dict.DecodeParms);
    const parms = Array.isArray(p) ? p.map((x) => dictOf(x)) : [p ? dictOf(p) : null];
    for (let k = 0; k < filters.length; k++) {
      const name = filters[k];
      if (name === 'FlateDecode' || name === 'Fl') data = unpredict(zlib.inflate(data), parms[k] || null);
      else if (name === 'ASCIIHexDecode' || name === 'AHx') { const s: Lex = { b: data, i: 0, refs: false }; s.b = concat([new Uint8Array([60]), data]); data = Uint8Array.from(hexString({ b: s.b, i: 0, refs: false }).split('').map((c) => c.charCodeAt(0))); }
      else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85(data);
      else if (name === 'DCTDecode' || name === 'DCT' || name === 'JPXDecode') { if (stopAtImage) return data; throw new Error('pdf-read: picture data in a content stream'); }
      else throw new Error('pdf-read: unsupported filter ' + name);
    }
    return data;
  }

  // Cross-reference tables and streams, newest first.
  (function readXref() {
    const tail = latin1(bytes(Math.max(0, src.size - 2048), src.size));
    const at = tail.lastIndexOf('startxref');
    if (at < 0) throw new Error('This file is not a PDF (no startxref).');
    let offset: number | null = parseInt(tail.slice(at + 9).trim(), 10);
    const seen: Record<number, boolean> = {};
    let first = true;
    while (offset !== null && !isNaN(offset) && !seen[offset]) {
      seen[offset] = true;
      const head = latin1(bytes(offset, offset + 4));
      let dict: Record<string, Obj>;
      if (head === 'xref') {
        dict = parseAt(offset, (s) => {
          s.i = 4;
          for (;;) {
            const a = next(s);
            if (a && typeof a === 'object' && (a as POp).v === 'trailer') break;
            if (a === EOF) throw new Error(SHORT);
            const count = next(s) as number;
            for (let k = 0; k < count; k++) {
              const off = next(s) as number;
              next(s);
              const kind = next(s) as POp;
              if (kind === (EOF as unknown)) throw new Error(SHORT);
              const n = (a as number) + k;
              if (kind && kind.v === 'n' && !(n in where)) where[n] = { off };
            }
          }
          const t = next(s);
          if (!isDict(t)) throw new Error(SHORT);
          return t.v;
        });
        if (typeof dict.XRefStm === 'number') readXrefStream(dict.XRefStm);
      } else {
        dict = readXrefStream(offset);
      }
      if (first) { trailer = dict; first = false; }
      offset = typeof dict.Prev === 'number' ? dict.Prev : null;
    }
  })();

  function readXrefStream(offset: number): Record<string, Obj> {
    const st = parseAt(offset, (s) => readObject(s, offset));
    if (!isStream(st)) throw new Error('pdf-read: broken cross-reference stream');
    const len = st.dict.Length;
    st.length = typeof len === 'number' ? len : findEndstream(st.start);
    const data = decoded(st);
    const w = (st.dict.W as number[]) || [1, 2, 1];
    const index = (st.dict.Index as number[]) || [0, num(st.dict.Size)];
    const field = (at: number, n: number) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + data[at + k]; return v; };
    const rowLen = w[0] + w[1] + w[2];
    let row = 0;
    for (let i = 0; i + 1 < index.length; i += 2) {
      for (let k = 0; k < index[i + 1]; k++, row++) {
        const at = row * rowLen;
        if (at + rowLen > data.length) break;
        const type = w[0] ? field(at, w[0]) : 1;
        const n = index[i] + k;
        if (n in where) continue;
        if (type === 1) where[n] = { off: field(at + w[0], w[1]) };
        else if (type === 2) where[n] = { stm: field(at + w[0], w[1]), idx: field(at + w[0] + w[1], w[2]) };
      }
    }
    return st.dict;
  }

  // Pages, with what they inherit from the page tree.
  interface PageRef { dict: Record<string, Obj>; resources: Record<string, Obj>; box: number[] }
  const pages: PageRef[] = [];
  (function walk(node: Obj, res: Obj | undefined, box: Obj | undefined, depth: number) {
    const d = dictOf(node);
    if (depth > 30) return;
    const r = d.Resources !== undefined ? d.Resources : res;
    const b = d.CropBox !== undefined ? d.CropBox : d.MediaBox !== undefined ? d.MediaBox : box;
    const kids = resolve(d.Kids);
    if (Array.isArray(kids)) kids.forEach((k) => walk(k, r, b, depth + 1));
    else {
      const bx = resolve(b);
      pages.push({ dict: d, resources: dictOf(r), box: Array.isArray(bx) ? bx.map((x) => num(resolve(x))) : [0, 0, 612, 792] });
    }
  })(dictOf(trailer.Root).Pages, undefined, undefined, 0);

  const info: Record<string, string> = {};
  const infoDict = dictOf(trailer.Info);
  Object.keys(infoDict).forEach((k) => { const v = textString(resolve(infoDict[k])); if (v) info[k] = v; });

  // ---- Fonts ---------------------------------------------------------------------------------
  interface Font { name: string; bold: boolean; italic: boolean; twoByte: boolean; width(code: number): number; text(code: number): string }
  const fonts: Record<string, Font> = {};

  function loadFont(ref: Obj): Font {
    const key = isRef(ref) ? 'r' + ref.num : '';
    if (key && fonts[key]) return fonts[key];
    const d = dictOf(ref);
    const base = nameOf(resolve(d.BaseFont)).replace(/^[A-Z]{6}\+/, '');
    const type0 = nameOf(resolve(d.Subtype)) === 'Type0';
    let desc = d;
    let widthOf: (code: number) => number;
    if (type0) {
      const descendants = resolve(d.DescendantFonts);
      desc = dictOf(Array.isArray(descendants) ? descendants[0] : null);
      const dw = num(resolve(desc.DW), 1000);
      const widths: Record<number, number> = {};
      const w = resolve(desc.W);
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length;) {
          const a = num(resolve(w[i]));
          const b = resolve(w[i + 1]);
          if (Array.isArray(b)) { b.forEach((x, k) => { widths[a + k] = num(resolve(x)); }); i += 2; }
          else { const last = num(b); const v = num(resolve(w[i + 2])); for (let c = a; c <= last && c - a < 65536; c++) widths[c] = v; i += 3; }
        }
      }
      widthOf = (code) => (code in widths ? widths[code] : dw);
    } else {
      const firstChar = num(resolve(d.FirstChar));
      const list = resolve(d.Widths);
      const missing = num(resolve(dictOf(d.FontDescriptor).MissingWidth), 500);
      widthOf = (code) => (Array.isArray(list) && code >= firstChar && code - firstChar < list.length ? num(resolve(list[code - firstChar])) : missing);
    }
    const fd = dictOf(desc.FontDescriptor);
    const flags = num(resolve(fd.Flags));
    const bold = /Bold|Black|Heavy|Semibold|Demi/i.test(base) || num(resolve(fd.FontWeight)) >= 600 || (flags & 262144) !== 0;
    const italic = /Italic|Oblique/i.test(base) || (flags & 64) !== 0;
    const map: Record<number, string> = {};
    const tu = resolve(d.ToUnicode);
    if (isStream(tu)) parseCMap(decoded(tu), map);
    const simple: Record<number, string> = {};
    if (!type0) {
      const enc = resolve(d.Encoding);
      const diffs = isDict(enc) ? resolve(enc.v.Differences) : null;
      if (Array.isArray(diffs)) {
        let code = 0;
        diffs.forEach((x) => {
          const v = resolve(x);
          if (typeof v === 'number') code = v;
          else if (isName(v)) {
            const g = v.v;
            simple[code++] = GLYPH_NAMES[g] || (/^uni[0-9A-F]{4}$/.test(g) ? String.fromCharCode(parseInt(g.slice(3), 16)) : g.length === 1 ? g : '');
          }
        });
      }
    }
    const font: Font = {
      name: base, bold, italic, twoByte: type0, width: widthOf,
      text: (code) => (code in map ? map[code] : type0 ? '' : code in simple ? simple[code] : WIN_ANSI[code] || (code >= 32 ? String.fromCharCode(code) : '')),
    };
    if (key) fonts[key] = font;
    return font;
  }

  function parseCMap(data: Uint8Array, map: Record<number, string>) {
    const s: Lex = { b: data, i: 0, refs: false };
    const code = (v: string) => { let n = 0; for (let k = 0; k < v.length; k++) n = n * 256 + v.charCodeAt(k); return n; };
    const stack: Tok[] = [];
    for (;;) {
      const t = next(s);
      if (t === EOF) return;
      if (t && typeof t === 'object' && (t as POp).t === 'O') {
        const op = (t as POp).v;
        if (op === 'endbfchar') {
          for (let k = 0; k + 1 < stack.length; k += 2) {
            const a = stack[k] as PStr; const b = stack[k + 1] as PStr;
            if (a && a.t === 'S' && b && b.t === 'S') map[code(a.v)] = utf16(b.v);
          }
        } else if (op === 'endbfrange') {
          for (let k = 0; k + 2 < stack.length; k += 3) {
            const lo = stack[k] as PStr; const hi = stack[k + 1] as PStr; const dst = stack[k + 2];
            if (!lo || lo.t !== 'S' || !hi || hi.t !== 'S') continue;
            const a = code(lo.v); const b = code(hi.v);
            for (let c = a; c <= b && c - a < 65536; c++) {
              if (Array.isArray(dst)) { const d = dst[c - a] as PStr; if (d && d.t === 'S') map[c] = utf16(d.v); }
              else if (dst && (dst as PStr).t === 'S') {
                const v = (dst as PStr).v;
                const last = v.charCodeAt(v.length - 1) + (c - a);
                map[c] = utf16(v.slice(0, -1) + String.fromCharCode(last & 255)) + (last > 255 ? '' : '');
              }
            }
          }
        }
        stack.length = 0;
      } else stack.push(t);
    }
  }

  // ---- Colour spaces and pictures --------------------------------------------------------------
  interface Space { comps: number; kind: 'gray' | 'rgb' | 'cmyk' | 'indexed'; palette?: Uint8Array; base?: Space; hival?: number }
  function space(o: Obj): Space | null {
    const v = resolve(o);
    const n = isName(v) ? v.v : Array.isArray(v) ? nameOf(resolve(v[0])) : '';
    if (n === 'DeviceGray' || n === 'CalGray' || n === 'G') return { comps: 1, kind: 'gray' };
    if (n === 'DeviceRGB' || n === 'CalRGB' || n === 'RGB' || n === 'Lab') return { comps: 3, kind: 'rgb' };
    if (n === 'DeviceCMYK' || n === 'CMYK') return { comps: 4, kind: 'cmyk' };
    if (n === 'ICCBased' && Array.isArray(v)) {
      const st = resolve(v[1]);
      const comps = isStream(st) ? num(resolve(st.dict.N), 3) : 3;
      return comps === 1 ? { comps: 1, kind: 'gray' } : comps === 4 ? { comps: 4, kind: 'cmyk' } : { comps: 3, kind: 'rgb' };
    }
    if ((n === 'Indexed' || n === 'I') && Array.isArray(v)) {
      const base = space(v[1]);
      const lookup = resolve(v[3]);
      const table = isStream(lookup) ? decoded(lookup) : lookup && (lookup as PStr).t === 'S' ? Uint8Array.from((lookup as PStr).v.split('').map((c) => c.charCodeAt(0))) : null;
      if (!base || !table) return null;
      return { comps: 1, kind: 'indexed', palette: table, base, hival: num(resolve(v[2])) };
    }
    return null;
  }

  const imageStreams: Record<number, PStream> = {};
  let syntheticId = -1;

  function image(id: number): PdfFile | null {
    const st = imageStreams[id] || (id > 0 ? resolve(get(id)) : null);
    if (!isStream(st)) return null;
    const d = st.dict;
    const w = num(resolve(d.Width));
    const h = num(resolve(d.Height));
    if (!w || !h || resolve(d.ImageMask) === true) return null;
    const f = resolve(d.Filter);
    const filters = Array.isArray(f) ? f.map((x) => nameOf(resolve(x))) : f ? [nameOf(f)] : [];
    const cs = space(d.ColorSpace);
    if (filters.indexOf('JPXDecode') >= 0) return null;
    if (filters.indexOf('DCTDecode') >= 0 || filters.indexOf('DCT') >= 0) {
      if (cs && cs.comps === 4) return null; // CMYK JPEGs show inverted in many browsers
      return { mime: 'image/jpeg', bytes: decoded(st, true), width: w, height: h };
    }
    const bpc = num(resolve(d.BitsPerComponent), 8);
    if (!cs || (bpc !== 8 && !(cs.kind === 'indexed' && (bpc === 1 || bpc === 2 || bpc === 4)))) return null;
    const data = decoded(st);
    const rowBytes = Math.ceil((w * cs.comps * bpc) / 8);
    const outComps = cs.kind === 'gray' || (cs.kind === 'indexed' && cs.base && cs.base.kind === 'gray') ? 1 : 3;
    let alpha: Uint8Array | null = null;
    const sm = resolve(d.SMask);
    if (isStream(sm) && num(resolve(sm.dict.Width)) === w && num(resolve(sm.dict.Height)) === h && num(resolve(sm.dict.BitsPerComponent), 8) === 8) {
      try { alpha = decoded(sm); } catch (err) { alpha = null; }
    }
    const channels = outComps + (alpha ? 1 : 0);
    const px = new Uint8Array(w * h * channels);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * channels;
        let r = 0, g = 0, b = 0;
        if (cs.kind === 'indexed') {
          const bitsAt = x * bpc;
          const byte = data[y * rowBytes + (bitsAt >> 3)];
          const idx = bpc === 8 ? byte : (byte >> (8 - bpc - (bitsAt & 7))) & ((1 << bpc) - 1);
          const base = cs.base!;
          const p = Math.min(idx, cs.hival || 255) * base.comps;
          if (base.kind === 'gray') r = g = b = cs.palette![p];
          else if (base.kind === 'cmyk') { const k = cs.palette![p + 3]; r = 255 - Math.min(255, cs.palette![p] + k); g = 255 - Math.min(255, cs.palette![p + 1] + k); b = 255 - Math.min(255, cs.palette![p + 2] + k); }
          else { r = cs.palette![p]; g = cs.palette![p + 1]; b = cs.palette![p + 2]; }
        } else {
          const s = y * rowBytes + x * cs.comps;
          if (cs.kind === 'gray') r = g = b = data[s];
          else if (cs.kind === 'rgb') { r = data[s]; g = data[s + 1]; b = data[s + 2]; }
          else { const k = data[s + 3]; r = 255 - Math.min(255, data[s] + k); g = 255 - Math.min(255, data[s + 1] + k); b = 255 - Math.min(255, data[s + 2] + k); }
        }
        if (outComps === 1) px[o] = r; else { px[o] = r; px[o + 1] = g; px[o + 2] = b; }
        if (alpha) px[o + outComps] = alpha[y * w + x];
      }
    }
    return { mime: 'image/png', bytes: png(w, h, channels, px, zlib), width: w, height: h };
  }

  // ---- Pages -------------------------------------------------------------------------------------
  function page(n: number): PdfPage {
    const p = pages[n - 1];
    if (!p) throw new Error('pdf-read: there is no page ' + n);
    const [bx0, by0, bx1, by1] = p.box;
    const width = Math.abs(bx1 - bx0);
    const height = Math.abs(by1 - by0);
    const out: PdfPage = { number: n, width, height, glyphs: [], images: [], rules: [], vrules: [] };
    const c = resolve(p.dict.Contents);
    const list = Array.isArray(c) ? c.map((x) => resolve(x)) : [c];
    const data = concat(list.filter(isStream).map((st) => decoded(st as PStream)));
    run(data, p.resources, [1, 0, 0, 1, -Math.min(bx0, bx1), -Math.min(by0, by1)], out, 0);
    out.glyphs.forEach((g) => { g.y = height - g.y; });
    out.images.forEach((im) => { const t = height - im.y1; im.y1 = height - im.y0; im.y0 = t; });
    out.rules.forEach((r) => { r.y = height - r.y; });
    out.vrules.forEach((r) => { const t = height - r.y1; r.y1 = height - r.y0; r.y0 = t; });
    return out;
  }

  interface State { ctm: Matrix; font: Font | null; size: number; tc: number; tw: number; th: number; tl: number; rise: number; clip: number[] | null }
  let textObjects = 0;

  function run(data: Uint8Array, res: Record<string, Obj>, ctm: Matrix, out: PdfPage, depth: number) {
    if (depth > 8) return;
    const s: Lex = { b: data, i: 0, refs: false };
    let gs: State = { ctm, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, clip: null };
    const saved: State[] = [];
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    const ops: Tok[] = [];
    let segs: number[][] = []; // [x0, y0, x1, y1] in page space
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let box: number[] | null = null; // the current path's extent
    let clipNext = false;
    const grow = (q: number[]) => { box = box ? [Math.min(box[0], q[0]), Math.min(box[1], q[1]), Math.max(box[2], q[0]), Math.max(box[3], q[1])] : [q[0], q[1], q[0], q[1]]; };
    const fontRes = dictOf(res.Font);
    const xres = dictOf(res.XObject);
    const nums = () => ops.map((o) => (typeof o === 'number' ? o : 0));

    const show = (str: string) => {
      const font = gs.font;
      if (!font) return;
      const m = mul(tm, gs.ctm);
      const sy = Math.hypot(m[2], m[3]);
      const sxScale = Math.hypot(m[0], m[1]);
      const step = font.twoByte ? 2 : 1;
      for (let i = 0; i + step - 1 < str.length; i += step) {
        const code = step === 2 ? (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1) : str.charCodeAt(i);
        const w0 = font.width(code);
        const trm = mul([gs.size * gs.th, 0, 0, gs.size, 0, gs.rise], mul(tm, gs.ctm));
        const text = font.text(code);
        if (text) out.glyphs.push({ text, font: font.name, bold: font.bold, italic: font.italic, size: gs.size * sy, x: trm[4], y: trm[5], w: (w0 / 1000) * gs.size * gs.th * sxScale, bt: textObjects });
        const tx = ((w0 / 1000) * gs.size + gs.tc + (step === 1 && code === 32 ? gs.tw : 0)) * gs.th;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
    };
    const paint = () => {
      if (clipNext && box) gs.clip = gs.clip ? [Math.max(gs.clip[0], box[0]), Math.max(gs.clip[1], box[1]), Math.min(gs.clip[2], box[2]), Math.min(gs.clip[3], box[3])] : box;
      clipNext = false;
      box = null;
      segs.forEach((g) => {
        const x0 = Math.min(g[0], g[2]); const x1 = Math.max(g[0], g[2]);
        if (Math.abs(g[1] - g[3]) <= 3 && x1 - x0 >= 100) out.rules.push({ x0, x1, y: (g[1] + g[3]) / 2 });
        if (Math.abs(g[0] - g[2]) <= 3 && Math.abs(g[1] - g[3]) >= 100) out.vrules.push({ x: (g[0] + g[2]) / 2, y0: Math.min(g[1], g[3]), y1: Math.max(g[1], g[3]) });
      });
      segs = [];
    };

    for (;;) {
      const t = next(s);
      if (t === EOF) break;
      if (!t || typeof t !== 'object' || (t as POp).t !== 'O') { if (t !== END_ARRAY && t !== END_DICT) ops.push(t); continue; }
      const op = (t as POp).v;
      const a = nums();
      switch (op) {
        case 'q': saved.push({ ...gs, clip: gs.clip ? gs.clip.slice() : null }); break;
        case 'Q': gs = saved.pop() || gs; break;
        case 'cm': gs.ctm = mul(a.slice(-6), gs.ctm); break;
        case 'BT': tm = tlm = IDENTITY; textObjects++; break;
        case 'Tf': gs.font = loadFont(fontRes[nameOf(ops[ops.length - 2])]); gs.size = a[a.length - 1]; break;
        case 'Tc': gs.tc = a[0]; break;
        case 'Tw': gs.tw = a[0]; break;
        case 'Tz': gs.th = a[0] / 100; break;
        case 'TL': gs.tl = a[0]; break;
        case 'Ts': gs.rise = a[0]; break;
        case 'Td': tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm; break;
        case 'TD': gs.tl = -a[1]; tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm; break;
        case 'Tm': tlm = a.slice(-6); tm = tlm; break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
        case 'Tj': if (ops.length && (ops[0] as PStr).t === 'S') show((ops[0] as PStr).v); break;
        case "'": tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; if (ops.length && (ops[0] as PStr).t === 'S') show((ops[0] as PStr).v); break;
        case '"': gs.tw = a[0]; gs.tc = a[1]; tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; if ((ops[2] as PStr) && (ops[2] as PStr).t === 'S') show((ops[2] as PStr).v); break;
        case 'TJ': {
          const arr = ops[0];
          if (Array.isArray(arr)) arr.forEach((x) => {
            if (typeof x === 'number') tm = mul([1, 0, 0, 1, (-x / 1000) * gs.size * gs.th, 0], tm);
            else if (x && (x as PStr).t === 'S') show((x as PStr).v);
          });
          break;
        }
        case 'Do': {
          const ref = xres[nameOf(ops[0])];
          const xo = resolve(ref);
          if (!isStream(xo)) break;
          const sub = nameOf(resolve(xo.dict.Subtype));
          if (sub === 'Image') {
            const id = isRef(ref) ? ref.num : syntheticId--;
            imageStreams[id] = xo;
            const pts = [apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)];
            const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
            let r = [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
            if (gs.clip) r = [Math.max(r[0], gs.clip[0]), Math.max(r[1], gs.clip[1]), Math.min(r[2], gs.clip[2]), Math.min(r[3], gs.clip[3])];
            if (r[2] - r[0] > 1 && r[3] - r[1] > 1) out.images.push({ id, x0: r[0], y0: r[1], x1: r[2], y1: r[3], width: num(resolve(xo.dict.Width)), height: num(resolve(xo.dict.Height)), alpha: xo.dict.SMask !== undefined || xo.dict.Mask !== undefined });
          } else if (sub === 'Form') {
            const mtx = resolve(xo.dict.Matrix);
            const m = Array.isArray(mtx) ? mtx.map((x) => num(resolve(x))) : IDENTITY;
            const formRes = xo.dict.Resources !== undefined ? dictOf(xo.dict.Resources) : res;
            run(decoded(xo), formRes, mul(m, gs.ctm), out, depth + 1);
          }
          break;
        }
        case 'BI': {
          // An inline picture: skip its data, which ends at whitespace + EI + whitespace.
          const b = s.b;
          while (s.i < b.length && !(b[s.i] === 73 && b[s.i + 1] === 68 && isWhite(b[s.i + 2]))) s.i++;
          s.i += 3;
          while (s.i < b.length && !(isWhite(b[s.i - 1]) && b[s.i] === 69 && b[s.i + 1] === 73 && (s.i + 2 >= b.length || isWhite(b[s.i + 2])))) s.i++;
          s.i += 2;
          break;
        }
        case 'm': { const q = apply(gs.ctm, a[0], a[1]); cx = sx = q[0]; cy = sy = q[1]; grow(q); break; }
        case 'l': { const q = apply(gs.ctm, a[0], a[1]); segs.push([cx, cy, q[0], q[1]]); cx = q[0]; cy = q[1]; grow(q); break; }
        case 'c': { grow(apply(gs.ctm, a[0], a[1])); grow(apply(gs.ctm, a[2], a[3])); const q = apply(gs.ctm, a[4], a[5]); cx = q[0]; cy = q[1]; grow(q); break; }
        case 'v': case 'y': { grow(apply(gs.ctm, a[0], a[1])); const q = apply(gs.ctm, a[2], a[3]); cx = q[0]; cy = q[1]; grow(q); break; }
        case 'h': segs.push([cx, cy, sx, sy]); cx = sx; cy = sy; break;
        case 're': {
          const corners = [apply(gs.ctm, a[0], a[1]), apply(gs.ctm, a[0] + a[2], a[1]), apply(gs.ctm, a[0] + a[2], a[1] + a[3]), apply(gs.ctm, a[0], a[1] + a[3])];
          const xs = corners.map((q) => q[0]); const ys = corners.map((q) => q[1]);
          const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
          if (y1 - y0 <= 3) segs.push([x0, (y0 + y1) / 2, x1, (y0 + y1) / 2]);
          else if (x1 - x0 <= 3) segs.push([(x0 + x1) / 2, y0, (x0 + x1) / 2, y1]);
          corners.forEach(grow);
          cx = sx = corners[0][0]; cy = sy = corners[0][1];
          break;
        }
        case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': paint(); break;
        case 'W': case 'W*': clipNext = true; break;
        case 'n': segs = []; paint(); break;
        default: break;
      }
      ops.length = 0;
    }
  }

  return { pageCount: pages.length, info, page, image };
}

// ---------------------------------------------------------------------------------------------
// PNG writing (for pictures the PDF stores as raw pixels)

let crcTable: number[] | null = null;
function crc32(bytes: Uint8Array, from: number, to: number): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable.push(c >>> 0); }
  }
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function png(w: number, h: number, channels: number, px: Uint8Array, zlib: Zlib): Uint8Array {
  const stride = w * channels;
  const rows = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) rows.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const idat = zlib.deflate(rows);
  const type = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  const chunk = (name: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let k = 0; k < 4; k++) out[4 + k] = name.charCodeAt(k);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = type;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  let n = 0;
  parts.forEach((p) => { n += p.length; });
  const out = new Uint8Array(n);
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}
