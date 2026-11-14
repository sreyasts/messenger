-- Supabase Migration: 20261114000000_init_schema.sql
-- Production-Ready Schema for $0-Cost Private Messenger App

-- Enable extensions
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

-- Index for searching users by display name or email
CREATE INDEX IF NOT EXISTS idx_users_display_name ON public.users(display_name);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

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

CREATE INDEX IF NOT EXISTS idx_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conv ON public.conversation_participants(conversation_id);

-- 4. MESSAGES TABLE (With Permanent DB Retention for View Once and Deleted Messages)
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

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);

-- 5. REACTIONS TABLE
CREATE TABLE IF NOT EXISTS public.reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON public.reactions(message_id);

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

CREATE INDEX IF NOT EXISTS idx_stickers_pack ON public.stickers(pack_id);

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

CREATE INDEX IF NOT EXISTS idx_p2p_conversation ON public.p2p_transfers(conversation_id);
CREATE INDEX IF NOT EXISTS idx_p2p_receiver ON public.p2p_transfers(receiver_id, status);

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

CREATE INDEX IF NOT EXISTS idx_calls_conversation ON public.calls(conversation_id, started_at DESC);

-- 9. USER SIGNUP TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, display_name, avatar_url, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email, 'friend'), '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
        'user'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = CASE WHEN public.users.display_name = '' THEN EXCLUDED.display_name ELSE public.users.display_name END,
        avatar_url = CASE WHEN public.users.avatar_url = '' THEN EXCLUDED.avatar_url ELSE public.users.avatar_url END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to update conversation's updated_at timestamp when a new message is inserted
CREATE OR REPLACE FUNCTION public.handle_new_message_touch_conversation()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET updated_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_message_inserted_touch_conversation ON public.messages;
CREATE TRIGGER on_message_inserted_touch_conversation
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_message_touch_conversation();

-- 10. ROW LEVEL SECURITY (RLS) POLICIES

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Helper to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Helper to check conversation participation without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id UUID, usr_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.conversation_participants
        WHERE conversation_id = conv_id AND user_id = usr_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Trigger to prevent non-admins from mutating role or is_banned
CREATE OR REPLACE FUNCTION public.protect_user_roles()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_banned IS DISTINCT FROM OLD.is_banned) AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Non-admin users cannot modify role or is_banned status';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_protect_user_roles ON public.users;
CREATE TRIGGER tr_protect_user_roles
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.protect_user_roles();

-- USERS POLICIES
CREATE POLICY "Users can view all registered users"
    ON public.users FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "Users can update their own profile"
    ON public.users FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id AND
        role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid()) AND
        is_banned = (SELECT u.is_banned FROM public.users u WHERE u.id = auth.uid())
    );

CREATE POLICY "Admin can update any user (e.g., ban, role change)"
    ON public.users FOR UPDATE
    TO authenticated
    USING (public.is_admin());

-- CONVERSATIONS POLICIES
CREATE POLICY "Users can view conversations they participate in"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.conversations.id AND user_id = auth.uid()
        ) OR public.is_admin()
    );

CREATE POLICY "Users can create conversations"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (TRUE);

CREATE POLICY "Participants can update conversation details"
    ON public.conversations FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.conversations.id AND user_id = auth.uid()
        ) OR public.is_admin()
    );

-- CONVERSATION PARTICIPANTS POLICIES
CREATE POLICY "Users can view participants of their conversations"
    ON public.conversation_participants FOR SELECT
    TO authenticated
    USING (
        public.is_conversation_participant(conversation_id, auth.uid()) OR public.is_admin()
    );

CREATE POLICY "Users can insert participants when creating conversations"
    ON public.conversation_participants FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        NOT EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.conversation_participants.conversation_id
        ) OR
        public.is_admin()
    );

CREATE POLICY "Users can update their own last_read_at"
    ON public.conversation_participants FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid());

-- MESSAGES POLICIES
CREATE POLICY "Users can view messages in conversations they belong to"
    ON public.messages FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.messages.conversation_id AND user_id = auth.uid()
        ) OR public.is_admin()
    );

