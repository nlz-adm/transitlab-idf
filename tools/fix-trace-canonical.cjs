'use strict';
const fs = require('fs');
const path = 'assets/map-app.js';
let src = fs.readFileSync(path, 'utf8');
const START = 'const code=customLineCode(value,network.mode)||(';
const END = ":''));if(code)return network.mode+' '+code.toUpperCase()}";
const si = src.indexOf(START);
if (si < 0) { console.error('début ancre introuvable'); process.exit(1); }
const ei = src.indexOf(END, si);
if (ei < 0) { console.error('fin ancre introuvable'); process.exit(1); }
const NEW = "const code=customLineCode(value,network.mode)||(network.mode==='RER'?value.replace(/^RER\\s*/i,'').toUpperCase():(network.mode==='Transilien'?value.replace(/^(?:TRAIN|TRANSILIEN)\\s*/i,'').trim():network.mode==='Tramway'?value.replace(/^(?:TRAM(?:WAY)?)\\s*/i,'').toUpperCase():''));if(code)return network.mode+' '+code.toUpperCase()}";
src = src.slice(0, si) + NEW + src.slice(ei + END.length);
fs.writeFileSync(path, src);
console.log('traceCanonicalLineKey réparée');
