import fs from 'fs';
import { fileURLToPath } from 'url';
import { fileToDataUri } from './datauri-plugin.mjs';
const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));


//
// Generate metadata block with information from package.json
// https://sourceforge.net/p/greasemonkey/wiki/Metadata_Block/
// @author victornpb
//

function generateComment(manifest) {
  const largestKey = Object.keys(manifest).reduce((a, b) => a.length > b.length ? a : b).length;
  const generateLine = (key, value) => `// @${key.padEnd(largestKey, ' ')} ${value}`;
  const lines = Object.entries(manifest).map(([key, value]) => {
    if (Array.isArray(value))
      return value.map(subVal => generateLine(key, subVal)).join('\n');
    return generateLine(key, value);
  }).join('\n');
  return [
    '// ==UserScript==',
    lines,
    '// ==/UserScript==',
    '',
  ].join('\n');
}

export default function userScriptMetadataBlock() {
  const pkg = loadJSON('../package.json');

  const metadata = {
    name: pkg.nameFull,
    description: pkg.description,
    version: pkg.version,
    author: pkg.author,
    homepageURL: pkg.homepage,
    supportURL: pkg.bugs.url,
    match: pkg.userScript.match,
    license: pkg.license,
    ...pkg.userScript,
  };

  // A local icon path (e.g. media/brand/prospera-mark.png) is inlined, so the
  // icon works without fetching from a (private) repo.
  if (typeof metadata.icon === 'string' && !/^(https?:|data:)/.test(metadata.icon)) {
    metadata.icon = fileToDataUri(fileURLToPath(new URL(`../${metadata.icon}`, import.meta.url)));
  }

  return generateComment(metadata);
}