// Publishes what the Google Sheet marks Published, and takes down what it no longer does.
// Run by .github/workflows/sync-docs.yml (the Sheet starts it); safe to run by hand:
//   node scripts/sync-docs.ts            bring the site in line with the Sheet
//   node scripts/sync-docs.ts --check    only say whether the Sheet changed since the last sync
//   node scripts/sync-docs.ts --dry-run  fetch and report, write nothing
// How it works and how to set it up: google-workspace/SETUP.md. The logic: scripts/lib/sheet-sync.ts.
import { appendFileSync } from 'node:fs';
import { ROOT, p, exists, readJson } from './lib/util.ts';
import { TryAgain, checkSheet, syncSheet } from './lib/sheet-sync.ts';

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry-run');
const output = (line: string) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line + '\n'); };
const report = (lines: string[]) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n'); };

const configFile = p('google-workspace/endpoint.json');
if (!exists(configFile)) { console.log('sync-docs: google-workspace/endpoint.json not found; nothing to do.'); output('changed=false'); process.exit(0); }
const { url } = readJson<{ url: string }>(configFile);
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url ?? '')) { console.error('sync-docs: endpoint.json does not hold a Google Apps Script web address.'); process.exit(1); }

try {
  if (CHECK) {
    const { changed, reason } = await checkSheet({ root: ROOT, endpoint: url });
    console.log(`sync-docs: ${reason}.`);
    output(`changed=${changed}`);
    process.exit(0);
  }
  const result = await syncSheet({ root: ROOT, endpoint: url, dryRun: DRY });
  for (const w of result.warnings) console.warn('note: ' + w);
  for (const [id, e] of Object.entries(result.errors)) console.warn(`not published: ${id}: ${e.message}`);
  const head = result.summary.length ? result.summary : ['No article changed.'];
  console.log(`sync-docs: ${head.join('; ')}${result.retryLater ? ' (some changes will be tried again on the next run)' : ''}`);
  if (process.env.RUNNER_TEMP) appendFileSync(`${process.env.RUNNER_TEMP}/sync-summary.txt`, head.join('\n') + '\n');
  report(['### Publishing from the Google Sheet', '', ...head.map((l) => `- ${l}`),
    ...Object.entries(result.errors).map(([id, e]) => `- Not published: \`${id}\`: ${e.message}`),
    ...result.warnings.map((w) => `- Note: ${w}`)]);
} catch (err) {
  if (err instanceof TryAgain) {
    // Google was busy or a row changed mid-run. Nothing was changed; the next run tries again.
    console.warn(`sync-docs: ${err.message}. Nothing was changed; the next run will try again.`);
    output('changed=false');
    report([`Google did not answer this time (${err.message}). Nothing was changed.`]);
    process.exit(0);
  }
  console.error(`sync-docs: ${(err as Error).message}`);
  process.exit(1);
}
