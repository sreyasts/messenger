-- Supabase Migration: 20261125000000_rls_view_once_calls_fix.sql
-- Fixes RLS bugs on messages (View Once viewed_at), conversations, conversation_participants,
-- calls, p2p_transfers, and storage.objects while enforcing permanent audit retention.

-- ============================================================================
-- 1. SCHEMA HARDENING, AUDIT COLUMNS & PERFORMANCE INDEXES
-- ============================================================================

-- Track conversation creator so INSERT ... RETURNING works cleanly with SELECT RLS
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON public.conversations(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_created_by
    ON public.conversations(created_by);

-- Partial indexes for View Once, replies, and moderation audit queries
CREATE INDEX IF NOT EXISTS idx_messages_view_once_unopened
    ON public.messages(conversation_id, created_at DESC)
    WHERE is_view_once = TRUE AND viewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
    ON public.messages(reply_to_id)
    WHERE reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_audit_deleted
    ON public.messages(conversation_id, deleted_at DESC)
    WHERE deleted_for_everyone = TRUE;

-- Call signaling & P2P indexes
CREATE INDEX IF NOT EXISTS idx_calls_status_started
    ON public.calls(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_room_name
    ON public.calls(room_name);

CREATE INDEX IF NOT EXISTS idx_p2p_sender_status
    ON public.p2p_transfers(sender_id, status);

-- Integrity constraints on calls & p2p_transfers (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'calls_call_type_check'
    ) THEN
        ALTER TABLE public.calls
            ADD CONSTRAINT calls_call_type_check
            CHECK (call_type IN ('audio', 'video'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'calls_status_check'
    ) THEN
        ALTER TABLE public.calls
            ADD CONSTRAINT calls_status_check
            CHECK (status IN ('ringing', 'ongoing', 'ended', 'declined', 'missed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'p2p_transfers_status_check'
    ) THEN
        ALTER TABLE public.p2p_transfers
            ADD CONSTRAINT p2p_transfers_status_check
            CHECK (status IN ('pending', 'transferring', 'completed', 'failed', 'cancelled'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'p2p_transfers_max_size_check'
    ) THEN
        ALTER TABLE public.p2p_transfers
            ADD CONSTRAINT p2p_transfers_max_size_check
            CHECK (file_size > 0 AND file_size <= 1073741824);
    END IF;
END $$;

-- ============================================================================
-- 2. UPDATED_AT TRIGGERS & HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_users_updated_at ON public.users;
CREATE TRIGGER tr_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS tr_conversations_updated_at ON public.conversations;
CREATE TRIGGER tr_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Helper allowing conversation creators or existing participants to add participants cleanly
CREATE OR REPLACE FUNCTION public.can_add_conversation_participant(conv_id UUID, caller_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    IF caller_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN (
        public.is_admin() OR
        public.is_conversation_participant(conv_id, caller_id) OR
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conv_id AND c.created_by = caller_id
        ) OR
        NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = conv_id
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Permanent audit & View-Once immutability trigger on public.messages
-- Prevents modifying/clearing content, media_url, file_name, file_size, or resetting viewed_at
CREATE OR REPLACE FUNCTION public.enforce_message_audit_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    -- Core payload and sender metadata are permanently immutable
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
        OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
        OR NEW.content IS DISTINCT FROM OLD.content
        OR NEW.media_url IS DISTINCT FROM OLD.media_url
        OR NEW.media_type IS DISTINCT FROM OLD.media_type
        OR NEW.file_name IS DISTINCT FROM OLD.file_name
        OR NEW.file_size IS DISTINCT FROM OLD.file_size
        OR NEW.is_view_once IS DISTINCT FROM OLD.is_view_once
        OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Message content, media_url, and core metadata cannot be modified';
    END IF;

    -- View-Once viewed_at rules: recipient or participant can stamp once; never clear
    IF NEW.viewed_at IS DISTINCT FROM OLD.viewed_at THEN
        IF OLD.is_view_once IS NOT TRUE THEN
            RAISE EXCEPTION 'Only View Once messages support viewed_at';
        END IF;
        IF NEW.viewed_at IS NULL THEN
            RAISE EXCEPTION 'View Once viewed_at timestamp cannot be cleared';
        END IF;
        -- Preserve initial timestamp idempotently under concurrent opens
        IF OLD.viewed_at IS NOT NULL THEN
            NEW.viewed_at := OLD.viewed_at;
        END IF;
    END IF;

    -- Delete for Everyone soft-flag rules: sender only, cannot un-delete
    IF NEW.deleted_for_everyone IS DISTINCT FROM OLD.deleted_for_everyone
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
        OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
        IF OLD.sender_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Only the message sender or an admin can delete for everyone';
        END IF;
        IF OLD.deleted_for_everyone IS TRUE AND NEW.deleted_for_everyone IS NOT TRUE THEN
            RAISE EXCEPTION 'Deleted messages cannot be restored';
        END IF;
        IF NEW.deleted_for_everyone IS TRUE THEN
            NEW.deleted_at := COALESCE(OLD.deleted_at, NEW.deleted_at, NOW());
            NEW.deleted_by := COALESCE(OLD.deleted_by, auth.uid());
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_enforce_message_audit_immutability ON public.messages;
CREATE TRIGGER tr_enforce_message_audit_immutability
    BEFORE UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.enforce_message_audit_immutability();

-- ============================================================================
-- 3. FIXED ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- USERS
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
CREATE POLICY "Users can insert their own profile"
    ON public.users FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id AND role = 'user' AND is_banned = FALSE);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
CREATE POLICY "Users can update their own profile"
    ON public.users FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id AND
        role IS NOT DISTINCT FROM (SELECT u.role FROM public.users u WHERE u.id = auth.uid()) AND
        is_banned IS NOT DISTINCT FROM (SELECT u.is_banned FROM public.users u WHERE u.id = auth.uid())
    );

-- CONVERSATIONS
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON public.conversations;
CREATE POLICY "Users can view conversations they participate in"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (
        public.is_conversation_participant(id, auth.uid()) OR
        created_by = auth.uid() OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL AND
        (created_by IS NULL OR created_by = auth.uid())
    );

DROP POLICY IF EXISTS "Participants can update conversation details" ON public.conversations;
CREATE POLICY "Participants can update conversation details"
    ON public.conversations FOR UPDATE
    TO authenticated
    USING (public.is_conversation_participant(id, auth.uid()) OR public.is_admin())
    WITH CHECK (public.is_conversation_participant(id, auth.uid()) OR public.is_admin());

-- CONVERSATION PARTICIPANTS
DROP POLICY IF EXISTS "Users can insert participants when creating conversations" ON public.conversation_participants;
CREATE POLICY "Users can insert participants when creating conversations"
    ON public.conversation_participants FOR INSERT
    TO authenticated
    WITH CHECK (public.can_add_conversation_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can update their own last_read_at" ON public.conversation_participants;
CREATE POLICY "Users can update their own last_read_at"
    ON public.conversation_participants FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- MESSAGES (Fix multi-row subquery bug in previous UPDATE policy)
DROP POLICY IF EXISTS "Message sender can update message (e.g. delete for everyone soft-flag)" ON public.messages;
DROP POLICY IF EXISTS "Participants can mark view-once messages as viewed" ON public.messages;
DROP POLICY IF EXISTS "Sender or admin can update own messages for soft-delete" ON public.messages;

CREATE POLICY "Participants can mark view-once messages as viewed"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (
        is_view_once = TRUE AND
        public.is_conversation_participant(conversation_id, auth.uid())
    )
    WITH CHECK (
        is_view_once = TRUE AND
        viewed_at IS NOT NULL AND
        public.is_conversation_participant(conversation_id, auth.uid())
    );

CREATE POLICY "Sender or admin can update own messages for soft-delete"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (sender_id = auth.uid() OR public.is_admin())
    WITH CHECK (sender_id = auth.uid() OR public.is_admin());

-- CALLS
DROP POLICY IF EXISTS "Users can view calls in their conversations" ON public.calls;
CREATE POLICY "Users can view calls in their conversations"
    ON public.calls FOR SELECT
    TO authenticated
    USING (
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Users can insert calls" ON public.calls;
CREATE POLICY "Users can insert calls"
    ON public.calls FOR INSERT
    TO authenticated
    WITH CHECK (
        caller_id = auth.uid() AND
        public.is_conversation_participant(conversation_id, auth.uid())
    );

DROP POLICY IF EXISTS "Call participants can update call state" ON public.calls;
CREATE POLICY "Call participants can update call state"
    ON public.calls FOR UPDATE
    TO authenticated
    USING (
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        public.is_admin()
    )
    WITH CHECK (
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Only admin can delete calls" ON public.calls;
CREATE POLICY "Only admin can delete calls"
    ON public.calls FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- P2P TRANSFERS
DROP POLICY IF EXISTS "Users can view P2P transfers they are part of" ON public.p2p_transfers;
CREATE POLICY "Users can view P2P transfers they are part of"
    ON public.p2p_transfers FOR SELECT
    TO authenticated
    USING (
        sender_id = auth.uid() OR
        receiver_id = auth.uid() OR
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Users can insert P2P transfers as sender" ON public.p2p_transfers;
CREATE POLICY "Users can insert P2P transfers as sender"
    ON public.p2p_transfers FOR INSERT
    TO authenticated
    WITH CHECK (
        sender_id = auth.uid() AND
        public.is_conversation_participant(conversation_id, auth.uid())
    );

DROP POLICY IF EXISTS "Sender or receiver can update P2P transfer status" ON public.p2p_transfers;
CREATE POLICY "Sender or receiver can update P2P transfer status"
    ON public.p2p_transfers FOR UPDATE
    TO authenticated
    USING (
        sender_id = auth.uid() OR
        receiver_id = auth.uid() OR
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        public.is_admin()
    )
    WITH CHECK (
        sender_id = auth.uid() OR
        receiver_id = auth.uid() OR
        public.is_conversation_participant(conversation_id, auth.uid()) OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Only admin can delete P2P transfers" ON public.p2p_transfers;
CREATE POLICY "Only admin can delete P2P transfers"
    ON public.p2p_transfers FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- ============================================================================
-- 4. STORAGE BUCKETS & RETENTION-SAFE STORAGE POLICIES
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('chat-attachments', 'chat-attachments', true, 52428800, NULL),
    ('avatars', 'avatars', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    ('stickers', 'stickers', true, 5242880, ARRAY['image/png', 'image/webp', 'image/gif']),
    ('wallpapers', 'wallpapers', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone can view chat attachments" ON storage.objects;
CREATE POLICY "Anyone can view chat attachments"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id IN ('chat-attachments', 'avatars', 'stickers', 'wallpapers'));

DROP POLICY IF EXISTS "Authenticated users can upload chat attachments <= 50MB" ON storage.objects;
CREATE POLICY "Authenticated users can upload chat attachments <= 50MB"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id IN ('chat-attachments', 'avatars', 'stickers', 'wallpapers') AND
        (owner IS NULL OR owner = auth.uid())
    );

DROP POLICY IF EXISTS "Users can update their own uploads" ON storage.objects;
CREATE POLICY "Users can update their own uploads"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = owner AND
        bucket_id IN ('avatars', 'stickers', 'wallpapers')
    )
    WITH CHECK (
        auth.uid() = owner AND
        bucket_id IN ('avatars', 'stickers', 'wallpapers')
    );

DROP POLICY IF EXISTS "Admin or owners can delete non-retention storage objects" ON storage.objects;
CREATE POLICY "Admin or owners can delete non-retention storage objects"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        (auth.uid() = owner AND bucket_id IN ('avatars', 'stickers', 'wallpapers')) OR
        public.is_admin()
    );

-- ============================================================================
-- 5. REALTIME REPLICA IDENTITY & PUBLICATION GUARANTEE
-- ============================================================================

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.reactions REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;
ALTER TABLE public.p2p_transfers REPLICA IDENTITY FULL;
ALTER TABLE public.calls REPLICA IDENTITY FULL;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'public.messages',
        'public.reactions',
        'public.conversations',
        'public.conversation_participants',
        'public.p2p_transfers',
        'public.calls'
    ]
    LOOP
        BEGIN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s;', tbl);
        EXCEPTION
            WHEN duplicate_object THEN NULL;
            WHEN undefined_object THEN NULL;
        END;
    END LOOP;
END $$;
