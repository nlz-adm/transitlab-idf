#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const tmp = process.env.TRANSITLAB_PW_TMP || 'C:\\Users\\moham\\.freebuff\\tmp-playwright';
fs.mkdirSync(tmp, { recursive: true });
for (const name of ['transilien.png','tram.png','rer.png','rer-a.png']) {
  const dest = path.join(tmp, name);
  const src = path.join(__dirname, '..', 'assets', 'lines', name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}
console.log('copied: transilien.png tram.png rer.png rer-a.png');
