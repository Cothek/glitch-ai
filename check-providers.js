const fs = require('fs');
const p = fs.readFileSync('config/providers.json', 'utf-8');
const c = JSON.parse(p);
const m = c.models || {};
let s = 0, d = 0;
for (const k of Object.keys(m)) {
  if (k.startsWith('nvidia/') && !k.startsWith('nvidia/nvidia/')) s++;
  else if (k.startsWith('nvidia/nvidia/')) d++;
}
console.log('Providers.json model count:', Object.keys(m).length);
console.log('Single-prefix forms:', s);
console.log('Double-prefix forms:', d);
const critical1 = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const critical2 = 'nvidia/nvidia/nemotron-3.5-lightning-30b-a3b';
console.log('Critical model single prefix present:', critical1 in m ? m[critical1].name : 'MISSING');
console.log('Critical model double prefix present:', critical2 in m ? m[critical2].name : 'MISSING');