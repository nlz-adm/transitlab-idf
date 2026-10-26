#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/map-app.js', 'utf8');
const builder = source.match(/function buildRailUnsharedVertices\(lines,edges,edgeKey,coordKey\)\{[\s\S]*?\n\}/);
const predicate = source.match(/function isRailVertexPinned\(name,coord\)\{[^}]*\}/);
const stationPinner = source.match(/function pinRailStationVertices\(stations,placements,pinned,stationKey,coordKey\)\{[\s\S]*?\n\}/);
assert.ok(builder, 'map-app.js must expose the real route-topology index builder');
assert.ok(predicate, 'map-app.js must expose the real junction-pinning helper');
assert.ok(stationPinner, 'map-app.js must expose the real station anchoring helper');

const normalizerMatch = source.match(/function normalizeSharedTrackSegmentation\(lines\)\{[\s\S]*?\n\}/);
assert.ok(normalizerMatch, 'map-app.js must normalize shared route segmentation before indexing');
const normalizeContext = {};
vm.createContext(normalizeContext);
vm.runInContext(normalizerMatch[0], normalizeContext);
const differentlySegmented = [
 { properties:{line:'A'}, geometry:{type:'LineString',coordinates:[[2,48],[2.01,48]]} },
 { properties:{line:'B'}, geometry:{type:'LineString',coordinates:[[2.002,48],[2.006,48],[2.008,48]]} }
];
normalizeContext.normalizeSharedTrackSegmentation(differentlySegmented);
assert.deepEqual(
 Array.from(differentlySegmented[0].geometry.coordinates, c=>Number(c[0].toFixed(5))),
 [2,2.002,2.006,2.008,2.01],
 'the longer route must be split at endpoints from the shorter route'
);
assert.deepEqual(
 Array.from(differentlySegmented[1].geometry.coordinates, c=>Number(c[0].toFixed(5))),
 [2.002,2.006,2.008],
 'existing vertices must be preserved'
);
const nearParallel = [
 { properties:{line:'C'}, geometry:{type:'LineString',coordinates:[[2,48],[2.01,48]]} },
 { properties:{line:'D'}, geometry:{type:'LineString',coordinates:[[2.002,48.000008],[2.006,48.000008],[2.008,48.000008]]} }
];
normalizeContext.normalizeSharedTrackSegmentation(nearParallel);
assert.deepEqual(
 Array.from(nearParallel[0].geometry.coordinates, c=>Number(c[0].toFixed(5))),
 [2,2.01],
 'nearby parallel routes must not be snapped into one shared segmentation'
);
const coordKey = c => Number(c[0]).toFixed(5) + ',' + Number(c[1]).toFixed(5);
const stationKey = (lng, lat) => [Number(lng).toFixed(5), Number(lat).toFixed(5)].join(',');
const edgeKey = (a, b) => {
  const ka = coordKey(a), kb = coordKey(b);
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
};
const sharedEdges = new Map();
for (const [a, b, line] of [
  [[0, 0], [1, 0], 'Metro A'],
  [[1, 0], [2, 0], 'Metro A']
]) sharedEdges.set(edgeKey(a, b), { offsets: new Map([[line, 1]]) });
const features = [
  { properties: { line: 'Metro A' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0], [3, 0]] } },
  { properties: { line: 'Metro B' }, geometry: { type: 'LineString', coordinates: [[1, -1], [1, 0], [1, 1]] } }
];
const context = { railCoordKey: coordKey };
vm.createContext(context);
vm.runInContext(builder[0] + '\n' + predicate[0] + '\n' + stationPinner[0], context);
const pinned = context.buildRailUnsharedVertices(features, sharedEdges, edgeKey, coordKey);
context.railUnsharedVerticesByLine = pinned;

assert.equal(context.isRailVertexPinned('Metro A', [0, 0]), false,
  'a shared-only terminal remains eligible for the offset');
assert.equal(context.isRailVertexPinned('Metro A', [1, 0]), false,
  'a shared-only vertex is not pinned solely by another line crossing nearby');
assert.equal(context.isRailVertexPinned('Metro A', [2, 0]), true,
  'a junction between shared and unique track stays anchored');
assert.equal(context.isRailVertexPinned('Metro B', [1, 0]), true,
  'unique track vertices stay anchored independently per line');

const placements = new Map([
  ['Metro A|' + stationKey(1.5, 0), { segment: [[1, 0], [2, 0]] }]
]);
context.pinRailStationVertices(
  [{ properties: { line: 'Metro A' }, geometry: { coordinates: [1.5, 0] } }],
  placements, pinned, stationKey, coordKey
);
assert.equal(context.isRailVertexPinned('Metro A', [1, 0]), true,
  'station placement pins the first route vertex of its segment');
assert.equal(context.isRailVertexPinned('Metro A', [2, 0]), true,
  'station placement pins the second route vertex of its segment');
assert.equal(context.isRailVertexPinned('Metro A', [3, 0]), true,
  'unique route endpoints stay anchored');
assert.equal(context.isRailVertexPinned('Unknown line', [1, 0]), false,
  'unknown lines keep the previous fallback behavior');

console.log('Route topology tests passed: 7 junction/station anchoring cases.');
