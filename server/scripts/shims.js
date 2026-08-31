/* eslint-disable */
// @ts-check
// Shim for __dirname - works in both dev (tsx) and bundled CJS
import { dirname, resolve, join } from 'path';
import { pathToFileURL } from 'url';

function getMetaUrl() {
  if (typeof import !== 'undefined' && import.meta && import.meta.url) {
    return import.meta.url;
  }
  return null;
}

let _url;
try {
  const metaUrl = getMetaUrl();
  if (metaUrl && metaUrl.startsWith('file://')) {
    _url = metaUrl;
  } else if (typeof __filename === 'string') {
    _url = pathToFileURL(__filename).href;
  }
} catch (e) {
  _url = null;
}

const __dirname = _url ? dirname(_url.startsWith('file://') ? _url : pathToFileURL(_url).href) : process.cwd();
const __filename = typeof __filename !== 'undefined' ? __filename : join(__dirname, 'bundle.js');

export { __dirname, __filename };
