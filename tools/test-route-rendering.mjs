import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => failures.push(error.message));
  const url = new URL(process.env.TRANSITLAB_TEST_URL || 'http://127.0.0.1:4173/carte-interactive-ile-de-france.html');
  url.searchParams.set('test', '1');
  const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response?.ok()) throw new Error('TransitLab did not return HTTP success.');
  try {
    await page.waitForFunction(() => !!window.__transitLabMap && !!document.querySelector('#customModePicker'), null, { timeout: 45000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      title: document.title,
      mapText: document.getElementById('map')?.textContent?.slice(0, 500),
      pickerPresent: !!document.querySelector('#customModePicker'),
      appScripts: [...document.scripts].map(script => script.src).filter(Boolean),
      mapContainerPresent: !!document.getElementById('map'),
    })).catch(() => ({}));
    throw new Error('Map initialization timed out. Browser errors: ' + failures.join(' | ') + '. Diagnostics: ' + JSON.stringify(diagnostics) + '. Original: ' + error.message);
  }
  const loadedLayerCount = await page.locator('#layerGroups .line-row').count();
  if (loadedLayerCount < 1) throw new Error('Map initialized but no route entries were rendered in the layer list.');
  await page.waitForFunction(() => [...document.querySelectorAll('#customModePicker img')].length === 4 && [...document.querySelectorAll('#customModePicker img')].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 15000 });

  const expected = [
    ['Metro', 'mode-metro.png'],
    ['RER', 'rer.png'],
    ['Transilien', 'transilien.png'],
    ['Tramway', 'tram.png'],
  ];
  for (const [mode, filename] of expected) {
    const button = page.locator('#customModePicker [data-mode="' + mode + '"]');
    await button.click();
    const state = await page.evaluate(() => ({
      mode: document.getElementById('customLineMode')?.value,
      selected: document.querySelector('#customModePicker [aria-pressed="true"]')?.dataset.mode,
      preview: document.getElementById('customLogoPreviewImage')?.getAttribute('src'),
    }));
    if (state.mode !== mode || state.selected !== mode) throw new Error('Mode picker failed to select ' + mode + ': ' + JSON.stringify(state));
    const iconLoaded = await button.locator('img').evaluate((img, expectedFile) => img.complete && img.naturalWidth > 0 && img.getAttribute('src').endsWith(expectedFile), filename);
    if (!iconLoaded) throw new Error('Missing or incorrect transport icon for ' + mode);
    await page.waitForFunction(expectedFile => {
      const image = document.getElementById('customLogoPreviewImage');
      return !!image && image.complete && image.naturalWidth > 0 && image.getAttribute('src').endsWith(expectedFile);
    }, filename, { timeout: 5000 }).catch(() => { throw new Error('Mode preview icon did not load for ' + mode); });
  }

  await page.evaluate(() => {
    const map = window.__transitLabMap;
    map.setView([48.8007, 2.1713], 14, { animate: false });
  });
  await page.waitForTimeout(900);
  const alignment = await page.evaluate(() => {
    const map = window.__transitLabMap;
    const all = [], seen = new Set();
    const walk = layer => {
      if (!layer || seen.has(layer)) return;
      seen.add(layer); all.push(layer);
      if (typeof layer.eachLayer === 'function') layer.eachLayer(walk);
    };
    map.eachLayer(walk);
    const lines = all.filter(layer => layer.feature?.properties?.line && layer.feature?.geometry?.type === 'LineString' && typeof layer.getLatLngs === 'function');
    const markers = all.filter(layer => layer._transferLine && Array.isArray(layer._transferRawCoord));
    const targets = [
      { line: 'RER C', raw: [2.17139, 48.800718] },
      { line: 'TRAIN N', raw: [2.17139, 48.800718] },
      { line: 'TRAM 6', raw: [2.17096740107903, 48.80107761141683] },
    ];
    const pointSegmentDistance = (p, a, b) => {
      const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
      const t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0;
      return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
    };
    const result = targets.map(target => {
      const marker = markers.find(layer => layer._transferLine === target.line && Math.hypot((layer._transferRawCoord[0]-target.raw[0])*111320*Math.cos(target.raw[1]*Math.PI/180),(layer._transferRawCoord[1]-target.raw[1])*111320)<35);
      const routeLines = lines.filter(layer => layer.feature.properties.line === target.line);
      if (!marker || !routeLines.length) return { line: target.line, markerFound: !!marker, routeFeatureCount: routeLines.length, distancePx: null };
      const p = map.latLngToContainerPoint(marker.getLatLng());
      let distancePx = Infinity;
      for (const layer of routeLines) {
        const coords = layer.getLatLngs();
        for (let i=1;i<coords.length;i++) {
          const a=map.latLngToContainerPoint(coords[i-1]),b=map.latLngToContainerPoint(coords[i]);
          distancePx=Math.min(distancePx,pointSegmentDistance(p,a,b));
        }
      }
      return { line: target.line, markerFound: true, routeFeatureCount: routeLines.length, distancePx: Math.round(distancePx*100)/100 };
    });
    return result;
  });
  for (const result of alignment) {
    if (!result.markerFound || result.routeFeatureCount < 1 || result.distancePx > 18) {
      throw new Error('Station-to-route alignment failed at Viroflay Rive Gauche: ' + JSON.stringify(result));
    }
  }

  // Re-check the same transfer markers at both a wider and a closer zoom.
  // Leaflet markers and route paths must remain attached as scale changes.
  for (const zoom of [11, 17]) {
    await page.evaluate(level => window.__transitLabMap.setView([48.8007, 2.1713], level, { animate: false }), zoom);
    await page.waitForTimeout(250);
    const zoomAlignment = await page.evaluate(() => {
      const map = window.__transitLabMap;
      const all = [], seen = new Set();
      const walk = layer => {
        if (!layer || seen.has(layer)) return;
        seen.add(layer); all.push(layer);
        if (typeof layer.eachLayer === 'function') layer.eachLayer(walk);
      };
      map.eachLayer(walk);
      const lines = all.filter(layer => layer.feature?.properties?.line && layer.feature?.geometry?.type === 'LineString' && typeof layer.getLatLngs === 'function');
      const markers = all.filter(layer => layer._transferLine && Array.isArray(layer._transferRawCoord));
      const targets = [
        { line: 'RER C', raw: [2.17139, 48.800718] },
        { line: 'TRAIN N', raw: [2.17139, 48.800718] },
        { line: 'TRAM 6', raw: [2.17096740107903, 48.80107761141683] },
      ];
      const segmentDistance = (p, a, b) => {
        const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
        const t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0;
        return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
      };
      return targets.map(target => {
        const marker = markers.find(layer => layer._transferLine === target.line && Math.hypot((layer._transferRawCoord[0]-target.raw[0])*111320*Math.cos(target.raw[1]*Math.PI/180),(layer._transferRawCoord[1]-target.raw[1])*111320)<35);
        const routes = lines.filter(layer => layer.feature.properties.line === target.line);
        if (!marker || !routes.length) return { line: target.line, markerFound: !!marker, routeFeatureCount: routes.length, distancePx: null };
        const p = map.latLngToContainerPoint(marker.getLatLng());
        let distancePx = Infinity;
        for (const route of routes) {
          const coords = route.getLatLngs();
          for (let i=1;i<coords.length;i++) distancePx=Math.min(distancePx,segmentDistance(p,map.latLngToContainerPoint(coords[i-1]),map.latLngToContainerPoint(coords[i])));
        }
        return { line: target.line, markerFound: true, routeFeatureCount: routes.length, distancePx: Math.round(distancePx*100)/100 };
      });
    });
    for (const result of zoomAlignment) {
      if (!result.markerFound || result.routeFeatureCount < 1 || result.distancePx > 18) {
        throw new Error('Station-to-route alignment failed at zoom ' + zoom + ': ' + JSON.stringify(result));
      }
    }
    console.log(JSON.stringify({ result: 'PASS', zoom, stationAlignment: zoomAlignment }));
  }
  if (failures.length) throw new Error('Browser JavaScript errors: ' + failures.join(' | '));
  console.log(JSON.stringify({ result: 'PASS', modeIcons: expected.map(x=>x[0]), stationAlignmentAtZoom14: alignment }, null, 2));
} finally {
  await browser.close();
}
