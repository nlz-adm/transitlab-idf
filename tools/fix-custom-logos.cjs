// Répare le bloc des logos des lignes personnalisées dans assets/map-app.js :
// - ferme la fonction customLineMode (accolade manquante, erreur de syntaxe)
// - remplace la zone dupliquée/brisée (LAGLEOFS inexistant, doublons, ')')
// - implémente : logo RÉEL (RER A, Train J, T3b…) selon le nom de la ligne,
//   teinté à la couleur choisie via canvas.
'use strict';
const fs = require('fs');
const path = 'assets/map-app.js';
let src = fs.readFileSync(path, 'utf8');

const FIX1_OLD = "return explicit||'Metro'\nfunction customLineDefaultTitle";
const FIX1_NEW = "return explicit||'Metro'}\nfunction customLineDefaultTitle";
if (src.split(FIX1_OLD).length !== 2) {
  console.error('anchor 1 (customLineMode) introuvable ou ambigu');
  process.exit(1);
}
src = src.replace(FIX1_OLD, FIX1_NEW);

const BLOCK_START = 'const CUSTOM_SIGNS={';
const BLOCK_END = 'function lineLogo(name){';
if (src.split(BLOCK_START).length !== 2 || src.split(BLOCK_END).length !== 2) {
  console.error('ancres du bloc ambiguës ou introuvables');
  process.exit(1);
}
const i = src.indexOf(BLOCK_START), j = src.indexOf(BLOCK_END);
if (j <= i) { console.error('ordre des ancres inattendu'); process.exit(1); }

// eslint-disable-next-line no-useless-escape
const BLOCK = `const CUSTOM_SIGNS={Metro:null,RER:'assets/lines-mini/rer.png',Transilien:'assets/lines-mini/transilien.png',Tramway:'assets/lines-mini/tram.png'};const LINE_LOGOS_LC={};for(const key in LINE_LOGOS)LINE_LOGOS_LC[key.toLowerCase()]=LINE_LOGOS[key];
function imageBaseUri(path){const base=document.baseURI||'';return(base.endsWith('/')?base:base+'/')+path}
function customLinePngName(mode,code){const c=String(code||'').toLowerCase();if(mode==='RER')return'rer-'+c+'.png';if(mode==='Transilien')return'transilien-'+c+'.png';if(mode==='Tramway')return'tram-'+c+'.png';return null}
function customLineOfficialLogoUrl(line){const mode=customLineMode(line);if(mode!=='RER'&&mode!=='Transilien'&&mode!=='Tramway')return null;const code=customLineCode(line?.title||'',mode);if(!/^[A-Z0-9]+$/.test(code||''))return null;const prefix=mode==='RER'?'rer ':mode==='Transilien'?'train ':'tram ';const hit=LINE_LOGOS_LC[(prefix+code).toLowerCase()];return hit||imageBaseUri('assets/lines-mini/'+customLinePngName(mode,code))}
function lineLogoForMode(mode){return CUSTOM_SIGNS[mode]||null}
function customLineLogoSvgFallbackForMode(mode,code,color,textColor){const fontSize=code.length<=2?54:code.length===3?40:31;return'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="'+color+'"/><text x="50" y="58" text-anchor="middle" dominant-baseline="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+fontSize+'" font-weight="800" fill="'+textColor+'">'+escapeSvgText(code)+'</text></svg>'}
function customLineCodeForTitle(title,mode){return customLineCode(title,mode)}
function customLineLogoSvgFallback(line){const title=String(line?.title||'Ligne');const color=/^#[0-9a-f]{6}$/i.test(line?.color)?line.color:'#314f88';const mode=customLineMode(line),code=customLineCode(title,mode);const textColor=badgeTextColor(color);const svg=customLineLogoSvgFallbackForMode(mode,code,color,textColor);line._logoFilter=null;return'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg)}
const customLineTintCache=new Map(),customLineMissingPng=new Set();
// Teinte un logo PNG officiel dans la couleur de la ligne : les pixels
// colorés (fond) prennent la couleur de la ligne, les pixels "lettres"
// (blancs ou sombres désaturés) prennent la couleur de texte lisible.
function customLineTintedLogo(pngUrl,color){const cacheKey=pngUrl+'|'+color;const cached=customLineTintCache.get(cacheKey);if(cached)return cached;const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth||img.width;canvas.height=img.naturalHeight||img.height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas indisponible');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height);const px=data.data;const hex=/^#[0-9a-f]{6}$/i.test(color)?color:'#314f88';const tr=parseInt(hex.slice(1,3),16),tg=parseInt(hex.slice(3,5),16),tb=parseInt(hex.slice(5,7),16);const bright=0.299*tr+0.587*tg+0.114*tb;const letter=bright>155?[38,52,69]:[255,255,255];for(let index=0;index<px.length;index+=4){const alpha=px[index+3];if(alpha<48)continue;const r=px[index],g=px[index+1],b=px[index+2];const max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max-min,value=0.299*r+0.587*g+0.114*b;const isLetter=sat<=48&&(value>=225||value<=96);if(isLetter){px[index]=letter[0];px[index+1]=letter[1];px[index+2]=letter[2]}else{px[index]=tr;px[index+1]=tg;px[index+2]=tb}}ctx.putImageData(data,0,0);resolve(canvas.toDataURL('image/png'))}catch(error){reject(error)}};img.onerror=()=>reject(new Error('logo introuvable : '+pngUrl));img.src=pngUrl});return customLineTintCache.set(cacheKey,promise).get(cacheKey)}
function refreshCustomLineLogo(line){if(!line||typeof line!=='object')return'';const color=/^#[0-9a-f]{6}$/i.test(line.color)?line.color:'#314f88',mode=customLineMode(line),code=customLineCode(line.title||'',mode),key=mode+'|'+code+'|'+color;line._logoFilter=null;
 if(['RER','Transilien','Tramway'].includes(mode)&&!customLineMissingPng.has(key)){
  if(line._logoKey===key&&line.logo)return line.logo;
  line._logoKey=key;
  const pngUrl=customLineOfficialLogoUrl(line);
  if(pngUrl){customLineTintedLogo(pngUrl,color).then(tinted=>{if(line._logoKey!==key)return;line.logo=tinted;if(userLines.includes(line))renderCustom()}).catch(()=>{if(line._logoKey!==key)return;customLineMissingPng.add(key);line.logo=customLineLogoSvgFallback(line);if(userLines.includes(line))renderCustom()})}
  return customLineLogoSvgFallback(line)
 }
 const fallback=customLineLogoSvgFallback(line);line.logo=fallback;return fallback}`;

src = src.slice(0, i) + BLOCK + '\n' + src.slice(j);
fs.writeFileSync(path, src);
console.log('bloc logos réparé');
