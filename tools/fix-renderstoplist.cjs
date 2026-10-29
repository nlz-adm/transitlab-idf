'use strict';
const fs = require('fs');
const path = 'assets/map-app.js';
let src = fs.readFileSync(path, 'utf8');
const OLD = 'row.append(order,name,up,down,remove);host.appendChild(row);\n }\nfunction updateCustomLogoVisibility';
const NEW = 'row.append(order,name,up,down,remove);host.appendChild(row);\n })\n}\nfunction updateCustomLogoVisibility';
if (src.split(OLD).length !== 2) { console.error('ancre introuvable ou ambiguë'); process.exit(1); }
src = src.replace(OLD, NEW);
fs.writeFileSync(path, src);
console.log('fermeture forEach réparée');
