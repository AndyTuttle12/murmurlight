// Turns the single-file build into an artifact page body (the host supplies doctype/head/body).
import { readFileSync, writeFileSync } from 'node:fs';
let h = readFileSync('dist/index.html', 'utf8');
h = h.replace(/<!doctype html>/i, '').replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '')
  .replace(/<head>/i, '').replace(/<\/head>/i, '').replace(/<body>/i, '').replace(/<\/body>/i, '')
  .replace(/<meta charset="utf-8">/i, '').replace(/<meta name="viewport"[^>]*>/i, '');
h = h.trim();
// Title must be first.
const t = h.match(/<title>.*?<\/title>/)[0];
h = t + '\n' + h.replace(t, '');
writeFileSync('dist/artifact.html', h);
console.log('artifact.html', h.length);
