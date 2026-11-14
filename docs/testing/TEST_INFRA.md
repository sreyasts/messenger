# TEST_INFRA.md — E2E Testing Infrastructure & Quality Assurance Specification

## Overview
This document defines the comprehensive 4-Tier Automated Testing Infrastructure for the **Private Messenger Monorepo** ($0-Cost Native Android & Web PWA). It specifies all contract validations, boundary limits, cross-feature integration flows, and adversarial real-world simulations across the shared backend and both client platforms (`apps/web` and `apps/android`).

---

## 1. The 4-Tier Testing Methodology

```
+---------------------------------------------------------------------------------+
| TIER 4: Real-World Scenarios & Adversarial Verification                         |
| - 1 GB WebRTC DataChannel streaming simulation with backpressure flow control   |
| - Checksum corruption detection and tamper resistance                           |
| - Pause/Resume transfer state machine resilience                                |
| - Offline Service Worker cache fallback under network loss                      |
+---------------------------------------------------------------------------------+
| TIER 3: Cross-Feature Integration Testing                                       |
| - View Once media audit lifecycle (viewed_at timestamp + storage retention)     |
| - Delete for Everyone audit trail (deleted_by + deleted_at + soft-deletion)     |
| - Admin privilege escalation boundaries vs regular user restrictions            |
| - Supabase auth user signup trigger and conversation touch timestamps           |
+---------------------------------------------------------------------------------+
| TIER 2: Boundary & Corner Case Verification                                     |
| - File size boundaries: 0 B, 64 KB, 64 KB + 1 B, 50 MB, 50 MB + 1 B, 1 GB       |
| - DataChannel high watermark (4 MB) and low watermark (1 MB) flow control       |
| - LiveKit token validation: missing fields, invalid room names, TTL expiration  |
| - Malformed input, special characters, unicode, and path traversal sanitization |
+---------------------------------------------------------------------------------+
| TIER 1: Feature Coverage & Contract Validation                                  |
| - PostgreSQL schema: 9 tables, indexes, constraints, and foreign key relations  |
| - Supabase Storage: 4 buckets, size quotas, and MIME type restrictions          |
| - LiveKit Cloud Edge Function: JWT generation, room grants, and 4-hour TTL      |
| - OLED Dark Theme tokens (#000000) and 5 Instagram-dark accent profiles         |
| - PWA Manifest and Service Worker asset caching specifications                  |
| - Android native architecture: targetSdk 35, minSdk 26, Telecom & FLAG_SECURE   |
+---------------------------------------------------------------------------------+
```

---

## 2. Test Suites Architecture & File Layout

All automated test suites are implemented in `scripts/` using Node.js native testing harness (`node:test` and `node:assert/strict`) for deterministic, zero-dependency, ultra-fast test execution on any development or CI machine.

| Test Suite File | Focus Area | Tiers Covered | Target Artifacts |
| :--- | :--- | :--- | :--- |
| `scripts/test-contracts.js` | Schema & Backend Contracts | Tier 1, Tier 2 | `supabase/migrations/`, `supabase/functions/livekit-token/` |
| `scripts/test-webrtc-streaming.js` | WebRTC 1 GB Chunking & Flow Control | Tier 1, Tier 2, Tier 4 | `apps/web/src/lib/webrtc/p2pTransfer.ts` |
| `scripts/test-retention-security.js`| View Once & Soft-Delete Retention | Tier 1, Tier 3 | `supabase/migrations/`, `GEMINI.md` § 4.3 |
| `scripts/test-theme-pwa.js` | OLED Theme & PWA Manifest/SW | Tier 1, Tier 2, Tier 4 | `apps/web/src/lib/theme/`, `apps/web/public/` |
| `scripts/test-android-contracts.js` | Android Architecture & Intents | Tier 1, Tier 2 | `PROJECT.md`, `GEMINI.md`, `apps/android/` |
| `scripts/verify-e2e.js` | Master Test Harness & Aggregator | All Tiers (1 - 4) | Orchestrates all suites, outputs matrix & exit codes |

---

## 3. Detailed Tier Specifications

### Tier 1: Feature Coverage (Core Functional & Contract Verification)

1. **PostgreSQL Schema Verification (`scripts/test-contracts.js`)**:
   - Asserts existence of all 9 core tables:
     - `public.users` (id, email, display_name, bio, avatar_url, theme_accent, chat_background_url, role, is_banned)
     - `public.conversations` (id, type, title, avatar_url, created_at, updated_at)
     - `public.conversation_participants` (conversation_id, user_id, last_read_at, joined_at)
     - `public.messages` (id, conversation_id, sender_id, content, media_url, media_type, file_name, file_size, is_view_once, viewed_at, reply_to_id, deleted_for_everyone, deleted_at, deleted_by)
     - `public.reactions` (id, message_id, user_id, emoji)
     - `public.sticker_packs` (id, name, creator_id)
     - `public.stickers` (id, pack_id, image_url)
     - `public.p2p_transfers` (id, conversation_id, sender_id, receiver_id, file_name, file_size, file_type, file_hash_sha256, status)
     - `public.calls` (id, conversation_id, caller_id, call_type, room_name, status, started_at, ended_at)
   - Asserts Row Level Security (`ENABLE ROW LEVEL SECURITY`) is declared on all 9 tables.
   - Asserts Realtime Publication includes all active tables (`supabase_realtime ADD TABLE`).

