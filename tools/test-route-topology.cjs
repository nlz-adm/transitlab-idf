#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/map-app.js', 'utf8');
const builder = source.match(/function buildRailUnsharedVertices\(lines,edges,edgeKey,coordKey\)\{[\s\S]*?\n\}/);
const predicate = source.match(/function isRailVertexPinned\(name,coord\)\{[^}]*\}/);
assert.ok(builder, 'map-app.js must expose the real route-topology index builder');
assert.ok(predicate, 'map-app.js must expose the real junction-pinning helper');

const coordKey = c => Number(c[0]).toFixed(5) + ',' + Number(c[1]).toFixed(5);
const edgeKey = (a, b) => {
  const ka = coordKey(a), kb = coordKey(b);
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
};
const sharedEdges = new Map();
for (const [a, b, line] of [
  [[0, 0], [1, 0], 'Metro A'],
  [[1, 0], [2, 0], 'Metro A']
]) {
  sharedEdges.set(edgeKey(a, b), { offsets: new Map([[line, 1]]) });
}
const features = [
  { properties: { line: 'Metro A' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0], [3, 0]] } },
  { properties: { line: 'Metro B' }, geometry: { type: 'LineString', coordinates: [[1, -1], [1, 0], [1, 1]] } }
];
const context = { DATA: { lines: features }, sharedTrackEdges: sharedEdges, railEdgeKey: edgeKey, railCoordKey: coordKey };
vm.createContext(context);
vm.runInContext(builder[0] + '\n' + predicate[0], context);
context.railUnsharedVerticesByLine = context.buildRailUnsharedVertices(features, sharedEdges, edgeKey, coordKey);

assert.equal(context.isRailVertexPinned('Metro A', [0, 0]), false,
  'a shared-only terminal remains eligible for the offset');
assert.equal(context.isRailVertexPinned('Metro A', [1, 0]), true,
  'the junction where a shared track meets a unique track stays anchored');
assert.equal(context.isRailVertexPinned('Metro A', [2, 0]), true,
  'a shared track transition to a unique edge stays anchored');
assert.equal(context.isRailVertexPinned('Metro A', [3, 0]), true,
  'the endpoint of a unique track stays anchored');
assert.equal(context.isRailVertexPinned('Metro B', [1, 0]), true,
  'the crossing/transfer vertex is independently anchored for the connecting line');
assert.equal(context.isRailVertexPinned('Metro B', [1, -1]), true,
  'unique line endpoints remain anchored');
assert.equal(context.isRailVertexPinned('Unknown line', [1, 0]), false,
  'unknown lines keep the previous fallback behavior');

console.log('Route topology tests passed: 7 junction/offset cases.');
