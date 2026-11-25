// apps/web/src/types/database.ts

export type ThemeAccent = 'violet-pink' | 'ocean-blue' | 'emerald' | 'crimson' | 'monochrome';

export interface User {
  id: string;
  email: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  theme_accent: ThemeAccent;
  chat_background_url: string;
  role: 'user' | 'admin';
  is_banned: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title?: string | null;
  avatar_url?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  participants?: ConversationParticipant[];
  last_message?: Message | null;
  unread_count?: number;
  other_user?: User;
}

export interface ConversationParticipant {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  joined_at: string;
  user?: User;
}

export type MediaType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'gif';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  media_url?: string;
  media_type: MediaType;
  file_name?: string;
  file_size?: number;
  is_view_once: boolean;
  viewed_at?: string | null;
  reply_to_id?: string | null;
  reply_to?: Message | null;
  deleted_for_everyone: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
  sender?: User;
  reactions?: Reaction[];
}

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user?: User;
}

export interface StickerPack {
  id: string;
  name: string;
  creator_id: string;
  created_at: string;
  creator?: User;
  stickers?: Sticker[];
}

export interface Sticker {
  id: string;
  pack_id: string;
  image_url: string;
  created_at: string;
}

export type P2PTransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';

export interface P2PTransfer {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  file_hash_sha256: string;
  status: P2PTransferStatus;
  created_at: string;
  sender?: User;
  receiver?: User;
}

export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'ongoing' | 'ended' | 'declined' | 'missed';

export interface Call {
  id: string;
  conversation_id: string;
  caller_id: string;
  call_type: CallType;
  room_name: string;
  status: CallStatus;
  started_at: string;
  ended_at?: string | null;
  caller?: User;
}
