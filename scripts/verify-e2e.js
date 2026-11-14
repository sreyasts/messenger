#!/usr/bin/env node
/**
 * scripts/verify-e2e.js
 * Master E2E & Contract Verification Test Harness
 * Orchestrates all 4 testing tiers across the monorepo and outputs full quality matrix.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const SUITES = [
  {
    name: 'Backend Schema & LiveKit Contracts',
    file: 'scripts/test-contracts.js',
    tier: 'Tier 1 & Tier 2',
    description: 'PostgreSQL 9-table schema, storage limits, RLS, Edge Function token generation',
  },
  {
    name: 'WebRTC DataChannel 1 GB Streaming',
    file: 'scripts/test-webrtc-streaming.js',
    tier: 'Tier 1, Tier 2 & Tier 4',
    description: '64 KB chunking, backpressure flow control, SHA-256 verification, adversarial bit corruption',
  },
  {
    name: 'Retention & Security Lifecycle',
    file: 'scripts/test-retention-security.js',
    tier: 'Tier 1 & Tier 3',
    description: 'View Once audit lifecycle, Delete for Everyone soft-delete, auto-provisioning triggers',
  },
  {
    name: 'OLED #000000 Theme & PWA Manifest/SW',
    file: 'scripts/test-theme-pwa.js',
    tier: 'Tier 1, Tier 2 & Tier 4',
    description: 'OLED black tokens, 5 Instagram-dark accents, PWA manifest, service worker offline cache',
  },
  {
    name: 'Android Native Contracts',
    file: 'scripts/test-android-contracts.js',
    tier: 'Tier 1 & Tier 2',
    description: 'minSdk 26, targetSdk 35, Telecom CallStyle, PiP, FLAG_SECURE, Share intents',
  },
];

console.log('='.repeat(80));
console.log('  PRIVATE MESSENGER MONOREPO — E2E & CONTRACT VERIFICATION HARNESS');
console.log('  4-Tier Methodology: Feature Coverage -> Boundary -> Cross-Feature -> Real-World');
console.log('='.repeat(80));
console.log('');

let totalPassed = 0;
let totalFailed = 0;
const results = [];

const startTime = Date.now();

for (const suite of SUITES) {
  const suitePath = path.join(ROOT_DIR, suite.file);
  console.log(`[RUNNING] ${suite.name} (${suite.tier})...`);

  const proc = spawnSync('node', [suitePath], {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const output = proc.stdout + proc.stderr;
  const isSuccess = proc.status === 0;

  // Extract passed test count if available from Node test runner output
  const passMatch = output.match(/ℹ pass (\d+)/);
  const suitePassCount = passMatch ? parseInt(passMatch[1], 10) : (isSuccess ? 1 : 0);

  if (isSuccess) {
    totalPassed += suitePassCount;
    results.push({ ...suite, status: 'PASS', count: suitePassCount });
    console.log(`  -> PASS (${suitePassCount} tests passed)`);
  } else {
    totalFailed += 1;
    results.push({ ...suite, status: 'FAIL', count: 0, error: output });
    console.error(`  -> FAIL! Exit code: ${proc.status}`);
    console.error(output);
  }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('');
console.log('='.repeat(80));
console.log('                       E2E VERIFICATION SUMMARY MATRIX');
console.log('='.repeat(80));
console.log(
  '| ' +
  'Suite Name'.padEnd(38) +
  '| ' +
  'Tier'.padEnd(24) +
  '| ' +
  'Tests'.padEnd(8) +
  '| ' +
  'Status'.padEnd(8) +
  '|'
);
console.log('|' + '-'.repeat(39) + '|' + '-'.repeat(25) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|');

for (const res of results) {
  const statusColor = res.status === 'PASS' ? 'PASS' : 'FAIL';
  console.log(
    '| ' +
    res.name.padEnd(38) +
    '| ' +
    res.tier.padEnd(24) +
    '| ' +
    String(res.count).padStart(4).padEnd(8) +
    '| ' +
    statusColor.padEnd(8) +
    '|'
  );
}

console.log('='.repeat(80));
console.log(`TOTAL SUITES : ${SUITES.length}`);
console.log(`TOTAL TESTS  : ${totalPassed + totalFailed} (${totalPassed} Passed, ${totalFailed} Failed)`);
console.log(`DURATION     : ${duration}s`);
console.log(`RESULT       : ${totalFailed === 0 ? 'ALL VERIFICATIONS PASSED (100%)' : 'FAILURES DETECTED'}`);
console.log('='.repeat(80));

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
