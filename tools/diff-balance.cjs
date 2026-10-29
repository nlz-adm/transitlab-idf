const fs = require('fs');
const { execSync } = require('child_process');
const diff = execSync('git diff HEAD -U0 -- assets/map-app.js', { encoding: 'utf8' });
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
let minus = 0, plus = 0, hunkMinus = 0, hunkPlus = 0, hunkHeader = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('@@')) {
    if (hunkHeader && (hunkMinus !== hunkPlus)) console.log('HUNK IMBALANCE', hunkHeader, 'delta', hunkPlus - hunkMinus);
    hunkHeader = line; hunkMinus = 0; hunkPlus = 0;
  }
  if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff') || line.startsWith('index') || line.startsWith('@@')) continue;
  if (line.startsWith('-')) { minus += net(line.slice(1)); hunkMinus += net(line.slice(1)); }
  else if (line.startsWith('+')) { plus += net(line.slice(1)); hunkPlus += net(line.slice(1)); }
}
if (hunkHeader && (hunkMinus !== hunkPlus)) console.log('HUNK IMBALANCE', hunkHeader, 'delta', hunkPlus - hunkMinus);
console.log('removed net', minus, 'added net', plus, 'delta', plus - minus);
