#!/usr/bin/env node
'use strict';

// Regression tests for the real helper functions in assets/map-app.js.
// Extracting the declarations keeps this test dependency-free and avoids
// duplicating the implementation under test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/map-app.js', 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Expected function ' + name + ' to exist');
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Could not extract function ' + name);
}

function loadFunction(name, args = []) {
  const declaration = extractFunction(name);
  return vm.runInNewContext('(' + declaration + ')', { Math, Number, parseInt, isFinite, ...args });
}

const populationFill = loadFunction('populationFill');
const cases = [
  [0, '#fff7bc'],
  [500, '#fee391'],
  [1000, '#fed470'],
  [1500, '#fec44f'],
  [2250, '#feaf3c'],
  [3000, '#fe9929'],
  [6000, '#ec7014'],
  [10000, '#cc4c02'],
  [20000, '#8c2d04'],
  [25000, '#8c2d04'],
  [-10, '#fff7bc'],
  ['not-a-number', '#fff7bc'],
];
for (const [density, expected] of cases) {
  assert.equal(populationFill(density), expected, 'density ' + density);
}

const boundsIntersectBbox = loadFunction('boundsIntersectBbox');
const bounds = {
  getEast: () => 2,
  getWest: () => 1,
  getNorth: () => 49,
  getSouth: () => 48,
};
assert.equal(boundsIntersectBbox(bounds, [1, 48, 2, 49]), true, 'bbox exactly on viewport edges intersects');
assert.equal(boundsIntersectBbox(bounds, [1.5, 48.5, 2.5, 49.5]), true, 'overlapping bbox intersects');
assert.equal(boundsIntersectBbox(bounds, [2.1, 48.5, 3, 49.5]), false, 'bbox east of viewport is excluded');
assert.equal(boundsIntersectBbox(bounds, [1.5, 49.1, 2, 50]), false, 'bbox north of viewport is excluded');
assert.equal(boundsIntersectBbox(bounds, null), false, 'missing bbox is excluded');

console.log('OK: ' + cases.length + ' density-scale cases and 5 viewport-intersection cases passed.');
