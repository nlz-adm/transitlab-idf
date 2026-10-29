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
  await page.waitForFunction(() => document.querySelectorAll('#layerGroups .line-row').length >= 40, null, { timeout: 30000 }).catch(async error => {
    const diagnostics = await page.evaluate(() => ({
      layerGroupCount: document.querySelectorAll('#layerGroups .mode-group').length,
      routeRowCount: document.querySelectorAll('#layerGroups .line-row').length,
      layerGroupsText: document.getElementById('layerGroups')?.textContent?.slice(0, 300),
      totalCount: document.getElementById('totalCount')?.textContent,
    })).catch(() => ({}));
    throw new Error('Route list did not finish rendering. Diagnostics: ' + JSON.stringify(diagnostics) + '. Original: ' + error.message);
  });
  const loadedLayerCount = await page.locator('#layerGroups .line-row').count();
  await page.waitForFunction(() => [...document.querySelectorAll('#customModePicker img')].length === 4 && [...document.querySelectorAll('#customModePicker img')].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 15000 });

  // Force the map's explicit all-stations mode for this geometry test. In automatic
  // mode, zoom 11 intentionally switches to logo-only rendering, so no station
  // marker exists to measure even though the underlying route geometry is present.
  await page.selectOption('#stationNamesMode', 'all');
  await page.locator('#stationNamesMode').dispatchEvent('change');

  // Keep transfer stations enabled: this is the production default and the
  // regression that previously escaped CI. Shared hub markers should sit at the
  // midpoint of the visible line-specific offset geometries.
  const transferToggle = page.locator('#transferToggle');
  if (!(await transferToggle.isChecked())) {
    await transferToggle.check();
    await transferToggle.dispatchEvent('change');
  }
  await page.waitForTimeout(500);

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
    await page.evaluate(level => { window.__transitLabMap.setView([48.8007, 2.1713], level, { animate: false }); }, zoom);
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
  const correspondenceAlignment = [];
  const networkStations = await page.evaluate(() => fetch('assets/network-data.json').then(response => response.json()).then(data => data.stations));
  for (const station of [
    { name: 'Jussieu', center: [48.846, 2.355], lines: ['METRO 7', 'METRO 10'] },
    { name: 'Duroc', center: [48.847, 2.3167], lines: ['METRO 10', 'METRO 13'] },
    { name: 'République', center: [48.8675, 2.3636], lines: ['METRO 3', 'METRO 5', 'METRO 8', 'METRO 9', 'METRO 11'] },
    { name: 'Châtelet', center: [48.8590, 2.3470], lines: ['METRO 1', 'METRO 4', 'METRO 7', 'METRO 11', 'METRO 14'] },
    { name: 'Châtelet-Les Halles', center: [48.8618, 2.3470], lines: ['RER A', 'RER B', 'RER D'] },
    { name: 'Gare de Lyon', center: [48.8445, 2.3737], lines: ['METRO 1', 'METRO 14', 'RER A', 'RER D', 'TRAIN R'] },
  ]) {
    const expectedPoints = networkStations.filter(feature => feature.properties.name === station.name && station.lines.includes(feature.properties.line)).map(feature => ({ line: feature.properties.line, lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }));
    for (const zoom of [17, 19]) {
      const result = await page.evaluate(async ({ station, zoom, expectedPoints }) => {
        const map = window.__transitLabMap;
        for (const selector of ['#stationsToggle', '#stationNamesToggle', '#transferToggle']) {
          const input = document.querySelector(selector);
          if (input && !input.checked) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        const mode = document.querySelector('#stationNamesMode');
        mode.value = 'all'; mode.dispatchEvent(new Event('change', { bubbles: true }));
        const lineBadges = document.querySelector('#lineBadgesToggle');
        if (lineBadges.checked) { lineBadges.checked = false; lineBadges.dispatchEvent(new Event('change', { bubbles: true })); }
        map.setView(station.center, zoom, { animate: false });
        await new Promise(resolve => setTimeout(resolve, 650));
        const layers = [], seen = new Set();
        const walk = layer => { if (!layer || seen.has(layer)) return; seen.add(layer); layers.push(layer); if (typeof layer.eachLayer === 'function') layer.eachLayer(walk); };
        map.eachLayer(walk);
        const routes = new Map();
        for (const layer of layers) {
          const line = layer.feature?.properties?.line;
          if (!line || typeof layer.getLatLngs !== 'function') continue;
          if (!routes.has(line)) routes.set(line, []);
          routes.get(line).push(layer);
        }
        const lineChains = coordinates => {
          if (!Array.isArray(coordinates) || !coordinates.length) return [];
          return coordinates[0]?.lat != null ? [coordinates] : coordinates.flatMap(lineChains);
        };
        const segmentDistance = (point, a, b) => {
          const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
          const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
          return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
        };
                const mapRect = map.getContainer().getBoundingClientRect();
        const label = [...document.querySelectorAll('.station-name-label')].find(el => el.querySelector('.station-label-text')?.textContent.trim() === station.name);
        if (!label) return { station: station.name, zoom, labelFound: false };
        const badgeRows = [...label.querySelectorAll('.route-badge')].map(badge => {
          const rect = badge.getBoundingClientRect(), point = { x: rect.left + rect.width / 2 - mapRect.left, y: rect.top + rect.height / 2 - mapRect.top };
          let lineDistance = Infinity;
          for (const route of routes.get(badge.title) || []) for (const chain of lineChains(route.getLatLngs())) {
            for (let index = 1; index < chain.length; index++) lineDistance = Math.min(lineDistance, segmentDistance(point, map.latLngToContainerPoint(chain[index - 1]), map.latLngToContainerPoint(chain[index])));
          }
          return { line: badge.title, left: rect.left - mapRect.left, right: rect.right - mapRect.left, x: point.x, y: point.y, distancePx: Math.round(lineDistance * 10) / 10 };
        });
        const badgeLeft = badgeRows.length ? Math.min(...badgeRows.map(row => row.left)) : null;
        const badgeRight = badgeRows.length ? Math.max(...badgeRows.map(row => row.right)) : null;
        const badgeCenterX = badgeLeft === null ? null : (badgeLeft + badgeRight) / 2;
        const badgeCenterY = badgeRows.length ? badgeRows.reduce((sum, row) => sum + row.y, 0) / badgeRows.length : null;
        const dots = layers.filter(layer => layer.options?.pane === 'transfers' && typeof layer.getRadius === 'function').map(dot => map.latLngToContainerPoint(dot.getLatLng()));
        const candidates = dots.map(dot => ({ x: dot.x, y: dot.y, distance: badgeCenterX === null ? Infinity : Math.hypot(dot.x - badgeCenterX, dot.y - badgeCenterY) })).sort((a, b) => a.distance - b.distance);
        const visibleExpectedPoints = expectedPoints.filter(point => map.getBounds().contains([point.lat, point.lng]));
        const expectedLines = new Set(expectedPoints.map(point => point.line));
        // Toutes les lignes de la gare doivent passer par la pastille unique.
        const dotPoint = candidates[0] || null;
        const convergence = dotPoint ? [...expectedLines].map(line => {
          let distancePx = Infinity;
          for (const route of routes.get(line) || []) for (const chain of lineChains(route.getLatLngs())) {
            for (let index = 1; index < chain.length; index++) distancePx = Math.min(distancePx, segmentDistance(dotPoint, map.latLngToContainerPoint(chain[index - 1]), map.latLngToContainerPoint(chain[index])));
          }
          return { line, distancePx: Math.round(distancePx * 10) / 10 };
        }) : [];
        // La pastille est posée aux coordonnées de la gare (moyenne de ses points).
        const anchorPoint = expectedPoints.length ? map.latLngToContainerPoint([
          expectedPoints.reduce((sum, point) => sum + point.lat, 0) / expectedPoints.length,
          expectedPoints.reduce((sum, point) => sum + point.lng, 0) / expectedPoints.length,
        ]) : null;
        const anchorErrorPx = dotPoint && anchorPoint ? Math.round(Math.hypot(anchorPoint.x - dotPoint.x, anchorPoint.y - dotPoint.y) * 10) / 10 : null;
        return { station: station.name, zoom, labelFound: true, missingLines: [...expectedLines].filter(line => !badgeRows.some(row => row.line === line)), dotCount: candidates.filter(dot => dot.distance < 30).length, dot: candidates[0] ? { x: Math.round(candidates[0].x * 10) / 10, y: Math.round(candidates[0].y * 10) / 10, distance: Math.round(candidates[0].distance * 10) / 10 } : null, badgeCenterX: badgeCenterX === null ? null : Math.round(badgeCenterX * 10) / 10, badges: badgeRows.map(row => ({ line: row.line, distancePx: row.distancePx })), convergence, anchorErrorPx, visibleLines: [...visibleExpectedPoints.map(point => point.line)] };
      }, { station, zoom, expectedPoints });
      const missingLines = result.missingLines || [];
        // Une seule pastille de correspondance par gare, posée aux coordonnées de la gare,
        // et la rangée de badges de lignes centrée sur cette pastille.
        const offCentre = result.dot && result.badgeCenterX !== null ? Math.abs(result.dot.x - result.badgeCenterX) : Infinity;
        const divergent = (result.convergence || []).filter(entry => !(entry.distancePx <= 2.5));
        if (!result.labelFound || missingLines.length || !result.dot || result.dotCount !== 1 || result.dot.distance > 20 || offCentre > 1.5) {
        throw new Error('Transfer point failed at ' + station.name + ' zoom ' + zoom + ': ' + JSON.stringify({ labelFound: result.labelFound, missingLines, dotCount: result.dotCount, dot: result.dot, badgeCenterX: result.badgeCenterX, offCentre: Math.round(offCentre * 10) / 10, badges: result.badges }));
      }
        if (divergent.length || result.anchorErrorPx === null || result.anchorErrorPx > 2.5) {
        throw new Error('Lines do not converge on the station point at ' + station.name + ' zoom ' + zoom + ': ' + JSON.stringify({ divergent, anchorErrorPx: result.anchorErrorPx, dot: result.dot }));
      }
correspondenceAlignment.push(result);
    }
  }
  if (failures.length) throw new Error('Browser JavaScript errors: ' + failures.join(' | '));
  console.log(JSON.stringify({ result: 'PASS', modeIcons: expected.map(x=>x[0]), stationAlignmentAtZoom14: alignment, correspondenceAlignment }, null, 2));
} finally {
  await browser.close();
}