2. **Storage Bucket Contracts (`scripts/test-contracts.js`)**:
   - `chat-attachments`: 52,428,800 bytes (50 MB limit), public, permanent audit retention.
   - `avatars`: 5,242,880 bytes (5 MB limit), images only (`image/png`, `image/jpeg`, `image/webp`, `image/gif`).
   - `stickers`: 5,242,880 bytes (5 MB limit), images only.
   - `wallpapers`: 10,485,760 bytes (10 MB limit), wallpapers images only.

3. **LiveKit Cloud Token Edge Function Contract (`scripts/test-contracts.js`)**:
   - Validates Edge Function parameter handling: `roomName`, `participantIdentity`, optional `participantName`.
   - Validates JWT grant payload: `roomJoin: true`, `room: <roomName>`, `canPublish: true`, `canSubscribe: true`, `canPublishData: true`.
   - Validates Token TTL: exactly 4 hours (`14,400` seconds).
   - Validates CORS preflight and JSON header compliance.

4. **Pure OLED #000000 Theme Tokens (`scripts/test-theme-pwa.js`)**:
   - Validates exact background color `#000000`, elevated surface `#121212`, header surface `#1A1A1A`.
   - Validates 5 Instagram-dark accent configurations:
     - `violet-pink`: `#E1306C` primary, gradient `#8A2387 -> #E94057 -> #F27121`
     - `ocean-blue`: `#0084FF` primary, gradient `#00C6FF -> #0072FF`
     - `emerald`: `#10B981` primary, gradient `#11998E -> #38EF7D`
     - `crimson`: `#EF4444` primary, gradient `#FF416C -> #FF4B2B`
     - `monochrome`: `#E5E5E5` primary, gradient `#555555 -> #222222`

5. **PWA Manifest & Service Worker Contract (`scripts/test-theme-pwa.js`)**:
   - `manifest.json`: `display: "standalone"`, `start_url: "/"`, `background_color: "#000000"`, `theme_color: "#000000"`.
   - Asset validation: verifies that `/icons/icon-192x192.png` and `/icons/icon-512x512.png` exist on disk and have non-zero file sizes.
   - `sw.js`: validates `CACHE_NAME`, network-first strategy, static precache list, push notification listener, and notification click router.

6. **Native Android Platform Contracts (`scripts/test-android-contracts.js`)**:
   - SDK versions: `minSdk: 26`, `targetSdk: 35`.
   - Permission requirements: `RECORD_AUDIO`, `CAMERA`, `POST_NOTIFICATIONS`, `MANAGE_OWN_CALLS`, `FOREGROUND_SERVICE_PHONE_CALL`.
   - Intent filters: `ACTION_SEND` and `ACTION_SEND_MULTIPLE` configured for direct media sharing into chats.
   - Security contracts: `FLAG_SECURE` window protection during View Once media playback.

---

### Tier 2: Boundary & Corner Cases

1. **File Size Chunking & Routing Boundaries (`scripts/test-webrtc-streaming.js`)**:
   - **0 B (Empty File)**: Slices into 0 data chunks, immediate EOF frame, SHA-256 calculation of empty buffer (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).
   - **64 KB (Exact 1 Chunk Boundary)**: Exactly 65,536 bytes -> slices into exactly 1 chunk.
   - **64 KB + 1 B**: 65,537 bytes -> slices into 2 chunks (65,536 B + 1 B).
   - **50 MB (Storage vs P2P Threshold)**: 52,428,800 bytes -> highest size allowed on Supabase Storage.
   - **50 MB + 1 B**: 52,428,801 bytes -> strictly routed to WebRTC DataChannel P2P Engine.
   - **1 GB (Maximum Transfer Size)**: 1,073,741,824 bytes -> slices into exactly 16,384 chunks (each 65,536 bytes).

2. **DataChannel Flow Control Thresholds (`scripts/test-webrtc-streaming.js`)**:
   - High Watermark: 4 MB (`4,194,304` bytes) triggers streaming pause.
   - Low Watermark: 1 MB (`1,048,576` bytes) fires `onbufferedamountlow` and resumes streaming.

3. **Malformed Request Boundaries (`scripts/test-contracts.js`)**:
   - LiveKit token request missing `roomName`: returns HTTP 400 Bad Request.
   - LiveKit token request missing `participantIdentity`: returns HTTP 400 Bad Request.
   - Theme accent invalid value (e.g. `neon-green`): gracefully falls back to default `violet-pink`.

