#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fixture = {
  lines: [
    { properties: { line: 'A' }, geometry: { type: 'LineString', coordinates: [[2.0, 48.0], [2.01, 48.0]] } },
    // Same corridor, but different endpoints and reversed direction.
    { properties: { line: 'B' }, geometry: { type: 'LineString', coordinates: [[2.008, 48.00001], [2.002, 48.00001]] } },
    // A nearby crossing must not be treated as a long shared segment.
    { properties: { line: 'C' }, geometry: { type: 'LineString', coordinates: [[2.005, 47.995], [2.005, 48.005]] } },
    // A parallel route far enough away must not be a candidate.
    { properties: { line: 'D' }, geometry: { type: 'LineString', coordinates: [[2.0, 48.0002], [2.01, 48.0002]] } },
  ],
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-overlap-test-'));
try {
  const fixturePath = path.join(tempDir, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const scriptPath = path.join(__dirname, 'audit-route-overlaps.cjs');
  const result = spawnSync(process.execPath, [scriptPath, fixturePath, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.candidateSegmentPairs >= 1, 'should detect a shared corridor despite different segmentation');
  assert.ok(report.linePairs.some(pair => pair.pair === 'A ↔ B'), 'should report the expected route pair');
  assert.ok(!report.linePairs.some(pair => pair.pair === 'A ↔ C'), 'should not report a crossing as a shared corridor');
  assert.ok(!report.linePairs.some(pair => pair.pair === 'A ↔ D'), 'should not report a parallel route outside the distance threshold');
  process.stdout.write('Route overlap audit tests passed: segmented overlap, crossing, and distance guard.\n');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
