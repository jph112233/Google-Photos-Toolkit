import fs from 'fs';
import path from 'path';
import { createFilter } from '@rollup/pluginutils';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export function fileToDataUri(file) {
  const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

// Inline binary assets (PNG logos) as base64 data URIs, so the single-file
// userscript never fetches brand images from the network.
export function dataUri(opts = {}) {
  if (!opts.include) {
    throw Error('include option should be specified');
  }
  const filter = createFilter(opts.include, opts.exclude);

  return {
    name: 'datauri',

    load(id) {
      if (!filter(id)) return null;
      this.addWatchFile(id);
      return {
        code: `export default ${JSON.stringify(fileToDataUri(id))};`,
        map: { mappings: '' },
      };
    },
  };
}
