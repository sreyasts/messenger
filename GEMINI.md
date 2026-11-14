# GEMINI.md - Shared Technical Architecture, Contracts & $0 Free-Tier System Blueprint

This document serves as the single source of truth for all human developers and autonomous AI subagents working on this monorepo (`apps/android` and `apps/web`).

---

## 1. Zero-Cost Free-Tier Architecture & Limits

| Service | Provider / Plan | Monthly Limit / Capacity | Free Cost Safeguards |
| :--- | :--- | :--- | :--- |
| **Database & Auth** | Supabase Free Tier | 500 MB DB, 50,000 MAU, Google OAuth | Zero credit card required; strict indexing to prevent timeouts |
| **Realtime Engine** | Supabase Realtime | 200 concurrent connections, 2M msgs/mo | Broadcast & Presence channels used for typing, calls, and WebRTC P2P signaling |
| **Object Storage** | Supabase Storage | 1 GB total storage | Only files <= 50 MB, View Once media, voice notes, stickers, and avatars. |
| **Audio/Video Calls** | LiveKit Cloud Free Plan | 5,000 WebRTC participant mins/mo, 50 GB/mo | Free STUN fallback (`stun.l.google.com:19302`), VP8/H.264 adaptive bitrate, Opus audio |
| **P2P Large File Engine** | WebRTC DataChannel | **Up to 1 GB per file** | **$0 bandwidth & $0 storage cost**: direct sender-to-receiver chunked binary transfer |
| **GIF Search** | Tenor / Giphy API | Free public search tier | Cached client-side query previews |

---

## 2. Shared PostgreSQL Database Schema & RLS

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    theme_accent TEXT DEFAULT 'violet-pink', -- 'violet-pink' | 'ocean-blue' | 'emerald' | 'crimson' | 'monochrome'
    chat_background_url TEXT DEFAULT '',
    role TEXT DEFAULT 'user', -- 'user' | 'admin'
    is_banned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'group'
    title TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CONVERSATION PARTICIPANTS
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

-- 4. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    content TEXT DEFAULT '',
    media_url TEXT DEFAULT '',
    media_type TEXT DEFAULT 'text', -- 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'gif'
    file_name TEXT DEFAULT '',
    file_size BIGINT DEFAULT 0,
    is_view_once BOOLEAN DEFAULT FALSE,
    viewed_at TIMESTAMPTZ,
    reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    deleted_for_everyone BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. REACTIONS TABLE
CREATE TABLE IF NOT EXISTS public.reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

-- 6. STICKER PACKS & STICKERS
CREATE TABLE IF NOT EXISTS public.sticker_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    creator_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stickers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID REFERENCES public.sticker_packs(id) ON DELETE CASCADE NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. P2P TRANSFERS (WebRTC 1 GB Metadata Queue)
CREATE TABLE IF NOT EXISTS public.p2p_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type TEXT NOT NULL,
    file_hash_sha256 TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CALL LOGS
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    caller_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    call_type TEXT NOT NULL, -- 'audio' | 'video'
    room_name TEXT NOT NULL,
    status TEXT DEFAULT 'ringing', -- 'ringing' | 'ongoing' | 'ended' | 'declined' | 'missed'
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- 9. USER SIGNUP TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, display_name, avatar_url, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
        'user'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
```

---

## 3. Global Dark Theme Tokens (Pure OLED `#000000`)

