const fs = require('fs');
const pairs = { '{': 1, '}': -1, '(': 1, ')': -1, '[': 1, ']': -1 };
function net(html) {
  let n = 0, sq = 0, dq = 0, bt = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    const pc = i ? html[i - 1] : ' ';
    if (pc === '\\') { continue; }
    if (sq === 1) { if (c === "'") sq = 0; continue }
    if (dq === 1) { if (c === '"') dq = 0; continue }
    if (bt === 1) { if (c === '`') bt = 0; continue }
    if (c === "'") { sq = 1; continue }
    if (c === '"') { dq = 1; continue }
    if (c === '`') { bt = 1; continue }
    if (c === '/' && html[i + 1] === '/') break;
    n += (pairs[c] || 0);
  }
  return n;
}
const lines = fs.readFileSync('assets/map-app.js', 'utf8').split('\n');
for (const num of process.argv.slice(2)) {
  const line = lines[Number(num) - 1] || '';
  console.log('line', num, 'net', net(line), 'len', line.length);
}
