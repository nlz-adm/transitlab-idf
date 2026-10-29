const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'assets', 'map-app.js');
const src = fs.readFileSync(file, 'utf8');

let state = 'code'; // code | sq | dq | tmpl | lineComment | blockComment | regex | regexClass
let stack = [];
const regexAfterId = /[A-Za-z0-9_$)\]'"`]/; // char before a possible regex start
let lastMeaningful = '';
let line = 1;
for (let i = 0; i < src.length; i++) {
  const ch = src[i], next = src[i + 1];
  if (ch === '\n') line++;
  switch (state) {
    case 'code':
      if (ch === '/' && next === '/') { state = 'lineComment'; i++; continue; }
      if (ch === '/' && next === '*') { state = 'blockComment'; i++; continue; }
      if (ch === "'") { state = 'sq'; continue; }
      if (ch === '"') { state = 'dq'; continue; }
      if (ch === '`') { state = 'tmpl'; continue; }
      if (ch === '/') {
        if (!regexAfterId.test(lastMeaningful)) { state = 'regex'; continue; }
        break;
      }
      if (ch === '{' || ch === '(' || ch === '[') { stack.push({ ch, line, at: i }); }
      else if (ch === '}' || ch === ')' || ch === ']') {
        const open = stack.pop();
        if (open && open.ch === '(tmpl-expr)') { if (ch === '}') { state = 'tmpl'; continue; } }
        const pair = { '}': '{', ')': '(', ']': '[' }[ch];
        if (!open || open.ch !== pair) {
          console.log('UNBALANCED at line', line, ': got', ch, 'expected close of', open ? open.ch + '(' + open.line + ')' : 'nothing');
          console.log('STACK DEPTH', stack.length);
          console.log('STACK >>>', stack.map(x => x.ch + '@L' + x.line + '@pos' + x.at + ':' + JSON.stringify(src.slice(x.at, x.at + 40))).join('\n'));
          console.log('FAILPOS', i, 'CHAR', src[i], 'AROUND >>>', JSON.stringify(src.slice(i - 30, i + 30)));
          process.exit(0);
        }
      }
      if (!/\s/.test(ch)) lastMeaningful = ch;
      continue;
    case 'sq':
      if (ch === '\\') { i++; continue; }
      if (ch === '\n') { console.log('UNCLOSED single-quote string at line', line); process.exit(0); }
      if (ch === "'") { state = 'code'; lastMeaningful = ch; }
      continue;
    case 'dq':
      if (ch === '\\') { i++; continue; }
      if (ch === '\n') { console.log('UNCLOSED double-quote string at line', line); process.exit(0); }
      if (ch === '"') { state = 'code'; lastMeaningful = ch; }
      continue;
    case 'tmpl':
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { state = 'code'; lastMeaningful = ch; }
      else if (ch === '$' && next === '{') { stack.push({ ch: '(tmpl-expr)', line }); state = 'code'; i++; }
      continue;
    case 'lineComment':
      if (ch === '\n') { state = 'code'; }
      continue;
    case 'blockComment':
      if (ch === '*' && next === '/') { state = 'code'; i++; }
      continue;
    case 'regex':
      if (ch === '\\') { i++; continue; }
      if (ch === '[') { state = 'regexClass'; continue; }
      if (ch === '/') { state = 'code'; lastMeaningful = 'x'; }
      continue;
    case 'regexClass':
      if (ch === '\\') { i++; continue; }
      if (ch === ']') { state = 'regex'; }
      continue;
  }
}
if (state !== 'code' && state !== 'lineComment') {
  console.log('ENDED IN STATE', state, 'near line', line);
} else if (stack.length) {
  const last = stack[stack.length - 1];
  console.log('EOF with', stack.length, 'unclosed; deepest last opened', last.ch, 'at line', last.line);
  console.log('LAST CONTEXT >>>', JSON.stringify(src.slice(-160)));
} else {
  console.log('BALANCED');
}