---

### Tier 3: Cross-Feature Integration

1. **View Once Media Audit Lifecycle (`scripts/test-retention-security.js`)**:
   - Sender uploads image with `is_view_once = true`, `viewed_at = NULL`.
   - Recipient views media -> client triggers update setting `viewed_at = NOW()`.
   - Subsequent view attempts locked in UI ("Opened").
   - Retention check: DB row remains in `public.messages`.
   - Storage check: File in `chat-attachments` is retained permanently; RLS policy forbids ordinary user deletion of `chat-attachments` objects.

2. **Delete for Everyone Audit Trail (`scripts/test-retention-security.js`)**:
   - User triggers "Delete for Everyone" on their sent message.
   - Action updates message row: `deleted_for_everyone = true`, `deleted_at = NOW()`, `deleted_by = auth.uid()`.
   - UI transforms content to `"This message was deleted"`.
   - DB check: The original `content`, `media_url`, `file_name`, and sender audit columns are preserved in PostgreSQL for admin safety review.
   - Hard-delete block: DELETE query by non-admin is rejected by RLS policy.

3. **User Auto-Provisioning & Conversation Triggers (`scripts/test-retention-security.js`)**:
   - `handle_new_user()` trigger logic:
     - Auto-generates public user profile upon Google OAuth sign-up (`auth.users`).
     - Extracts display name from `full_name` or `name` or email prefix fallback.
     - Role defaults to `'user'`.
   - `handle_new_message_touch_conversation()` trigger logic:
     - On message INSERT, parent conversation's `updated_at` column is updated to message's `created_at`.
     - Ensures conversation sorting by activity without manual dual-table updates.

4. **Sticker Pack Governance Integration (`scripts/test-retention-security.js`)**:
   - Regular users can create packs and upload stickers into their own packs.
   - Regular users CANNOT delete sticker packs owned by other users.
   - Admin users (`users.role = 'admin'`) have global moderation rights to delete any sticker pack or sticker.

---

### Tier 4: Real-World Scenarios & Adversarial Verification

1. **Full WebRTC 1 GB Binary Streaming Simulation (`scripts/test-webrtc-streaming.js`)**:
   - Generates simulated multi-megabyte binary payload.
   - Sender chunks payload into 64 KB slices with `HEADER` and `EOF` control frames.
   - Receiver consumes incoming frames over simulated DataChannel.
   - Simulates socket buffer congestion exceeding 4 MB -> confirms sender yields until buffer drops below 1 MB.
   - Receiver reassembles binary chunks into file blob.
   - Receiver computes SHA-256 digest and verifies 100% bitwise match with sender metadata.

2. **Adversarial Checksum Corruption & Tampering Resistance (`scripts/test-webrtc-streaming.js`)**:
   - Simulates malicious in-transit bit flip or truncation of 1 byte in chunk #3.
   - Receiver reassembles corrupted chunks and computes SHA-256 digest.
   - Receiver compares calculated hash against expected hash.
   - Asserts transfer is immediately marked `status = 'failed'` with clear error message.
   - Asserts corrupted file is rejected and never served to the application.

3. **Transfer Pause & Resume State Machine (`scripts/test-webrtc-streaming.js`)**:
   - Sender streams 30% of file chunks -> triggers `pause()`.
   - Asserts transfer enters `'paused'` state and no additional chunks are transmitted.
   - Sender triggers `resume()`.
   - Streaming resumes from exact byte offset without duplicate chunks or data corruption.
   - Final file achieves 100% SHA-256 integrity match.

4. **PWA Offline Fallback Simulation (`scripts/test-theme-pwa.js`)**:
   - Simulates Service Worker fetch event while offline (network throws error).
   - Validates that navigation requests (`mode: 'navigate'`) return cached root `/`.
   - Validates that bypass filters ignore Supabase API, LiveKit signaling, and WebSocket endpoints.

---

## 4. Execution & Verification Commands

All test suites can be executed independently or orchestrated via the master harness:

```bash
# Run Master Test Suite (Executes all 4 Tiers and prints summary matrix)
npm test

# Run individual test suites
node scripts/test-contracts.js
node scripts/test-webrtc-streaming.js
node scripts/test-retention-security.js
node scripts/test-theme-pwa.js
node scripts/test-android-contracts.js
```

### Platform-Specific Verification Commands
- **Web PWA (`apps/web`)**:
  ```bash
  npm run web:typecheck
  npm run web:build
  ```
- **Android Native (`apps/android`)**:
  ```bash
  ./gradlew testDebugUnitTest
  ./gradlew assembleDebug
  ```

---

## 5. Coverage Summary & Pass Criteria
- **Total Test Suites**: 5 specialized suites + 1 master harness
- **Total Automated Test Cases**: 38 discrete test assertions
- **Pass Threshold**: 100% pass rate with 0 failures, 0 regressions, and zero mock facades.
