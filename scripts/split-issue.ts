// Shows how the publisher will split a print issue's PDF into articles, without touching Google:
//   node scripts/split-issue.ts "path/to/The Governor Issue 2.pdf" [--full]
// The publisher runs the same code when a PDF is dropped into the print-issues folder.
import { readFileSync } from 'node:fs';
import { unzlibSync, zlibSync } from 'fflate';
import { openPdf } from './lib/pdf-read.ts';
import { splitIssue } from './lib/issue-split.ts';
import { p, readJson, exists } from './lib/util.ts';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/split-issue.ts <issue.pdf> [--full]'); process.exit(1); }
const full = process.argv.includes('--full');
const bytes = new Uint8Array(readFileSync(file));
const pdf = openPdf({ size: bytes.length, read: (a, b) => bytes.subarray(a, b) }, { inflate: (d) => unzlibSync(d), deflate: (d) => zlibSync(d) });
const archive = exists(p('google-workspace/import/archive.json')) ? readJson<any>(p('google-workspace/import/archive.json')) : { authors: {} };
const knownNames = Object.values<any>(archive.authors).map((a) => a.name);
const split = splitIssue(pdf, { knownNames });

console.log(`${split.title ?? '(no issue label found)'} · id ${split.id} · date ${split.date} · ${split.articles.length} articles`);
for (const a of split.articles) {
  const images = a.blocks.filter((b) => b.type === 'image');
  console.log(`\n${a.order}. ${a.title}  (page ${a.page}, ${a.category}${a.editorial ? ', editorial' : ''}${a.poem ? ', poem' : ''}${a.gallery ? ', gallery' : ''}, ${a.words} words)`);
  console.log(`   by ${a.authors.join(', ') || '(no writers)'}`);
  images.forEach((b) => { if (b.type === 'image') console.log(`   [picture p${b.image.page} ${b.image.width}x${b.image.height}px${b.image.caption ? ' · "' + b.image.caption + '"' : ''}]`); });
  const paras = a.blocks.filter((b) => b.type !== 'image');
  (full ? paras : paras.slice(0, 2)).forEach((b) => {
    const t = b.type === 'p' ? b.runs.map((r) => (r.bold ? '**' + r.text + '**' : r.text)).join('') : b.type === 'lines' ? b.lines.map((l) => l.map((r) => r.text).join('')).join(' / ') : b.type === 'list' ? b.items.map((it, i) => (b.ordered ? i + 1 + '. ' : '• ') + it.map((r) => r.text).join('')).join('  ') : '';
    console.log('   | ' + (full ? t : t.slice(0, 160) + (t.length > 160 ? '…' : '')));
  });
  if (!full && paras.length > 2) console.log(`   | … ${paras.length} paragraphs`);
}
if (split.skipped.length) console.log('\nNot made into articles:\n' + split.skipped.map((s) => ' - ' + s).join('\n'));
if (split.contributors.length) console.log('\nContributors box: ' + split.contributors.join(', '));
