// `npm run check:i18n`: English has every key Russian has (and no more), with the same {placeholders}, and every key
// the code or the pages use exists.
const fs = require('node:fs');
const { STRINGS } = require('./i18n');

const holders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const problems = [];
for (const key of Object.keys(STRINGS.ru)) {
  if (!(key in STRINGS.en)) problems.push(`missing in en: ${key}`);
  else if (holders(STRINGS.ru[key]) !== holders(STRINGS.en[key])) problems.push(`placeholders differ: ${key}`);
}
for (const key of Object.keys(STRINGS.en)) if (!(key in STRINGS.ru)) problems.push(`missing in ru: ${key}`);

// Keys used literally: t('key'), data-i18n="key", "aria-label:key"; in the app's own files and its windows (ui/src).
const used = new Set();
const pages = fs.readdirSync(__dirname).filter((f) => /\.(js|html)$/.test(f) && !['i18n.js', 'i18n-page.js', 'check-i18n.js'].includes(f));
const windows = fs.readdirSync(`${__dirname}/ui/src`, { recursive: true }).filter((f) => /\.tsx?$/.test(f)).map((f) => `ui/src/${f}`);
for (const file of [...pages, ...windows]) {
  const source = fs.readFileSync(`${__dirname}/${file}`, 'utf8');
  for (const m of source.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  for (const m of source.matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
  for (const m of source.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) used.add(p.split(':')[1]);
}
for (const key of used) if (!(key in STRINGS.en)) problems.push(`used but not defined: ${key}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(STRINGS.en).length} keys`);
