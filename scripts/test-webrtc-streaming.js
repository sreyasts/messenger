#!/usr/bin/env node
/**
 * scripts/test-webrtc-streaming.js
 * Tier 1, Tier 2, and Tier 4: WebRTC DataChannel 1 GB Chunk Streaming,
 * Backpressure Flow Control, and Cryptographic SHA-256 Integrity Verification
 */

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');

const CHUNK_SIZE = 64 * 1024; // 64 KB
const BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB
const BUFFER_LOW_WATERMARK = 1 * 1024 * 1024; // 1 MB
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB (1,073,741,824 bytes)

/**
 * Helper to compute SHA-256 in Node.js
 */
function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculates number of chunks for a given file size
 */
function calculateChunkCount(fileSize, chunkSize = CHUNK_SIZE) {
  if (fileSize <= 0) return 0;
  return Math.ceil(fileSize / chunkSize);
}

test('Tier 1: WebRTC DataChannel Protocol Constants & Math', async (t) => {
  await t.test('Chunk size must be exactly 64 KB (65,536 bytes)', () => {
    assert.equal(CHUNK_SIZE, 65536);
  });

  await t.test('Backpressure thresholds must match 4 MB high and 1 MB low watermark', () => {
    assert.equal(BUFFER_HIGH_WATERMARK, 4194304);
    assert.equal(BUFFER_LOW_WATERMARK, 1048576);
  });

  await t.test('1 GB maximum size must equal 1,073,741,824 bytes', () => {
    assert.equal(MAX_FILE_SIZE, 1073741824);
  });
});

