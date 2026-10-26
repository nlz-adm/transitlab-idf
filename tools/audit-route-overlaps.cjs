#!/usr/bin/env node
'use strict';

// Conservative geometry audit for route segments that may overlap even when
// their endpoints/segmentation differ. This reports candidates; it does not
// automatically merge them, because close parallel tracks must remain distinct.
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2] || path.join(__dirname, '..', 'assets', 'network-data.json');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const cellSize = 0.005;
const maxDistanceMeters = 8;
const minOverlapMeters = 35;
const maxAngleSin = 0.025;
const segments = [];

function metersXY(point, latitude) {
  return [point[0] * 111320 * Math.cos(latitude * Math.PI / 180), point[1] * 111320];
}
function distance(a, b) {
  const lat = (a[1] + b[1]) / 2;
  const [ax, ay] = metersXY(a, lat);
  const [bx, by] = metersXY(b, lat);
  return Math.hypot(bx - ax, by - ay);
}
for (const feature of data.lines || []) {
  const geometry = feature.geometry;
  if (!geometry) continue;
  const chains = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
  for (const coords of chains || []) {
    for (let i = 1; i < (coords || []).length; i++) {
      const a = coords[i - 1], b = coords[i];
      if (!Array.isArray(a) || !Array.isArray(b) || distance(a, b) < 8) continue;
      segments.push({ a, b, line: String(feature.properties?.line || '') });
    }
  }
}
const cells = new Map();
for (let i = 0; i < segments.length; i++) {
  const { a, b } = segments[i];
  for (let x = Math.floor(Math.min(a[0], b[0]) / cellSize); x <= Math.floor(Math.max(a[0], b[0]) / cellSize); x++) {
    for (let y = Math.floor(Math.min(a[1], b[1]) / cellSize); y <= Math.floor(Math.max(a[1], b[1]) / cellSize); y++) {
      const key = x + ',' + y;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
  }
}
const checked = new Set();
const candidates = [];
for (const bucket of cells.values()) {
  for (let p = 0; p < bucket.length; p++) {
    for (let q = p + 1; q < bucket.length; q++) {
      const i = bucket[p], j = bucket[q];
      if (i === j || segments[i].line === segments[j].line) continue;
      const pairKey = i < j ? i + ',' + j : j + ',' + i;
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);
      const s = segments[i], t = segments[j];
      const latitude = (s.a[1] + s.b[1] + t.a[1] + t.b[1]) / 4;
      const [ax, ay] = metersXY(s.a, latitude), [bx, by] = metersXY(s.b, latitude);
      const [cx, cy] = metersXY(t.a, latitude), [dx, dy] = metersXY(t.b, latitude);
      const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy;
      const length = Math.hypot(ux, uy), otherLength = Math.hypot(vx, vy);
      if (length < 8 || otherLength < 8) continue;
      if (Math.abs(ux * vy - uy * vx) / (length * otherLength) > maxAngleSin) continue;
      const offsetA = Math.abs(ux * (cy - ay) - uy * (cx - ax)) / length;
      const offsetB = Math.abs(ux * (dy - ay) - uy * (dx - ax)) / length;
      if (Math.max(offsetA, offsetB) > maxDistanceMeters) continue;
      const t1 = ((cx - ax) * ux + (cy - ay) * uy) / (length * length);
      const t2 = ((dx - ax) * ux + (dy - ay) * uy) / (length * length);
      const overlap = Math.max(0, Math.min(1, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2))) * length;
      if (overlap < minOverlapMeters) continue;
      candidates.push({ lines: [s.line, t.line].sort(), overlapMeters: Math.round(overlap), offsetMeters: Math.round(Math.max(offsetA, offsetB)), a: s.a, b: s.b, otherA: t.a, otherB: t.b });
    }
  }
}
const byPair = new Map();
for (const candidate of candidates) {
  const key = candidate.lines.join(' ↔ ');
  const record = byPair.get(key) || { pair: key, candidateSegments: 0, maxOverlapMeters: 0, examples: [] };
  record.candidateSegments++;
  record.maxOverlapMeters = Math.max(record.maxOverlapMeters, candidate.overlapMeters);
  if (record.examples.length < 3) record.examples.push({ overlapMeters: candidate.overlapMeters, offsetMeters: candidate.offsetMeters, a: candidate.a, b: candidate.b, otherA: candidate.otherA, otherB: candidate.otherB });
  byPair.set(key, record);
}
const report = {
  thresholds: { maxDistanceMeters, minOverlapMeters, maxAngleSin },
  inputLines: (data.lines || []).length,
  auditedSegments: segments.length,
  candidateSegmentPairs: candidates.length,
  linePairs: [...byPair.values()].sort((a, b) => b.candidateSegments - a.candidateSegments),
};
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
else {
  process.stdout.write('Route overlap audit (candidates, not confirmed errors)\n');
  process.stdout.write('Lines: ' + report.inputLines + '; segments: ' + report.auditedSegments + '\n');
  process.stdout.write('Candidate segment pairs: ' + report.candidateSegmentPairs + '\n');
  for (const pair of report.linePairs.slice(0, 20)) {
    process.stdout.write(pair.pair + ': ' + pair.candidateSegments + ' candidates; longest overlap ' + pair.maxOverlapMeters + ' m\n');
    const example = pair.examples[0];
    if (example) process.stdout.write('  example coordinates: ' + JSON.stringify([example.a, example.b, example.otherA, example.otherB]) + ' (offset <= ' + example.offsetMeters + ' m)\n');
  }
}
