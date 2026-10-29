const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'assets', 'map-app.js');
const src = fs.readFileSync(file, 'utf8');

const startMarker = "function lineLogo(name){return LINE_LOGOS[name]||''}";
const endMarker = "\nfunction pngExists(url){";

const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);
if (start === -1 || end === -1 || end <= start) {
  console.error('MARQUEURS INTROUVABLES', { start, end });
  process.exit(1);
}

const replacement = [
  "function lineLogo(name){return LINE_LOGOS[name]||''}",
  "function networkLogoHtml(name,extra='',meta=lineMeta){const m=meta&&meta[name]||{};const mode=m?.mode||'Metro';const code=customLineCode(name,mode);const color=m?.color||'#314f88';const png=m?.logo||linesMiniPngForLine(name,mode,code);const svg='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(customLineLogoSvgFallbackForMode(mode,code,color,badgeTextColor(color)));const src=png||svg;return'<span class=\"route-badge line-logo-badge '+extra+'\" title=\"'+escapeHtml(name)+'\"><img src=\"'+escapeHtml(src)+'\" alt=\"'+escapeHtml(badgeText(name))+'\"></span>'}",
  "function linesMiniPngForLine(name,mode,code){if(!mode)return null;const c=String(code||'').toLowerCase();if(mode==='RER'){const officialName='RER '+c.toUpperCase();if(LINE_LOGOS[officialName])return LINE_LOGOS[officialName];return customLineOfficialLogoUrl({title:officialName,mode:'RER'})}if(mode==='Transilien'){const officialName='TRAIN '+c.toUpperCase();if(LINE_LOGOS[officialName])return LINE_LOGOS[officialName];return customLineOfficialLogoUrl({title:officialName,mode:'Transilien'})}if(mode==='Tramway'){const officialName='TRAM '+c.toUpperCase();if(LINE_LOGOS[officialName])return LINE_LOGOS[officialName];return customLineOfficialLogoUrl({title:officialName,mode:'Tramway'})}if(mode==='Metro'){if(LINE_LOGOS[name])return LINE_LOGOS[name];const key='METRO '+c.toUpperCase();return LINE_LOGOS[key]||null}return null}",
  ""
].join('\n');

const before = src.slice(0, start);
const after = src.slice(end);
fs.writeFileSync(file, before + replacement + after, 'utf8');
console.log('BLOCK_REPLACED, availLength', (before + replacement + after).length);
