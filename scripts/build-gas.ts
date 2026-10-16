// Builds the generated files of the publisher script (see scripts/lib/gas-build.ts):
//   node scripts/build-gas.ts  ->  google-workspace/publisher/Page.html and Doc.gs
// Paste them into the publisher project with Code.gs (google-workspace/SETUP.md).
import { p, writeFile } from './lib/util.ts';
import { buildGas } from './lib/gas-build.ts';

const { page, doc } = buildGas();
writeFile(p('google-workspace/publisher/Page.html'), page);
writeFile(p('google-workspace/publisher/Doc.gs'), doc);
console.log(`gas: Page.html ${(page.length / 1024).toFixed(0)} KB, Doc.gs ${(doc.length / 1024).toFixed(0)} KB`);
