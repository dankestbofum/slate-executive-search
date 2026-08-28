const fs = require('fs');
const h = fs.readFileSync('slate.html', 'utf8');
const m = h.match(/<style>([\s\S]*?)<\/style>/);
if (!m) throw new Error('no style block');
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/styles.css', m[1].trim() + '\n');
console.log('css bytes', m[1].length);
