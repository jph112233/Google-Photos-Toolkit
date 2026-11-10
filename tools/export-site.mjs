// Writes the two files the setup page serves at /GooglePhotos/:
//   gptk.user.js  - the full userscript (install + downloadURL)
//   gptk.meta.js  - header block only (Tampermonkey update checks via updateURL,
//                   and the setup page reads @version from it)
// Usage: pnpm build && pnpm export:site [outDir]   (default: dist-site)
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] ?? 'dist-site';
const src = fs.readFileSync('google_photos_toolkit.user.js', 'utf8');
const end = src.indexOf('// ==/UserScript==');
if (end < 0) throw new Error('No userscript header found');
const meta = src.slice(0, end + '// ==/UserScript=='.length) + '\n';
const version = /@version\s+(\S+)/.exec(meta)?.[1];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'gptk.user.js'), src);
fs.writeFileSync(path.join(outDir, 'gptk.meta.js'), meta);
console.log(`Exported v${version} to ${outDir}/gptk.user.js and gptk.meta.js`);
