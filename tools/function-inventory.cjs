const fs = require('fs');
const { execSync } = require('child_process');
const head = execSync('git show HEAD:assets/map-app.js', { encoding: 'utf8' });
const cur = fs.readFileSync('assets/map-app.js', 'utf8');
const namesIn = src => {
  const set = new Set();
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) set.add(m[1]);
  for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) set.add('var:' + m[1]);
  return set;
};
const hSet = namesIn(head), cSet = namesIn(cur);
const missing = [...hSet].filter(name => !cSet.has(name));
console.log('DEFINIS APPARUES SEULEMENT DANS HEAD (absentes du courant) :');
console.log(missing.sort().join(', ') || '(aucune)');
// Références non définies approximatives : identifiants appelés `name(` présents dans cur mais ni définis ni dans HEAD-inventaire
const calls = new Set();
for (const m of cur.matchAll(/(?:^|[^.$\w])((?!if|for|while|switch|catch|return|function|typeof|new|in|of\b)[A-Za-z_$][\w$]*)\s*\(/g)) calls.add(m[1]);
const defined = namesIn(cur);
const builtins = new Set(['String', 'Number', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Promise', 'Map', 'Set', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'fetch', 'console', 'Blob', 'Image', 'Error', 'TypeError', 'URL', 'URLSearchParams', 'RegExp', 'localStorage', 'window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'indexedDB', 'navigator', 'location', 'history', 'performance', 'structuredClone', 'crypto', 'Worker', 'IntersectionObserver', 'MutationObserver', 'DOMParser', 'XMLHttpRequest', 'Event', 'CustomEvent', 'FormData', 'AbortController', 'requestIdleCallback', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt']);
const undef = [...calls].filter(name => !defined.has(name) && !hSet.has(name) && !missing.includes(name) && !builtins.has(name));
console.log('APPELS SANS DEFINITION LOCALE :');
console.log(undef.sort().join(', ') || '(aucun)');
