import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /TransitLab map boot|Carte:/.test(message.text())) {
      errors.push(message.text());
    }
  });

  const response = await page.goto('http://127.0.0.1:4173/carte-interactive-ile-de-france.html?test=1', {
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
  await page.evaluate(() => window.__transitLabMap.setView([48.8566, 2.3522], 12));
  await page.waitForTimeout(1500);
  const irisFeatures = await page.evaluate(() => document.querySelectorAll('.leaflet-population-density-pane canvas, .leaflet-population-density-pane path').length);
  if (irisFeatures < 1) throw new Error('Le moteur de rendu de la couche IRIS n’est pas présent dans son panneau Leaflet.');

  // Move to neighborhood scale explicitly and wait for the asynchronous IRIS refresh.
  await page.evaluate(() => window.__transitLabMap.setView([48.8566, 2.3522], 15));
  await page.waitForTimeout(3000);
  const labelDiagnostics = await page.evaluate(() => ({
    labels: document.querySelectorAll('.iris-name-label').length,
    status: document.getElementById('saveStatus')?.textContent || '',
    zoom: window.__transitLabMap?.getZoom?.() ?? null,
    paneExists: !!document.querySelector('.leaflet-population-density-pane'),
    featurePaths: document.querySelectorAll('.leaflet-population-density-pane path, .leaflet-population-density-pane canvas').length,
  }));
  if (!labelDiagnostics.labels) {
    throw new Error('Aucune étiquette IRIS au zoom de quartier. Diagnostic navigateur : ' + JSON.stringify(labelDiagnostics));
  }

  await densityToggle.uncheck();
  await page.locator('#communesBoundaryToggle').check();
  await page.waitForTimeout(500);

  if (errors.length) throw new Error('Erreurs JavaScript navigateur : ' + errors.join(' | '));
  console.log(JSON.stringify({
    result: 'PASS',
    map: 'Leaflet initialisée',
    densityLegend: 'visible après activation',
    densityPaneRendererElements: irisFeatures,
    neighborhoodLabels: await page.locator('.iris-name-label').count(),
    consolePageErrors: errors.length,
  }, null, 2));
} finally {
  await browser.close();
}
