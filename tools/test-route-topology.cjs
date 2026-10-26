#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/map-app.js', 'utf8');
const match = source.match(/function isRailVertexPinned\(name,coord\)\{[^}]*\}/);
assert.ok(match, 'map-app.js must expose the real junction-pinning helper');

const context = {
  railUnsharedVerticesByLine: new Map([
    ['Metro A', new Set(['2.00000,48.00000', '3.00000,48.00000'])],
    ['Metro B', new Set()]
  ]),
  railCoordKey: c => Number(c[0]).toFixed(5) + ',' + Number(c[1]).toFixed(5)
};
vm.createContext(context);
vm.runInContext(match[0], context);

assert.equal(context.isRailVertexPinned('Metro A', [2, 48]), true,
  'a vertex touching a non-shared edge must stay anchored');
assert.equal(context.isRailVertexPinned('Metro A', [3, 48]), true,
  'a second junction vertex must stay anchored');
assert.equal(context.isRailVertexPinned('Metro A', [4, 48]), false,
  'a vertex inside a shared-only section may be offset');
assert.equal(context.isRailVertexPinned('Metro B', [2, 48]), false,
  'the pinning decision must be isolated per line');
assert.equal(context.isRailVertexPinned('Unknown line', [2, 48]), false,
  'lines without topology records must keep the previous fallback behavior');

console.log('Route topology tests passed: 5 junction/offset cases.');
