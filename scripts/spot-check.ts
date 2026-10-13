// Independent spot check: fetch the LIVE public HTML page (not the API) for a sample of
// articles and compare headline, date, byline, body text and image count with the built site.
//   node scripts/spot-check.ts          (needs network and dist/)
import { readFileSync } from 'node:fs';
import { slugify } from './lib/util.ts';
import { p, readJson, politeFetch, sleep, htmlToText, wordTokens, writeJson, decodeEntities } from './lib/util.ts';

// Chosen to cover every section, both months, editorials, multi-author bylines, inline
// images, lists, covers and no-cover articles.
const SAMPLE = [9, 49, 115, 148, 181, 200, 236, 256, 261, 292, 297, 304, 317];
const posts = readJson(p('migration/source-inventory.json')).filter((i: any) => SAMPLE.includes(i.legacyWpId));
const aliases = readJson(p('migration/curation/author-aliases.json')).aliases;
const results: any[] = [];
for (const post of posts) {
  const res = await politeFetch(post.legacyUrl);
  const live = await res.text();
  const built = readFileSync(p('dist' + post.legacyPath + 'index.html'), 'utf8');
  const liveTitle = decodeEntities(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(live)?.[1] ?? /<meta property="og:title" content="([^"]*)"/.exec(live)?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
  const liveDate = /<meta property="article:published_time" content="([^"]+)"/.exec(live)?.[1] ?? '';
  const liveBody = /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<!--|<footer|<div[^>]+(?:sharedaddy|jp-relatedposts|entry-footer)|<\/article)/.exec(live)?.[1] ?? '';
  const builtTitle = htmlToText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(built)?.[1] ?? '');
  const builtBody = /<div class="prose">([\s\S]*?)<\/div>\s*<\/div>\s*<footer class="article-foot"/.exec(built)?.[1] ?? '';
  const builtHead = htmlToText(/<header class="article-head[\s\S]*?<\/header>/.exec(built)?.[0] ?? '');
  const liveWords = wordTokens(htmlToText(liveBody.replace(/<div[^>]+class="[^"]*(sharedaddy|jp-relatedposts)[\s\S]*$/, '')));
  const builtWords = wordTokens(htmlToText(builtBody));
  // The live body still contains the byline line; the built page shows it in the header.
  const tail = liveWords.slice(liveWords.length - builtWords.length).join(' ') === builtWords.join(' ');
  const bylineWords = liveWords.slice(0, liveWords.length - builtWords.length);
  const names = (post.bylineAuthors as string[]).every((n) => wordTokens(n.replace(/\(.*?\)/g, '')).slice(-1).every((w) => wordTokens(builtHead).includes(w)));
  results.push({
    legacyWpId: post.legacyWpId, path: post.legacyPath, httpStatus: res.status,
    title: liveTitle === builtTitle, date: liveDate.slice(0, 10) === /<time datetime="([^"]+)"/.exec(built)?.[1].slice(0, 10),
    bodyWords: builtWords.length, bodyMatchesLivePage: tail && builtWords.length > 100,
    leadingWordsOnLivePageOnly: bylineWords.join(' '), 
    // A printed spelling that the curated alias file maps to another writer is expected to differ.
    bylineShown: names || ((post.bylineAuthors as string[]).some((n) => aliases[slugify(n)]) ? 'alias (see review queue)' : false),
    images: `${(liveBody.match(/<img\b/g) ?? []).length} inline on live, ${(builtBody.match(/<img\b/g) ?? []).length} inline on new`,
  });
  await sleep(700);
}
writeJson(p('migration/spot-check.json'), { checkedAt: new Date().toISOString(), method: 'live public HTML vs dist/', results });
console.table(results.map(({ path, leadingWordsOnLivePageOnly, ...r }) => ({ ...r, byline: leadingWordsOnLivePageOnly.slice(0, 40) })));
const bad = results.filter((r) => !(r.title && r.date && r.bodyMatchesLivePage && r.bylineShown));
if (bad.length) { console.error(`${bad.length} spot check(s) failed`); process.exit(1); }
console.log(`spot-check: ${results.length} live pages match the new site`);
