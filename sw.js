const CACHE_NAME='transitlab-idf-v20261028-fix-activeline-v2';
const URLS_TO_CACHE=[
  './',
  './index.html',
  './carte-interactive-ile-de-france.html',
  './assets/leaflet.css',
  './assets/leaflet.js',
  './assets/map-boot.js?v=idf-custom-transport-20261028-fix-activeline-v2',
  './assets/map-app.js?v=idf-custom-transport-20261028-fix-activeline-v2',
  './assets/network-data.json?v=idf-custom-transport-20261028-fix-activeline-v2',
  './assets/network-optional.json?v=idf-custom-transport-20261028-fix-activeline-v2',
  './assets/communes-fast.json?v=idf-custom-transport-20261028-fix-activeline-v2',
  './assets/population-iris-index.json?v=idf-iris-rp2022-2024-20261028-fix-activeline-v2',
  './assets/hydrography.geojson.gz?v=idf-hydrography-osm-v3-20261028-fix-activeline-v2',
  './assets/official-rail-traces.json?v=idfm-rail-v4',
  './assets/ign-idf-fast.webp',
  './assets/transitlab-logo.png',
  './assets/icon-192.png',
  './manifest.json'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(URLS_TO_CACHE).catch(err=>{console.warn('SW: certaines ressources n'ont pas pu être mises en cache',err);return cache.addAll(URLS_TO_CACHE.filter(url=>!url.includes('population-iris')&&!url.includes('hydrography')))})));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(cacheNames=>Promise.all(cacheNames.filter(name=>name!==CACHE_NAME).map(name=>caches.delete(name)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.pathname.includes('population-iris/')||url.pathname.includes('.geojson.gz')){
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request).then(fetchResponse=>{if(url.pathname.startsWith('/assets/')||url.pathname.endsWith('.html')){const responseClone=fetchResponse.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,responseClone))}return fetchResponse}).catch(()=>caches.match('./index.html'))));
});