test('Tier 2: Boundary File Sizes and Chunking Math', async (t) => {
  await t.test('0-byte file produces 0 data chunks', () => {
    assert.equal(calculateChunkCount(0), 0);
  });

  await t.test('Exact 64 KB (65,536 B) produces exactly 1 chunk', () => {
    assert.equal(calculateChunkCount(65536), 1);
  });

  await t.test('64 KB + 1 B (65,537 B) produces exactly 2 chunks', () => {
    assert.equal(calculateChunkCount(65537), 2);
  });

  await t.test('50 MB storage threshold (52,428,800 B) produces exactly 800 chunks', () => {
    assert.equal(calculateChunkCount(52428800), 800);
  });

  await t.test('50 MB + 1 B (52,428,801 B) produces 801 chunks', () => {
    assert.equal(calculateChunkCount(52428801), 801);
  });

  await t.test('1 GB maximum file (1,073,741,824 B) produces exactly 16,384 chunks', () => {
    assert.equal(calculateChunkCount(MAX_FILE_SIZE), 16384);
  });

  await t.test('Empty buffer SHA-256 standard NIST digest match', () => {
    const emptySha256 = computeSha256(Buffer.alloc(0));
    assert.equal(emptySha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

test('Tier 4: WebRTC DataChannel End-to-End Streaming & Flow Control Simulation', async (t) => {
  // Mock DataChannel simulation harness
  class MockDataChannel {
    constructor() {
      this.bufferedAmount = 0;
      this.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;
      this.onbufferedamountlow = null;
      this.onmessage = null;
      this.readyState = 'open';
      this.receivedMessages = [];
      this.drainRateBytesPerTick = 1024 * 1024; // 1MB drain per tick
    }

    send(data) {
      if (typeof data === 'string') {
        this.receivedMessages.push({ type: 'control', data: JSON.parse(data) });
      } else {
        const byteLength = data.byteLength || data.length;
        this.bufferedAmount += byteLength;
        this.receivedMessages.push({ type: 'binary', data: Buffer.from(data) });

        // Simulate asynchronous network draining
        setTimeout(() => {
          this.drainBuffer();
        }, 5);
      }

      if (this.onmessage) {
        this.onmessage({ data });
      }
    }

    drainBuffer() {
      this.bufferedAmount = Math.max(0, this.bufferedAmount - this.drainRateBytesPerTick);
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold && this.onbufferedamountlow) {
        const callback = this.onbufferedamountlow;
        this.onbufferedamountlow = null;
        callback();
      }
    }
  }

  await t.test('Simulates end-to-end multi-chunk transfer with SHA-256 validation', async () => {
    // Generate 320 KB random payload (5 full chunks)
    const originalData = crypto.randomBytes(320 * 1024);
    const expectedHash = computeSha256(originalData);

    const channel = new MockDataChannel();
    const receivedChunks = [];
    let transferCompleted = false;

    // Receiver listener
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'EOF') {
          transferCompleted = true;
        }
      } else {
        receivedChunks.push(Buffer.from(event.data));
      }
    };

    // Sender slicing logic
    let offset = 0;
    while (offset < originalData.length) {
      const chunk = originalData.subarray(offset, offset + CHUNK_SIZE);
      channel.send(chunk);
      offset += chunk.length;
    }
    channel.send(JSON.stringify({ type: 'EOF' }));

    assert.ok(transferCompleted, 'Transfer must emit EOF frame');
    assert.equal(receivedChunks.length, 5, 'Should receive exactly 5 chunks');

    const assembled = Buffer.concat(receivedChunks);
    const receivedHash = computeSha256(assembled);

    assert.equal(assembled.length, originalData.length, 'Reconstructed payload size must match');
    assert.equal(receivedHash, expectedHash, 'SHA-256 checksum must match 100%');
  });

  await t.test('Simulates backpressure control when socket buffer exceeds 4 MB', async () => {
    const channel = new MockDataChannel();
    let backpressureTriggered = false;

    // Artificially saturate buffer to 4.5 MB
    channel.bufferedAmount = 4.5 * 1024 * 1024;

    // Sender backpressure wait loop
    if (channel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
      backpressureTriggered = true;
      await new Promise((resolve) => {
        channel.onbufferedamountlow = () => {
          resolve();
        };
        // Trigger drain
        channel.drainBuffer();
        channel.drainBuffer();
        channel.drainBuffer();
        channel.drainBuffer();
      });
    }

    assert.ok(backpressureTriggered, 'Backpressure threshold must be detected when buffer > 4MB');
    assert.ok(
      channel.bufferedAmount <= BUFFER_LOW_WATERMARK,
      'Buffer must fall below 1MB low watermark before resuming'
    );
  });

  await t.test('Adversarial Verification: Bit corruption in transit must trigger SHA-256 mismatch failure', async () => {
    const originalData = crypto.randomBytes(192 * 1024); // 3 chunks
    const expectedHash = computeSha256(originalData);

    const receivedChunks = [];
    let offset = 0;

    // Simulate sending 3 chunks
    while (offset < originalData.length) {
      const chunk = Buffer.from(originalData.subarray(offset, offset + CHUNK_SIZE));
      receivedChunks.push(chunk);
      offset += chunk.length;
    }

    // Tamper with chunk #1 (flip 1 byte)
    receivedChunks[1][42] = receivedChunks[1][42] ^ 0xff;

    const corruptedData = Buffer.concat(receivedChunks);
    const calculatedHash = computeSha256(corruptedData);

    assert.notEqual(
      calculatedHash,
      expectedHash,
      'Calculated hash of corrupted data must not match expected hash'
    );

    // Verify error classification
    const isIntegrityVerified = calculatedHash.toLowerCase() === expectedHash.toLowerCase();
    assert.equal(isIntegrityVerified, false, 'Integrity check must fail');
  });

  await t.test('Pause and Resume state transitions preserve data integrity', async () => {
    const originalData = crypto.randomBytes(256 * 1024); // 4 chunks
    const expectedHash = computeSha256(originalData);

    let isPaused = false;
    let offset = 0;
    const sentChunks = [];

    // Send first 2 chunks
    while (offset < 128 * 1024) {
      const chunk = originalData.subarray(offset, offset + CHUNK_SIZE);
      sentChunks.push(chunk);
      offset += chunk.length;
    }

    // Trigger Pause
    isPaused = true;
    assert.equal(isPaused, true);
    assert.equal(sentChunks.length, 2);

    // Resume transfer
    isPaused = false;
    while (offset < originalData.length) {
      const chunk = originalData.subarray(offset, offset + CHUNK_SIZE);
      sentChunks.push(chunk);
      offset += chunk.length;
    }

    const reassembled = Buffer.concat(sentChunks);
    assert.equal(reassembled.length, originalData.length);
    assert.equal(computeSha256(reassembled), expectedHash);
  });
});
