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

const splitterMatch = source.match(/function splitRepeatedRouteChains\(lines\)\{[\s\S]*?\n\}/);
assert.ok(splitterMatch, 'map-app.js must split accidental route connectors at repeated vertices');
const splitContext = {};
vm.createContext(splitContext);
vm.runInContext(splitterMatch[0], splitContext);
const malformedBranch = [{properties:{line:'TRAM 6',mode:'Tramway'},geometry:{type:'LineString',coordinates:[[2.178798,48.785121],[2.171307,48.800716],[2.178798,48.785121],[2.176976,48.784057],[2.176848,48.783692]]}}];
const splitBranch = splitContext.splitRepeatedRouteChains(malformedBranch);
assert.equal(splitBranch.length, 1, 'a repeated interior vertex at the start of a concatenated branch must be repaired as one continuous route');
assert.deepEqual(Array.from(splitBranch[0].geometry.coordinates), [[2.171307,48.800716],[2.178798,48.785121],[2.176976,48.784057],[2.176848,48.783692]], 'the route must reverse the first branch at the repeated junction and continue without a long artificial return segment');
const networkForSplitTest = JSON.parse(fs.readFileSync('assets/network-data.json','utf8'));
const splitRealNetwork = splitContext.splitRepeatedRouteChains(networkForSplitTest.lines);
const coordKeyForSplit = c => Number(c[0]).toFixed(9)+','+Number(c[1]).toFixed(9);
let interiorRepeatsAfterSplit=0;
for(const feature of splitRealNetwork){
 const coords=feature.geometry?.coordinates||[],seen=new Set();
 for(let i=0;i<coords.length;i++){const key=coordKeyForSplit(coords[i]);if(seen.has(key)&&i<coords.length-1)interiorRepeatsAfterSplit++;seen.add(key)}
}
assert.equal(interiorRepeatsAfterSplit, 0, 'the real network must contain no accidental mid-chain returns after route-chain repair');
assert.ok(splitRealNetwork.length >= networkForSplitTest.lines.length, 'route-chain repair must preserve all route geometry as valid line features');
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
const networkData = JSON.parse(fs.readFileSync('assets/network-data.json', 'utf8'));
const countSharedEdges = lines => {
  const edges = new Map();
  for (const feature of lines) {
    const geometry = feature.geometry;
    if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) continue;
    const chains = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
    for (const coords of chains || []) {
      for (let i = 1; i < (coords || []).length; i++) {
        const a = coordKey(coords[i - 1]), b = coordKey(coords[i]);
        const key = a < b ? a + '|' + b : b + '|' + a;
        if (!edges.has(key)) edges.set(key, new Set());
        edges.get(key).add(String(feature.properties?.line || ''));
      }
    }
  }
  return [...edges.values()].filter(lines => lines.size > 1).length;
};
const realLinesBefore = JSON.parse(JSON.stringify(networkData.lines));
const sharedEdgesBefore = countSharedEdges(realLinesBefore);
const realLinesAfter = normalizeContext.normalizeSharedTrackSegmentation(JSON.parse(JSON.stringify(networkData.lines)));
const sharedEdgesAfter = countSharedEdges(realLinesAfter);
assert.ok(sharedEdgesAfter > sharedEdgesBefore,
  'normalization must recover shared segments in the real network dataset');
assert.ok(sharedEdgesAfter >= 209,
  'real network should expose at least 209 shared edges after normalization');

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


const offsetMatch = source.match(/function offsetRailCoordinate[\s\S]*?\n\}/);
assert.ok(offsetMatch, 'map-app.js must expose the real shared-route offset helper');
const offsetContext = {
  sharedTrackEdges: new Map(),
  railEdgeKey: (a,b) => String(a[0])+','+String(a[1])+'|'+String(b[0])+','+String(b[1]),
  isRailVertexPinned: () => false,
  railNormal: edge => edge.normal,
  map: { project: ([lng,lat]) => ({x:lng,y:lat}), unproject: p => ({lng:p.x,lat:p.y}) },
  L: { point: (x,y) => ({x,y}) }
};
vm.createContext(offsetContext);
vm.runInContext(offsetMatch[0], offsetContext);
const p0=[0,0],p1=[1,0],p2=[1,1];
offsetContext.sharedTrackEdges.set(offsetContext.railEdgeKey(p0,p1), {normal:[0,1], offsets:new Map([['Metro A',1]])});
offsetContext.sharedTrackEdges.set(offsetContext.railEdgeKey(p1,p2), {normal:[-1,0], offsets:new Map([['Metro A',1]])});
const cornerOffset=offsetContext.offsetRailCoordinate(p1,'Metro A',12,5,[[p0,p1],[p1,p2]]);
assert.ok(Math.abs(Math.hypot(cornerOffset[0]-1,cornerOffset[1])-5*Math.SQRT2)<1e-6,
  'a 90-degree shared-route bend must use a bounded miter instead of averaging normals and shrinking the offset');
offsetContext.railNormal = edge => edge.normal;
offsetContext.sharedTrackEdges.set(offsetContext.railEdgeKey(p1,p2), {normal:[0,-1], offsets:new Map([['Metro A',1]])});
const reversalOffset=offsetContext.offsetRailCoordinate(p1,'Metro A',12,5,[[p0,p1],[p1,p2]]);
assert.ok(reversalOffset.every(Number.isFinite) && Math.hypot(reversalOffset[0]-1,reversalOffset[1])<=5.001,
  'near-reversal geometry must fall back to a single edge offset rather than create a spike');

console.log('Route topology tests passed: 7 junction/station anchoring cases plus offset-join regressions.');