CREATE POLICY "Participants can insert messages"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (
        sender_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.messages.conversation_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Message sender can update message (e.g. delete for everyone soft-flag)"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (
        (sender_id = auth.uid()) OR
        -- Recipient can mark view-once as opened
        (is_view_once = TRUE AND public.is_conversation_participant(conversation_id, auth.uid())) OR
        public.is_admin()
    )
    WITH CHECK (
        -- Content, media URL, and sender cannot be modified or cleared (permanent audit retention)
        content = (SELECT m.content FROM public.messages m WHERE m.id = id) AND
        media_url = (SELECT m.media_url FROM public.messages m WHERE m.id = id) AND
        sender_id = (SELECT m.sender_id FROM public.messages m WHERE m.id = id)
    );

-- Permanent retention rule: Hard deletes are blocked from ordinary users to allow safety inspection
CREATE POLICY "Only admin can hard delete messages"
    ON public.messages FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- REACTIONS POLICIES
CREATE POLICY "Users can view reactions in their conversations"
    ON public.reactions FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
            WHERE m.id = public.reactions.message_id AND cp.user_id = auth.uid()
        ) OR public.is_admin()
    );

CREATE POLICY "Users can insert their own reactions"
    ON public.reactions FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id AND public.is_conversation_participant(m.conversation_id, auth.uid())
        )
    );

CREATE POLICY "Users can remove their own reactions"
    ON public.reactions FOR DELETE
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

-- STICKER PACKS & STICKERS POLICIES
CREATE POLICY "All authenticated users can view sticker packs"
    ON public.sticker_packs FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "All authenticated users can create sticker packs"
    ON public.sticker_packs FOR INSERT
    TO authenticated
    WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creator or Admin can delete sticker packs"
    ON public.sticker_packs FOR DELETE
    TO authenticated
    USING (creator_id = auth.uid() OR public.is_admin());

CREATE POLICY "All authenticated users can view stickers"
    ON public.stickers FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "All authenticated users can insert stickers"
    ON public.stickers FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sticker_packs
            WHERE id = public.stickers.pack_id AND (creator_id = auth.uid() OR public.is_admin())
        )
    );

CREATE POLICY "Creator or Admin can delete stickers"
    ON public.stickers FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.sticker_packs
            WHERE id = public.stickers.pack_id AND (creator_id = auth.uid() OR public.is_admin())
        )
    );

-- P2P TRANSFERS POLICIES
CREATE POLICY "Users can view P2P transfers they are part of"
    ON public.p2p_transfers FOR SELECT
    TO authenticated
    USING (sender_id = auth.uid() OR receiver_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can insert P2P transfers as sender"
    ON public.p2p_transfers FOR INSERT
    TO authenticated
    WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Sender or receiver can update P2P transfer status"
    ON public.p2p_transfers FOR UPDATE
    TO authenticated
    USING (sender_id = auth.uid() OR receiver_id = auth.uid());

-- CALLS POLICIES
CREATE POLICY "Users can view calls in their conversations"
    ON public.calls FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.calls.conversation_id AND user_id = auth.uid()
        ) OR public.is_admin()
    );

CREATE POLICY "Users can insert calls"
    ON public.calls FOR INSERT
    TO authenticated
    WITH CHECK (
        caller_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.calls.conversation_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Call participants can update call state"
    ON public.calls FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = public.calls.conversation_id AND user_id = auth.uid()
        ) OR public.is_admin()
    );

-- 11. STORAGE BUCKETS CONFIGURATION (Sql script setup)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('chat-attachments', 'chat-attachments', true, 52428800, NULL), -- 50MB limit
    ('avatars', 'avatars', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    ('stickers', 'stickers', true, 5242880, ARRAY['image/png', 'image/webp', 'image/gif']),
    ('wallpapers', 'wallpapers', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS Policies
CREATE POLICY "Anyone can view chat attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id IN ('chat-attachments', 'avatars', 'stickers', 'wallpapers'));

CREATE POLICY "Authenticated users can upload chat attachments <= 50MB"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id IN ('chat-attachments', 'avatars', 'stickers', 'wallpapers'));

CREATE POLICY "Users can update their own uploads"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner AND bucket_id NOT IN ('chat-attachments'));

CREATE POLICY "Admin or owners can delete non-retention storage objects"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        (auth.uid() = owner AND bucket_id NOT IN ('chat-attachments')) OR
        public.is_admin()
    );

-- Enable Supabase Realtime publication on tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