```typescript
export const ThemeTokens = {
  colors: {
    background: "#000000",       // Pure OLED black canvas
    surfaceElevated: "#121212",  // Bottom composer, dialogs, cards
    surfaceHeader: "#1A1A1A",    // Top app bars, menus
    surfaceSubtle: "#242424",    // Message bubble for incoming
    border: "#2A2A2A",           // Subtle dividers and borders
    textPrimary: "#FFFFFF",      // High-contrast primary text
    textSecondary: "#A0A0A0",    // Secondary timestamps, read receipts, bio
    textMuted: "#666666",        // Inactive tabs, icons
  },
  accents: {
    "violet-pink": {
      name: "Violet Pink",
      gradient: "linear-gradient(135deg, #8A2387, #E94057, #F27121)",
      primary: "#E1306C",
      outgoingBubble: "#D82D7E",
      highlight: "#FF4D94"
    },
    "ocean-blue": {
      name: "Ocean Blue",
      gradient: "linear-gradient(135deg, #00C6FF, #0072FF)",
      primary: "#0084FF",
      outgoingBubble: "#0077E6",
      highlight: "#38A9FF"
    },
    "emerald": {
      name: "Emerald",
      gradient: "linear-gradient(135deg, #11998E, #38EF7D)",
      primary: "#10B981",
      outgoingBubble: "#059669",
      highlight: "#34D399"
    },
    "crimson": {
      name: "Crimson",
      gradient: "linear-gradient(135deg, #FF416C, #FF4B2B)",
      primary: "#EF4444",
      outgoingBubble: "#DC2626",
      highlight: "#F87171"
    },
    "monochrome": {
      name: "Monochrome",
      gradient: "linear-gradient(135deg, #434343, #000000)",
      primary: "#E5E5E5",
      outgoingBubble: "#2E2E2E",
      highlight: "#FFFFFF"
    }
  }
} as const;
```

---

## 4. API & Realtime Contracts

### 4.1 LiveKit Token Generation Edge Function
- **Endpoint**: `/functions/v1/livekit-token`
- **Method**: `POST`
- **Headers**: `Authorization: Bearer <SUPABASE_ANON_OR_USER_TOKEN>`
- **Request Body**:
  ```json
  {
    "roomName": "conversation-<UUID>",
    "participantIdentity": "<USER_UUID>",
    "participantName": "Display Name"
  }
  ```
- **Response**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "livekitUrl": "wss://your-project.livekit.cloud"
  }
  ```

### 4.2 WebRTC 1 GB DataChannel Protocol
- **Chunk Size**: `64 KB` (`65,536` bytes)
- **Signaling Channel**: Supabase Realtime Broadcast on `chat:p2p:<conversation_id>`
- **Packet Types**:
  1. `FILE_TRANSFER_REQUEST`: `{ transferId, fileName, fileSize, fileType, fileHashSha256 }`
  2. `FILE_TRANSFER_ACCEPT`: `{ transferId }`
  3. `FILE_TRANSFER_REJECT`: `{ transferId, reason }`
  4. `P2P_SIGNAL_OFFER`: `{ transferId, sdp }`
  5. `P2P_SIGNAL_ANSWER`: `{ transferId, sdp }`
  6. `P2P_SIGNAL_ICE`: `{ transferId, candidate }`
  7. `FILE_CHUNK`: Transferred over WebRTC `RTCDataChannel` (binary)
  8. `FILE_TRANSFER_COMPLETE`: `{ transferId, receivedSha256 }`
- **Backpressure Handling**:
  ```javascript
  const BUFFER_THRESHOLD = 4 * 1024 * 1024; // 4MB
  dataChannel.bufferedAmountLowThreshold = 1 * 1024 * 1024; // 1MB
  if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
    await new Promise(resolve => {
      dataChannel.onbufferedamountlow = () => resolve();
    });
  }
  ```

### 4.3 Retention & Admin Safety Rules
- **View Once Media**:
  - `is_view_once = true`
  - When recipient views media: client sends update setting `viewed_at = NOW()`.
  - Storage files and DB records are **never deleted**. The client UI simply renders `Opened` status and restricts re-opening.
- **Delete for Everyone**:
  - Sets `deleted_for_everyone = true`, `deleted_at = NOW()`, `deleted_by = auth.uid()`.
  - Client UI displays *"This message was deleted"*, while the original `content`, `media_url`, and audit columns are preserved in the DB for admin review.
- **Sticker Pack Governance**:
  - All users can create packs and upload stickers.
  - Admin (`users.role = 'admin'`) can delete any sticker pack or individual sticker globally.
