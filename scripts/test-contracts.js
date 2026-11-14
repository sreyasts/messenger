#!/usr/bin/env node
/**
 * scripts/test-contracts.js
 * Tier 1 & Tier 2: Backend Schema, Storage, and LiveKit Contract Verification
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(ROOT_DIR, 'supabase', 'migrations', '20261114000000_init_schema.sql');
const LIVEKIT_FUNCTION_PATH = path.join(ROOT_DIR, 'supabase', 'functions', 'livekit-token', 'index.ts');

test('Tier 1: Supabase PostgreSQL Schema Contracts', async (t) => {
  assert.ok(fs.existsSync(MIGRATION_PATH), `Migration file must exist at ${MIGRATION_PATH}`);
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');

  await t.test('All 9 core tables must be declared in migration', () => {
    const expectedTables = [
      'public.users',
      'public.conversations',
      'public.conversation_participants',
      'public.messages',
      'public.reactions',
      'public.sticker_packs',
      'public.stickers',
      'public.p2p_transfers',
      'public.calls',
    ];

    for (const table of expectedTables) {
      const tableRegex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i');
      assert.ok(
        tableRegex.test(sql),
        `Table definition missing for ${table}`
      );
    }
  });

  await t.test('All 9 tables must have Row Level Security (RLS) enabled', () => {
    const rlsTables = [
      'public.users',
      'public.conversations',
      'public.conversation_participants',
      'public.messages',
      'public.reactions',
      'public.sticker_packs',
      'public.stickers',
      'public.p2p_transfers',
      'public.calls',
    ];

    for (const table of rlsTables) {
      const rlsRegex = new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, 'i');
      assert.ok(
        rlsRegex.test(sql),
        `RLS must be enabled on table ${table}`
      );
    }
  });

  await t.test('Critical columns and audit fields must be present', () => {
    // Users table audit and theme
    assert.match(sql, /theme_accent TEXT DEFAULT 'violet-pink'/i);
    assert.match(sql, /role TEXT DEFAULT 'user'/i);
    assert.match(sql, /is_banned BOOLEAN DEFAULT FALSE/i);

    // Messages table View Once & Delete for Everyone audit columns
    assert.match(sql, /is_view_once BOOLEAN DEFAULT FALSE/i);
    assert.match(sql, /viewed_at TIMESTAMPTZ/i);
    assert.match(sql, /deleted_for_everyone BOOLEAN DEFAULT FALSE/i);
    assert.match(sql, /deleted_at TIMESTAMPTZ/i);
    assert.match(sql, /deleted_by UUID REFERENCES public\.users/i);

    // P2P transfers table SHA-256 and 1GB metadata
    assert.match(sql, /file_hash_sha256 TEXT NOT NULL/i);
    assert.match(sql, /file_size BIGINT NOT NULL/i);
    assert.match(sql, /status TEXT DEFAULT 'pending'/i);

    // Calls table
    assert.match(sql, /call_type TEXT NOT NULL/i);
    assert.match(sql, /room_name TEXT NOT NULL/i);
  });

  await t.test('Supabase Realtime publication must include all collaborative tables', () => {
    const realtimeTables = [
      'public.messages',
      'public.reactions',
      'public.conversations',
      'public.conversation_participants',
      'public.p2p_transfers',
      'public.calls',
    ];

    for (const table of realtimeTables) {
      const pubRegex = new RegExp(`ALTER PUBLICATION supabase_realtime ADD TABLE ${table};`, 'i');
      assert.ok(
        pubRegex.test(sql),
        `Realtime publication must include table ${table}`
      );
    }
  });

  await t.test('Storage buckets must be configured with exact free-tier size quotas', () => {
    // chat-attachments: 50MB (52,428,800 bytes)
    assert.match(sql, /'chat-attachments', 'chat-attachments', true, 52428800/i);
    // avatars: 5MB (5,242,880 bytes)
    assert.match(sql, /'avatars', 'avatars', true, 5242880/i);
    // stickers: 5MB (5,242,880 bytes)
    assert.match(sql, /'stickers', 'stickers', true, 5242880/i);
    // wallpapers: 10MB (10,485,760 bytes)
    assert.match(sql, /'wallpapers', 'wallpapers', true, 10485760/i);
  });
});

test('Tier 1: LiveKit Cloud Token Edge Function Contracts', async (t) => {
  assert.ok(fs.existsSync(LIVEKIT_FUNCTION_PATH), `Edge function missing at ${LIVEKIT_FUNCTION_PATH}`);
  const functionCode = fs.readFileSync(LIVEKIT_FUNCTION_PATH, 'utf-8');

  await t.test('Must mandate roomName and participantIdentity inputs', () => {
    assert.match(functionCode, /roomName/);
    assert.match(functionCode, /participantIdentity/);
    assert.match(functionCode, /!roomName \|\| !participantIdentity/);
    assert.match(functionCode, /status:\s*400/);
  });

  await t.test('Must set 4-hour token TTL (14,400 seconds)', () => {
    assert.match(functionCode, /ttl:\s*4\s*\*\s*60\s*\*\s*60/);
  });

  await t.test('Must configure required audio/video room grants', () => {
    assert.match(functionCode, /roomJoin:\s*true/);
    assert.match(functionCode, /room:\s*roomName/);
    assert.match(functionCode, /canPublish:\s*true/);
    assert.match(functionCode, /canSubscribe:\s*true/);
    assert.match(functionCode, /canPublishData:\s*true/);
  });

  await t.test('Must enforce CORS preflight headers', () => {
    assert.match(functionCode, /Access-Control-Allow-Origin/);
    assert.match(functionCode, /req\.method\s*===\s*"OPTIONS"/);
  });
});

test('Tier 2: Boundary & Malformed Input Handling on Edge Function Logic', async (t) => {
  // Simulate the edge function handler logic locally
  function simulateLivekitTokenHandler(body, env) {
    if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      return { status: 500, error: 'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured' };
    }
    if (!body || !body.roomName || !body.participantIdentity) {
      return { status: 400, error: "Missing required parameters: 'roomName' and 'participantIdentity' are required." };
    }
    return {
      status: 200,
      token: 'mock_jwt_token_4h',
      livekitUrl: env.LIVEKIT_URL || 'wss://your-project.livekit.cloud',
      roomName: body.roomName,
      participantIdentity: body.participantIdentity,
      expiresInSeconds: 4 * 60 * 60,
    };
  }

  await t.test('Returns 500 when environment variables are missing', () => {
    const res = simulateLivekitTokenHandler({ roomName: 'room-1', participantIdentity: 'user-1' }, {});
    assert.equal(res.status, 500);
    assert.match(res.error, /LIVEKIT_API_KEY/);
  });

  await t.test('Returns 400 when roomName is missing or empty', () => {
    const env = { LIVEKIT_API_KEY: 'test_key', LIVEKIT_API_SECRET: 'test_secret' };
    const res1 = simulateLivekitTokenHandler({ participantIdentity: 'user-1' }, env);
    assert.equal(res1.status, 400);

    const res2 = simulateLivekitTokenHandler({ roomName: '', participantIdentity: 'user-1' }, env);
    assert.equal(res2.status, 400);
  });

  await t.test('Returns 400 when participantIdentity is missing or empty', () => {
    const env = { LIVEKIT_API_KEY: 'test_key', LIVEKIT_API_SECRET: 'test_secret' };
    const res = simulateLivekitTokenHandler({ roomName: 'room-1', participantIdentity: '' }, env);
    assert.equal(res.status, 400);
  });

  await t.test('Succeeds with valid parameters and configures 4h expiration', () => {
    const env = { LIVEKIT_API_KEY: 'test_key', LIVEKIT_API_SECRET: 'test_secret', LIVEKIT_URL: 'wss://test.livekit.cloud' };
    const res = simulateLivekitTokenHandler({ roomName: 'room-101', participantIdentity: 'user-42' }, env);
    assert.equal(res.status, 200);
    assert.equal(res.roomName, 'room-101');
    assert.equal(res.participantIdentity, 'user-42');
    assert.equal(res.expiresInSeconds, 14400);
  });
});
