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

  const response = await page.goto('http://127.0.0.1:4173/carte-interactive-ile-de-france.html', {
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

  // Zoom from the default level 9 to the IRIS threshold (12).
  for (let i = 0; i < 3; i++) await page.locator('.leaflet-control-zoom-in').click();
  await page.waitForTimeout(1200);
  const irisFeatures = await page.evaluate(() => document.querySelectorAll('.leaflet-population-density-pane canvas, .leaflet-population-density-pane path').length);
  if (irisFeatures < 1) throw new Error('Le moteur de rendu de la couche IRIS n’est pas présent dans son panneau Leaflet.');

  // Zoom to the neighborhood-label threshold (15), then verify the label layer
  // has at least one visible candidate in the initial Île-de-France viewport.
  for (let i = 0; i < 3; i++) await page.locator('.leaflet-control-zoom-in').click();
  await page.waitForFunction(() => document.querySelectorAll('.iris-name-label').length > 0, null, { timeout: 30000 });

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
