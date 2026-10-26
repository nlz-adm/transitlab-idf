import { chromium } from 'playwright';

const errors = [];
const targetUrl = new URL(process.env.TRANSITLAB_TEST_URL || 'http://127.0.0.1:4173/carte-interactive-ile-de-france.html');
targetUrl.searchParams.set('test', '1');
const screenshotPath = process.env.IRIS_SCREENSHOT_PATH || '/tmp/iris-map-smoke.png';
const maxLabelMs = process.env.IRIS_LABEL_MAX_MS === undefined ? 5000 : Number(process.env.IRIS_LABEL_MAX_MS);
const benchmarkLabel = process.env.IRIS_BENCHMARK_LABEL || 'head';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /TransitLab map boot|Carte:/.test(message.text())) {
      errors.push(message.text());
    }
  });

  const response = await page.goto(targetUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  if (!response?.ok()) throw new Error('La page principale ne répond pas correctement.');

  await page.locator('#map.leaflet-container').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('.leaflet-control-zoom-in').waitFor({ state: 'visible', timeout: 30000 });

  const densityToggle = page.locator('#populationToggle');
  await densityToggle.check();
  await page.waitForFunction(() => {
    const legend = document.getElementById('populationLegend');
    return legend && !legend.hidden;
  }, null, { timeout: 30000 });

  // Drive the map to a deterministic central-Paris viewport for stable IRIS coverage.
  await page.waitForFunction(() => !!window.__transitLabMap, null, { timeout: 10000 });
  await page.evaluate(() => { window.__transitLabMap.setView([48.8566, 2.3522], 12); });
  await page.waitForTimeout(1500);
  const irisFeatures = await page.evaluate(() => document.querySelectorAll('.leaflet-population-density-pane canvas, .leaflet-population-density-pane path').length);
  if (irisFeatures < 1) throw new Error('Le moteur de rendu de la couche IRIS n’est pas présent dans son panneau Leaflet.');

  // Measure the first label after moving to the same neighborhood-scale viewport.
  const labelRefreshStarted = Date.now();
  await page.evaluate(() => { window.__transitLabMap.setView([48.8566, 2.3522], 15); });
  try {
    await page.waitForFunction(() => document.querySelectorAll('.iris-name-label').length > 0, null, { timeout: 30000 });
  } catch {
    const labelDiagnostics = await page.evaluate(() => ({
      labels: document.querySelectorAll('.iris-name-label').length,
      status: document.getElementById('saveStatus')?.textContent || '',
      zoom: window.__transitLabMap?.getZoom?.() ?? null,
      center: (() => { const center = window.__transitLabMap?.getCenter?.(); return center ? [center.lat, center.lng] : null; })(),
      paneExists: !!document.querySelector('.leaflet-population-density-pane'),
      featurePaths: document.querySelectorAll('.leaflet-population-density-pane path, .leaflet-population-density-pane canvas').length,
      irisRequests: performance.getEntriesByType('resource').filter(entry => /population-iris/.test(entry.name)).map(entry => ({url: entry.name, durationMs: Math.round(entry.duration)})),
    }));
    throw new Error('Aucune étiquette IRIS au zoom de quartier après 30 s. Diagnostic navigateur : ' + JSON.stringify(labelDiagnostics));
  }

  const labelRefreshMs = Date.now() - labelRefreshStarted;
  const labelCount = await page.locator('.iris-name-label').count();
  await page.screenshot({ path: screenshotPath, fullPage: false });
  if (maxLabelMs > 0 && labelRefreshMs > maxLabelMs) {
    throw new Error(`Le premier libellé de quartier met trop longtemps à apparaître : ${labelRefreshMs} ms (seuil CI : ${maxLabelMs} ms).`);
  }
  await densityToggle.uncheck();
  await page.locator('#communesBoundaryToggle').check();
  await page.waitForTimeout(500);

  if (errors.length) throw new Error('Erreurs JavaScript navigateur : ' + errors.join(' | '));
  console.log(JSON.stringify({
    result: 'PASS',
    benchmark: benchmarkLabel,
    map: 'Leaflet initialisée',
    densityLegend: 'visible après activation',
    densityPaneRendererElements: irisFeatures,
    neighborhoodLabels: labelCount,
    zoomToFirstNeighborhoodLabelMs: labelRefreshMs,
    irisDataRequests: await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /population-iris/.test(entry.name)).map(entry => ({ resource: entry.name.split('/').pop(), durationMs: Math.round(entry.duration), transferBytes: entry.transferSize || null }))),
    consolePageErrors: errors.length,
  }, null, 2));
} finally {
  await browser.close();
}
