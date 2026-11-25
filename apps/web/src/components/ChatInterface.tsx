'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Conversation, User, Message, MediaType, Reaction } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import {
  uploadToSupabaseBucket,
  downloadFileUrl,
  formatFileSize,
  MAX_P2P_FILE_BYTES,
  resolveMediaType,
  inferMimeType,
} from '@/lib/supabase/storage';
import MessageBubble from '@/components/MessageBubble';
import MessageComposer, { OutgoingMessagePayload } from '@/components/MessageComposer';
import ContextMenu from '@/components/ContextMenu';
import ViewOnceModal from '@/components/ViewOnceModal';
import MediaPickerModal, { MediaPickerTab } from '@/components/MediaPickerModal';
import P2PTransferModal from '@/components/P2PTransferModal';
import {
  P2PFileSender,
  P2PFileReceiver,
  P2PTransferMetadata,
  TransferProgress,
  calculateFileSha256,
} from '@/lib/webrtc/p2pTransfer';
import {
  ArrowLeft,
  Phone,
  Video,
  Search,
  ChevronDown,
  X,
  Download,
  AlertCircle,
} from 'lucide-react';

interface ChatInterfaceProps {
  conversation: Conversation;
  currentUser: User;
  onBack: () => void;
  onStartCall: (type: 'audio' | 'video') => void;
  onMessageActivity?: (conversationId: string, lastMessage: Message) => void;
}

function formatDateDivider(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round(
      (startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Today';
  }
}

function sameCalendarDay(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export default function ChatInterface({
  conversation,
  currentUser,
  onBack,
  onStartCall,
  onMessageActivity,
}: ChatInterfaceProps) {
  const { wallpaper, config } = useTheme();

  // Message & UI State
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    message: Message;
    position: { x: number; y: number };
  } | null>(null);
  const [viewOnceMedia, setViewOnceMedia] = useState<Message | null>(null);
  const [lightboxImage, setLightboxImage] = useState<Message | null>(null);
  const [mediaPickerState, setMediaPickerState] = useState<{
    isOpen: boolean;
    initialTab: MediaPickerTab;
    reactionTargetMessageId: string | null;
  }>({
    isOpen: false,
    initialTab: 'emoji',
    reactionTargetMessageId: null,
  });

  // Search within chat
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');

  // Upload & Error feedback
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [chatBannerError, setChatBannerError] = useState<string | null>(null);

  // Presence & Typing
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [isPeerOnline, setIsPeerOnline] = useState(!isLiveSupabaseConfigured());

  // Scroll-to-bottom tracking
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);

  // Active P2P transfer HUD state
  const [activeP2P, setActiveP2P] = useState<{
    isOpen: boolean;
    fileName: string;
    fileSize: number;
    metadata: P2PTransferMetadata | null;
    progress: TransferProgress | null;
    isSender: boolean;
    isIncomingRequest?: boolean;
    pendingOffer?: RTCSessionDescriptionInit | null;
    completedBlob?: Blob | null;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMsgCountRef = useRef(0);

  // Realtime & WebRTC P2P refs
  const presenceChannelRef = useRef<any>(null);
  const p2pChannelRef = useRef<any>(null);
  const p2pSenderRef = useRef<P2PFileSender | null>(null);
  const p2pReceiverRef = useRef<P2PFileReceiver | null>(null);
  const activeTransferIdRef = useRef<string | null>(null);
  const peerTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reconcile viewed_at with localStorage & ensure media_url/content are wiped once opened
  const reconcileViewOnce = useCallback((msgList: Message[]): Message[] => {
    let cachedIds: string[] = [];
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('viewed_view_once_ids');
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) cachedIds = parsed;
      } catch {}
    }

    return msgList.map((msg) => {
      if (msg.is_view_once) {
        const isLocallyViewed =
          !!msg.viewed_at ||
          cachedIds.includes(msg.id) ||
          (typeof window !== 'undefined' && !!localStorage.getItem(`view_once_opened_${msg.id}`));
        if (isLocallyViewed) {
          const savedTime =
            msg.viewed_at ||
            (typeof window !== 'undefined' && localStorage.getItem(`view_once_opened_${msg.id}`)) ||
            new Date().toISOString();
          return { ...msg, viewed_at: savedTime, media_url: '', content: '' };
        }
      }
      return msg;
    });
  }, []);

  const persistMessagesCache = useCallback(
    (list: Message[]) => {
      if (typeof window === 'undefined') return;
      try {
        localStorage.setItem(`messenger_chat_msgs_${conversation.id}`, JSON.stringify(list));
      } catch {}
    },
    [conversation.id]
  );

  // Mark conversation as read in Supabase
  const markConversationRead = useCallback(async () => {
    if (!isLiveSupabaseConfigured()) return;
    try {
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversation.id)
        .eq('user_id', currentUser.id);
    } catch {}
  }, [conversation.id, currentUser.id]);

  // Mark View Once photo as viewed (updates viewed_at in DB, keeps row & storage intact)
  const handleMarkViewOnceViewed = useCallback(
    async (msgId: string) => {
      const timestamp = new Date().toISOString();

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === msgId ? { ...m, viewed_at: timestamp, media_url: '', content: '' } : m
        );
        persistMessagesCache(updated);
        return updated;
      });

      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('viewed_view_once_ids');
          const viewedIds = raw ? JSON.parse(raw) : [];
          const safeIds = Array.isArray(viewedIds) ? viewedIds : [];
          if (!safeIds.includes(msgId)) {
            safeIds.push(msgId);
            localStorage.setItem('viewed_view_once_ids', JSON.stringify(safeIds));
          }
          localStorage.setItem(`view_once_opened_${msgId}`, timestamp);
        } catch (e) {
          console.warn('Could not persist viewed view-once to localStorage', e);
        }
      }

      if (isLiveSupabaseConfigured()) {
        try {
          const { error } = await supabase
            .from('messages')
            .update({ viewed_at: timestamp })
            .eq('id', msgId);
          if (error) {
            console.error('Failed to update viewed_at in Supabase:', error.message);
          }
        } catch (err) {
          console.error('Failed to update viewed_at in Supabase:', err);
        }
      }
    },
    [persistMessagesCache]
  );

  // Sync P2P transfer status to Supabase table
  const syncP2PTransferStatus = useCallback(
    async (transferId: string, status: TransferProgress['status']) => {
      if (!isLiveSupabaseConfigured()) return;
      const dbStatus = status === 'connecting' || status === 'paused' ? 'transferring' : status;
      try {
        await supabase
          .from('p2p_transfers')
          .update({ status: dbStatus })
          .eq('id', transferId);
      } catch {}
    },
    []
  );

  // Initialize messages + Realtime subscriptions (messages, reactions, presence/typing, P2P signaling)
  useEffect(() => {
    setReplyingTo(null);
    setChatBannerError(null);
    setIsSearchOpen(false);
    setChatSearchQuery('');
    setIsScrolledUp(false);
    setUnreadWhileScrolled(0);
    setIsPeerTyping(false);
    isNearBottomRef.current = true;
    prevMsgCountRef.current = 0;

    // 1. Load local cache or demo messages immediately
    let localList: Message[] | null = null;
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`messenger_chat_msgs_${conversation.id}`);
        if (saved) localList = JSON.parse(saved) as Message[];
      } catch {}
    }

    if (localList && localList.length > 0) {
      const reconciled = reconcileViewOnce(localList);
      prevMsgCountRef.current = reconciled.length;
      setMessages(reconciled);
    } else if (!isLiveSupabaseConfigured()) {
      const initialList: Message[] = [
        {
          id: `msg-${conversation.id}-1`,
          conversation_id: conversation.id,
          sender_id: conversation.other_user?.id || 'other-id',
          content:
            'Hey! Welcome to our $0-cost private messenger. Everything is encrypted, zero tracking, and real-time.',
          media_type: 'text',
          is_view_once: false,
          deleted_for_everyone: false,
          created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
          sender: conversation.other_user,
        },
        {
          id: `msg-${conversation.id}-2`,
          conversation_id: conversation.id,
          sender_id: currentUser.id,
          content: 'Awesome! Ready to test 1 GB WebRTC transfers & View Once photos 🚀',
          media_type: 'text',
          is_view_once: false,
          deleted_for_everyone: false,
          created_at: new Date(Date.now() - 3600000).toISOString(),
          sender: currentUser,
        },
      ];
      if (conversation.last_message) {
        initialList.push(conversation.last_message);
      }
      const reconciled = reconcileViewOnce(initialList);
      prevMsgCountRef.current = reconciled.length;
      setMessages(reconciled);
      persistMessagesCache(reconciled);
    } else {
      setMessages([]);
    }

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 60);

    if (!isLiveSupabaseConfigured()) {
      setIsPeerOnline(true);
      return;
    }

    let isActive = true;
    markConversationRead();

    // 2. Fetch authoritative messages from Supabase
    (async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*, sender:users(*), reactions(*)')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (!isActive) return;
      if (error) {
        setChatBannerError(`Could not load message history: ${error.message}`);
        return;
      }
      if (data) {
        const reconciled = reconcileViewOnce(data as Message[]);
        prevMsgCountRef.current = reconciled.length;
        setMessages(reconciled);
        persistMessagesCache(reconciled);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 50);
      }
    })();

    // 3. Messages + Reactions Realtime Channel
    const msgChannel = supabase
      .channel(`chat:interface:${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload: any) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const reconciled = reconcileViewOnce([newMsg])[0];
            if (!reconciled.sender && reconciled.sender_id !== currentUser.id) {
              reconciled.sender = conversation.other_user;
            }
            const nextList = [...prev, reconciled];
            persistMessagesCache(nextList);
            return nextList;
          });
          if (newMsg.sender_id !== currentUser.id) {
            markConversationRead();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload: any) => {
          const updatedMsg = payload.new as Message;
          setMessages((prev) => {
            const reconciled = reconcileViewOnce([updatedMsg])[0];
            const nextList = prev.map((m) =>
              m.id === updatedMsg.id ? { ...m, ...reconciled, sender: m.sender, reactions: m.reactions } : m
            );
            persistMessagesCache(nextList);
            return nextList;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reactions' },
        (payload: any) => {
          const rx = payload.new as Reaction;
          setMessages((prev) => {
            const targetExists = prev.some((m) => m.id === rx.message_id);
            if (!targetExists) return prev;
            const nextList = prev.map((m) => {
              if (m.id !== rx.message_id) return m;
              const currentRx = m.reactions || [];
              if (
                currentRx.some(
                  (r) => r.id === rx.id || (r.user_id === rx.user_id && r.emoji === rx.emoji)
                )
              ) {
                return m;
              }
              return { ...m, reactions: [...currentRx, rx] };
            });
            persistMessagesCache(nextList);
            return nextList;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'reactions' },
        (payload: any) => {
          const oldRx = payload.old as Partial<Reaction>;
          if (!oldRx?.id) return;
          setMessages((prev) => {
            const nextList = prev.map((m) => {
              if (!m.reactions?.some((r) => r.id === oldRx.id)) return m;
              return { ...m, reactions: m.reactions.filter((r) => r.id !== oldRx.id) };
            });
            persistMessagesCache(nextList);
            return nextList;
          });
        }
      )
      .subscribe();

    // 4. Typing & Online Presence Channel
    const presenceChannel = supabase
      .channel(`chat:presence:${conversation.id}`, {
        config: { presence: { key: currentUser.id } },
      })
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const onlineKeys = Object.keys(state).filter((k) => k !== currentUser.id);
        setIsPeerOnline(onlineKeys.length > 0);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        if (!payload || payload.userId === currentUser.id) return;
        setIsPeerTyping(!!payload.isTyping);
        if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
        if (payload.isTyping) {
          peerTypingTimeoutRef.current = setTimeout(() => {
            setIsPeerTyping(false);
          }, 3500);
        }
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          try {
            await presenceChannel.track({
              user_id: currentUser.id,
              online_at: new Date().toISOString(),
            });
          } catch {}
        }
      });
    presenceChannelRef.current = presenceChannel;

    // 5. WebRTC P2P Signaling Broadcast Channel (chat:p2p:<conversation_id>)
    const p2pChannel = supabase
      .channel(`chat:p2p:${conversation.id}`)
      .on('broadcast', { event: 'p2p_signal' }, async ({ payload }: any) => {
        if (!payload || payload.senderUserId === currentUser.id) return;

        const transferId = payload.transferId as string;
        const signalType = payload.type as string;

        if (signalType === 'p2p_offer' || signalType === 'P2P_SIGNAL_OFFER') {
          const meta = payload.metadata as P2PTransferMetadata;
          if (!meta) return;
          activeTransferIdRef.current = transferId;

          // Clear any stale sender or previous receiver so ICE candidates route strictly to this receiver
          p2pSenderRef.current?.close();
          p2pSenderRef.current = null;
          p2pReceiverRef.current?.close();
          p2pReceiverRef.current = null;

          const receiver = new P2PFileReceiver(
            (sig) => {
              p2pChannel.send({
                type: 'broadcast',
                event: 'p2p_signal',
                payload: { ...sig, senderUserId: currentUser.id },
              });
            },
            (prog) => {
              setActiveP2P((prev) => (prev ? { ...prev, progress: prog } : null));
              if (prog.status === 'completed' || prog.status === 'failed' || prog.status === 'cancelled') {
                syncP2PTransferStatus(transferId, prog.status);
                if (prog.status !== 'completed') {
                  p2pReceiverRef.current = null;
                }
              }
            },
            (blob, completedMeta) => {
              setActiveP2P((prev) =>
                prev ? { ...prev, completedBlob: blob, metadata: completedMeta } : null
              );
            }
          );

          p2pReceiverRef.current = receiver;

          setActiveP2P({
            isOpen: true,
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            metadata: meta,
            progress: {
              transferId,
              bytesTransferred: 0,
              totalBytes: meta.fileSize,
              percentage: 0,
              speedBytesPerSec: 0,
              status: 'connecting',
            },
            isSender: false,
            isIncomingRequest: true,
            pendingOffer: payload.sdp,
          });
        } else if (signalType === 'p2p_answer' || signalType === 'P2P_SIGNAL_ANSWER') {
          if (p2pSenderRef.current && transferId === activeTransferIdRef.current) {
            await p2pSenderRef.current.handleAnswer(payload.sdp);
          }
        } else if (signalType === 'p2p_ice' || signalType === 'P2P_SIGNAL_ICE') {
          if (transferId !== activeTransferIdRef.current) return;
          if (p2pSenderRef.current) {
            await p2pSenderRef.current.handleIceCandidate(payload.candidate);
          } else if (p2pReceiverRef.current) {
            await p2pReceiverRef.current.handleIceCandidate(payload.candidate);
          }
        } else if (signalType === 'FILE_TRANSFER_REJECT') {
          if (p2pSenderRef.current && transferId === activeTransferIdRef.current) {
            p2pSenderRef.current.cancel();
            p2pSenderRef.current = null;
            setActiveP2P((prev) =>
              prev
                ? {
                    ...prev,
                    progress: {
                      ...(prev.progress || {
                        transferId,
                        bytesTransferred: 0,
                        totalBytes: prev.fileSize,
                        percentage: 0,
                        speedBytesPerSec: 0,
                      }),
                      status: 'failed',
                      errorMessage: payload.reason || 'Recipient declined the transfer.',
                    },
                  }
                : null
            );
          }
        }
      })
      .subscribe();
    p2pChannelRef.current = p2pChannel;

    return () => {
      isActive = false;
      if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      p2pSenderRef.current?.close();
      p2pSenderRef.current = null;
      p2pReceiverRef.current?.close();
      p2pReceiverRef.current = null;
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(presenceChannel);
      supabase.removeChannel(p2pChannel);
      presenceChannelRef.current = null;
      p2pChannelRef.current = null;
    };
  }, [
    conversation.id,
    conversation.other_user,
    conversation.last_message,
    currentUser,
    reconcileViewOnce,
    persistMessagesCache,
    markConversationRead,
    syncP2PTransferStatus,
  ]);

  // Smooth auto-scroll on new messages when near bottom, or increment unread badge
  useEffect(() => {
    const newCount = messages.length;
    if (newCount > prevMsgCountRef.current) {
      const added = newCount - prevMsgCountRef.current;
      const lastMsg = messages[newCount - 1];
      const isOwnLatest = lastMsg?.sender_id === currentUser.id;
      if (isNearBottomRef.current || isOwnLatest) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setUnreadWhileScrolled(0);
      } else {
        setUnreadWhileScrolled((prev) => prev + added);
      }
    }
    prevMsgCountRef.current = newCount;
  }, [messages, currentUser.id]);

  const handleScrollContainer = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 120;
    isNearBottomRef.current = nearBottom;
    setIsScrolledUp(!nearBottom);
    if (nearBottom) {
      setUnreadWhileScrolled(0);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadWhileScrolled(0);
    setIsScrolledUp(false);
  };

  const handleScrollToMessage = useCallback((messageId: string) => {
    const target = document.getElementById(`msg-${messageId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
    }, 1600);
  }, []);

  const handleTypingChange = useCallback(
    (typing: boolean) => {
      if (!presenceChannelRef.current || !isLiveSupabaseConfigured()) return;
      presenceChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: currentUser.id, isTyping: typing },
      });
    },
    [currentUser.id]
  );

  // Send Message (with real Supabase Storage upload for files/photos/audio/video <= 50 MB)
  const handleSendMessage = useCallback(
    async (payload: OutgoingMessagePayload) => {
      setIsSending(true);
      setChatBannerError(null);

      try {
        let resolvedMediaType: MediaType =
          payload.media_type || payload.mediaType || 'text';
        let resolvedMediaUrl = payload.media_url || payload.mediaUrl || '';
        let resolvedFileName = payload.file_name || payload.fileName || '';
        let resolvedFileSize = payload.file_size || payload.fileSize || 0;

        // Upload attached File/Blob to Supabase Storage (`chat-attachments`)
        if (payload.file) {
          const rawName =
            resolvedFileName ||
            (payload.file instanceof File ? payload.file.name : `attachment_${Date.now()}`);
          const mimeType = inferMimeType(
            rawName,
            payload.file instanceof File ? payload.file.type : undefined
          );
          if (resolvedMediaType === 'text') {
            resolvedMediaType = resolveMediaType(rawName, mimeType);
          }

          setUploadProgress(1);
          const uploaded = await uploadToSupabaseBucket('chat-attachments', payload.file, {
            folder: `${conversation.id}/${currentUser.id}`,
            fileName: rawName,
            mimeType,
            onProgress: (pct) => setUploadProgress(pct),
          });
          resolvedMediaUrl = uploaded.publicUrl;
          resolvedFileName = uploaded.fileName;
          resolvedFileSize = uploaded.fileSize;
        }

        // Strict business rule: View Once is ONLY allowed on Image/Photo messages
        const requestedViewOnce =
          payload.is_view_once !== undefined ? payload.is_view_once : !!payload.isViewOnce;
        const resolvedIsViewOnce = requestedViewOnce && resolvedMediaType === 'image';
        const resolvedReplyToId = payload.reply_to_id || payload.replyToId || null;

        const clientMsgId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const resolvedReplyObj =
          replyingTo ||
          (resolvedReplyToId ? messages.find((m) => m.id === resolvedReplyToId) || null : null);

        const newMessage: Message = {
          id: clientMsgId,
          conversation_id: conversation.id,
          sender_id: currentUser.id,
          content: resolvedIsViewOnce ? '' : payload.content,
          media_type: resolvedMediaType,
          media_url: resolvedMediaUrl,
          file_name: resolvedFileName,
          file_size: resolvedFileSize,
          is_view_once: resolvedIsViewOnce,
          viewed_at: null,
          reply_to_id: resolvedReplyToId,
          reply_to: resolvedReplyObj,
          deleted_for_everyone: false,
          created_at: new Date().toISOString(),
          sender: currentUser,
          reactions: [],
        };

        setMessages((prev) => {
          const nextList = [...prev, newMessage];
          persistMessagesCache(nextList);
          return nextList;
        });
        setReplyingTo(null);
        onMessageActivity?.(conversation.id, newMessage);

        if (isLiveSupabaseConfigured()) {
          const { error } = await supabase.from('messages').insert({
            id: clientMsgId,
            conversation_id: conversation.id,
            sender_id: currentUser.id,
            content: newMessage.content,
            media_type: resolvedMediaType,
            media_url: resolvedMediaUrl,
            file_name: resolvedFileName,
            file_size: resolvedFileSize,
            is_view_once: resolvedIsViewOnce,
            reply_to_id: resolvedReplyToId,
          });
          if (error) {
            throw new Error(error.message || 'Failed to save message to database');
          }
        }
      } catch (err: any) {
        console.error('Failed to send message:', err);
        setChatBannerError(err?.message || 'Failed to send message');
        throw err;
      } finally {
        setIsSending(false);
        setTimeout(() => setUploadProgress(null), 400);
      }
    },
    [conversation.id, currentUser, replyingTo, messages, persistMessagesCache, onMessageActivity]
  );

  // Real WebRTC 1 GB P2P File Transfer
  const handleStartP2PTransfer = useCallback(
    async (file: File) => {
      if (file.size > MAX_P2P_FILE_BYTES) {
        setChatBannerError(`"${file.name}" exceeds the 1 GB WebRTC P2P limit.`);
        return;
      }

      const transferId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `p2p-${Date.now()}`;
      const receiverId = conversation.other_user?.id || currentUser.id;
      activeTransferIdRef.current = transferId;

      setActiveP2P({
        isOpen: true,
        fileName: file.name,
        fileSize: file.size,
        metadata: {
          transferId,
          fileName: file.name,
          fileSize: file.size,
          fileType: inferMimeType(file.name, file.type),
          fileHashSha256: '',
          senderId: currentUser.id,
          receiverId,
          conversationId: conversation.id,
        },
        progress: {
          transferId,
          bytesTransferred: 0,
          totalBytes: file.size,
          percentage: 0,
          speedBytesPerSec: 0,
          status: 'connecting',
        },
        isSender: true,
      });

      const fileHashSha256 = await calculateFileSha256(file);
      const meta: P2PTransferMetadata = {
        transferId,
        fileName: file.name,
        fileSize: file.size,
        fileType: inferMimeType(file.name, file.type),
        fileHashSha256,
        senderId: currentUser.id,
        receiverId,
        conversationId: conversation.id,
      };

      setActiveP2P((prev) => (prev ? { ...prev, metadata: meta } : null));

      if (isLiveSupabaseConfigured()) {
        try {
          await supabase.from('p2p_transfers').insert({
            id: transferId,
            conversation_id: conversation.id,
            sender_id: currentUser.id,
            receiver_id: receiverId,
            file_name: meta.fileName,
            file_size: meta.fileSize,
            file_type: meta.fileType,
            file_hash_sha256: meta.fileHashSha256,
            status: 'pending',
          });
        } catch (err) {
          console.warn('Could not insert p2p_transfers row:', err);
        }
      }

      // Clean up and null any previous transfer instance before starting a new sender
      p2pSenderRef.current?.close();
      p2pSenderRef.current = null;
      p2pReceiverRef.current?.close();
      p2pReceiverRef.current = null;

      let localLoopbackReceiver: P2PFileReceiver | null = null;

      const sendSignal = (sig: any) => {
        if (isLiveSupabaseConfigured() && p2pChannelRef.current) {
          p2pChannelRef.current.send({
            type: 'broadcast',
            event: 'p2p_signal',
            payload: { ...sig, senderUserId: currentUser.id },
          });
        } else if (localLoopbackReceiver) {
          // Offline / Demo mode: execute real WebRTC DataChannel loopback between Sender & Receiver
          if (sig.type === 'p2p_offer') {
            localLoopbackReceiver.handleOffer(sig.sdp, sig.metadata).catch(() => {});
          } else if (sig.type === 'p2p_ice') {
            localLoopbackReceiver.handleIceCandidate(sig.candidate).catch(() => {});
          }
        }
      };

      const sender = new P2PFileSender(file, meta, sendSignal, (prog) => {
        setActiveP2P((prev) => (prev ? { ...prev, progress: prog } : null));
        if (prog.status === 'transferring' || prog.status === 'completed' || prog.status === 'failed' || prog.status === 'cancelled') {
          syncP2PTransferStatus(transferId, prog.status);
        }
        if (prog.status === 'completed') {
          handleSendMessage({
            content: `Sent "${file.name}" (${formatFileSize(file.size)}) via direct WebRTC P2P`,
            media_type: 'file',
            file_name: file.name,
            file_size: file.size,
            is_view_once: false,
          }).catch(() => {});
        }
      });
      p2pSenderRef.current = sender;

      if (!isLiveSupabaseConfigured()) {
        localLoopbackReceiver = new P2PFileReceiver(
          (sig) => {
            if (sig.type === 'p2p_answer') {
              sender.handleAnswer(sig.sdp).catch(() => {});
            } else if (sig.type === 'p2p_ice') {
              sender.handleIceCandidate(sig.candidate).catch(() => {});
            }
          },
          undefined,
          (blob) => {
            setActiveP2P((prev) => (prev ? { ...prev, completedBlob: blob } : null));
          }
        );
        p2pReceiverRef.current = localLoopbackReceiver;
      }

      try {
        await sender.start();
      } catch (err: any) {
        setActiveP2P((prev) =>
          prev
            ? {
                ...prev,
                progress: {
                  transferId,
                  bytesTransferred: 0,
                  totalBytes: file.size,
                  percentage: 0,
                  speedBytesPerSec: 0,
                  status: 'failed',
                  errorMessage: err?.message || 'Could not start WebRTC connection',
                },
              }
            : null
        );
      }
    },
    [conversation.id, conversation.other_user?.id, currentUser.id, handleSendMessage, syncP2PTransferStatus]
  );

  const handleAcceptP2PRequest = useCallback(async () => {
    if (!activeP2P?.pendingOffer || !activeP2P.metadata || !p2pReceiverRef.current) return;
    const transferId = activeP2P.metadata.transferId;
    setActiveP2P((prev) => (prev ? { ...prev, isIncomingRequest: false } : null));
    await syncP2PTransferStatus(transferId, 'transferring');
    try {
      await p2pReceiverRef.current.handleOffer(activeP2P.pendingOffer, activeP2P.metadata);
    } catch (err: any) {
      setActiveP2P((prev) =>
        prev
          ? {
              ...prev,
              progress: {
                transferId,
                bytesTransferred: 0,
                totalBytes: activeP2P.fileSize,
                percentage: 0,
                speedBytesPerSec: 0,
                status: 'failed',
                errorMessage: err?.message || 'Failed to accept WebRTC offer',
              },
            }
          : null
      );
    }
  }, [activeP2P, syncP2PTransferStatus]);

  const handleRejectP2PRequest = useCallback(async () => {
    const transferId = activeP2P?.metadata?.transferId;
    if (transferId && isLiveSupabaseConfigured() && p2pChannelRef.current) {
      p2pChannelRef.current.send({
        type: 'broadcast',
        event: 'p2p_signal',
        payload: {
          type: 'FILE_TRANSFER_REJECT',
          transferId,
          reason: 'Recipient declined file transfer',
          senderUserId: currentUser.id,
        },
      });
      await syncP2PTransferStatus(transferId, 'cancelled');
    }
    p2pReceiverRef.current?.cancel();
    p2pReceiverRef.current = null;
    setActiveP2P(null);
  }, [activeP2P, currentUser.id, syncP2PTransferStatus]);

  const handleDownloadP2PBlob = useCallback(() => {
    if (!activeP2P?.completedBlob) return;
    const blobUrl = URL.createObjectURL(activeP2P.completedBlob);
    downloadFileUrl(blobUrl, activeP2P.fileName).finally(() => {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    });
  }, [activeP2P]);

  // Handle Reactions (computed synchronously before setMessages to avoid React 19 updater race)
  const handleAddReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const targetMsg = messages.find((m) => m.id === messageId);
      const isRemoving = !!targetMsg?.reactions?.some(
        (r) => r.user_id === currentUser.id && r.emoji === emoji
      );

      setMessages((prev) => {
        const nextList = prev.map((m) => {
          if (m.id !== messageId) return m;
          const existingReactions = m.reactions || [];
          if (isRemoving) {
            return {
              ...m,
              reactions: existingReactions.filter(
                (r) => !(r.user_id === currentUser.id && r.emoji === emoji)
              ),
            };
          }
          if (existingReactions.some((r) => r.user_id === currentUser.id && r.emoji === emoji)) {
            return m;
          }
          return {
            ...m,
            reactions: [
              ...existingReactions,
              {
                id: `rx-${Date.now()}`,
                message_id: messageId,
                user_id: currentUser.id,
                emoji,
                created_at: new Date().toISOString(),
              },
            ],
          };
        });
        persistMessagesCache(nextList);
        return nextList;
      });

      if (isLiveSupabaseConfigured()) {
        try {
          if (isRemoving) {
            await supabase.from('reactions').delete().match({
              message_id: messageId,
              user_id: currentUser.id,
              emoji,
            });
          } else {
            await supabase.from('reactions').insert({
              message_id: messageId,
              user_id: currentUser.id,
              emoji,
            });
          }
        } catch (err) {
          console.error('Failed to sync reaction to Supabase:', err);
        }
      }
    },
    [messages, currentUser.id, persistMessagesCache]
  );

  // Soft Delete for Everyone (preserves DB row & storage object for audit)
  const handleDeleteForEveryone = useCallback(
    async (messageId: string) => {
      const deletedAt = new Date().toISOString();
      setMessages((prev) => {
        const nextList = prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                deleted_for_everyone: true,
                deleted_at: deletedAt,
                deleted_by: currentUser.id,
              }
            : m
        );
        persistMessagesCache(nextList);
        return nextList;
      });

      if (isLiveSupabaseConfigured()) {
        try {
          await supabase
            .from('messages')
            .update({
              deleted_for_everyone: true,
              deleted_at: deletedAt,
              deleted_by: currentUser.id,
            })
            .eq('id', messageId);
        } catch (err) {
          console.error('Failed to soft delete for everyone in Supabase:', err);
        }
      }
    },
    [currentUser.id, persistMessagesCache]
  );

  const handleDeleteForMe = useCallback(
    (messageId: string) => {
      setMessages((prev) => {
        const nextList = prev.filter((m) => m.id !== messageId);
        persistMessagesCache(nextList);
        return nextList;
      });
    },
    [persistMessagesCache]
  );

  // Resolve reply_to objects from local message list if DB realtime event omitted join
  const hydratedMessages = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m]));
    return messages.map((m) => {
      if (m.reply_to_id && !m.reply_to) {
        const target = byId.get(m.reply_to_id);
        if (target) return { ...m, reply_to: target };
      }
      return m;
    });
  }, [messages]);

  const displayedMessages = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return hydratedMessages;
    return hydratedMessages.filter(
      (m) =>
        !m.deleted_for_everyone &&
        ((m.content || '').toLowerCase().includes(q) ||
          (m.file_name || '').toLowerCase().includes(q))
    );
  }, [hydratedMessages, chatSearchQuery]);

  const displayName = conversation.title || conversation.other_user?.display_name || 'Chat';
  const avatarUrl = conversation.avatar_url || conversation.other_user?.avatar_url;

  return (
    <div
      className="h-full w-full flex flex-col bg-black text-white relative overflow-hidden"
      style={
        wallpaper
          ? {
              backgroundImage: wallpaper.startsWith('http') ? `url(${wallpaper})` : wallpaper,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {/* Top Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-[#1F1F1F] bg-black/95 backdrop-blur-md sticky top-0 z-20 flex-shrink-0">
        <div className="flex items-center space-x-3 min-w-0">
          <button
            onClick={onBack}
            className="md:hidden p-1.5 -ml-1 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
            title="Back to chats"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>

          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full overflow-hidden border border-[#2A2A2A] bg-[#121212] flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="font-bold text-sm text-white">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            {isPeerOnline && (
              <div className="w-3 h-3 bg-[#10B981] rounded-full border-2 border-black absolute bottom-0 right-0" />
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <h2 className="text-sm font-bold text-white truncate max-w-[160px] sm:max-w-[260px]">
              {displayName}
            </h2>
            <span
              className={`text-[11px] font-medium flex items-center space-x-1 ${
                isPeerTyping
                  ? 'text-[#E1306C]'
                  : isPeerOnline
                  ? 'text-[#10B981]'
                  : 'text-[#777777]'
              }`}
            >
              <span>
                {isPeerTyping ? 'typing...' : isPeerOnline ? 'Online' : 'Offline'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen((prev) => !prev);
              setChatSearchQuery('');
            }}
            title="Search in conversation"
            className={`p-2.5 rounded-full transition active:scale-95 ${
              isSearchOpen ? 'bg-[#1E1E1E] text-[#E1306C]' : 'hover:bg-[#1E1E1E] text-[#A0A0A0] hover:text-white'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onStartCall('audio')}
            title="Start Audio Call"
            className="p-2.5 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
          >
            <Phone className="w-5 h-5 text-white" />
          </button>
          <button
            type="button"
            onClick={() => onStartCall('video')}
            title="Start Video Call"
            className="p-2.5 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
          >
            <Video className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* In-Chat Search Bar */}
      {isSearchOpen && (
        <div className="px-4 py-2 border-b border-[#1F1F1F] bg-[#0B0B0B] flex items-center gap-2 z-10">
          <Search className="w-4 h-4 text-[#888888]" />
          <input
            type="text"
            autoFocus
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            placeholder="Search messages or filenames..."
            className="flex-1 bg-transparent text-xs text-white placeholder-[#666666] outline-none"
          />
          {chatSearchQuery && (
            <span className="text-[11px] text-[#888888]">
              {displayedMessages.length} match{displayedMessages.length === 1 ? '' : 'es'}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(false);
              setChatSearchQuery('');
            }}
            className="p-1 text-[#888888] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Toast Strip */}
      {chatBannerError && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-2 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
            <span className="truncate">{chatBannerError}</span>
          </div>
          <button
            type="button"
            onClick={() => setChatBannerError(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Message Stream Container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScrollContainer}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1 custom-dark-scrollbar relative"
      >
        {displayedMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#666666] text-xs py-12">
            {chatSearchQuery ? 'No matching messages found.' : 'Say hello to start the conversation!'}
          </div>
        )}

        {displayedMessages.map((message, index) => {
          const prev = index > 0 ? displayedMessages[index - 1] : null;
          const next = index < displayedMessages.length - 1 ? displayedMessages[index + 1] : null;

          const showDateDivider = !prev || !sameCalendarDay(prev.created_at, message.created_at);
          const sameAsPrev =
            !!prev &&
            !showDateDivider &&
            prev.sender_id === message.sender_id &&
            Math.abs(
              new Date(message.created_at).getTime() - new Date(prev.created_at).getTime()
            ) < 120000;
          const sameAsNext =
            !!next &&
            sameCalendarDay(message.created_at, next.created_at) &&
            next.sender_id === message.sender_id &&
            Math.abs(
              new Date(next.created_at).getTime() - new Date(message.created_at).getTime()
            ) < 120000;

          const isOwn = message.sender_id === currentUser.id;
          const isFirstInGroup = !sameAsPrev;
          const isLastInGroup = !sameAsNext;

          return (
            <React.Fragment key={message.id}>
              {showDateDivider && (
                <div className="flex items-center justify-center my-3">
                  <span
                    suppressHydrationWarning
                    className="bg-[#181818] border border-[#2A2A2A] text-[#888888] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm"
                  >
                    {formatDateDivider(message.created_at)}
                  </span>
                </div>
              )}

              <MessageBubble
                message={message}
                isOwn={isOwn}
                currentUser={currentUser}
                isFirstInGroup={isFirstInGroup}
                isLastInGroup={isLastInGroup}
                showAvatar={!isOwn && isLastInGroup}
                showSenderName={conversation.type === 'group' && !isOwn && isFirstInGroup}
                isHighlighted={highlightedMessageId === message.id}
                onReply={(msg) => setReplyingTo(msg)}
                onOpenContextMenu={(msg, e) => {
                  e.preventDefault();
                  const clientX = 'clientX' in e ? e.clientX : e.touches?.[0]?.clientX || 120;
                  const clientY = 'clientY' in e ? e.clientY : e.touches?.[0]?.clientY || 200;
                  setContextMenu({
                    message: msg,
                    position: { x: clientX, y: clientY },
                  });
                }}
                onOpenViewOnce={(msg) => {
                  if (!msg.viewed_at && msg.media_type === 'image' && msg.sender_id !== currentUser.id) {
                    setViewOnceMedia(msg);
                  }
                }}
                onOpenImage={(msg) => setLightboxImage(msg)}
                onScrollToMessage={handleScrollToMessage}
                onAddReaction={handleAddReaction}
                onOpenP2PHUD={() => {
                  if (activeP2P) {
                    setActiveP2P((prev) => (prev ? { ...prev, isOpen: true } : null));
                  } else {
                    setChatBannerError('P2P session completed or closed. Direct P2P files are streamed live peer-to-peer.');
                  }
                }}
              />
            </React.Fragment>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* WhatsApp-style Floating Scroll-to-Bottom Button with Unread Badge */}
      {isScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-20 right-4 z-20 w-10 h-10 rounded-full bg-[#181818] border border-[#2E2E2E] shadow-xl flex items-center justify-center text-white hover:bg-[#242424] active:scale-95 transition-all"
          title="Scroll to latest messages"
        >
          <ChevronDown className="w-5 h-5" />
          {unreadWhileScrolled > 0 && (
            <span
              className={`absolute -top-2 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${config.gradientClass}`}
            >
              {unreadWhileScrolled}
            </span>
          )}
        </button>
      )}

      {/* Integrated Message Composer */}
      <MessageComposer
        conversationId={conversation.id}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSendMessage={handleSendMessage}
        onTypingChange={handleTypingChange}
        onOpenMediaPicker={(tab = 'emoji') =>
          setMediaPickerState({
            isOpen: true,
            initialTab: tab,
            reactionTargetMessageId: null,
          })
        }
        onStartP2PTransfer={handleStartP2PTransfer}
        isSending={isSending}
        uploadProgress={uploadProgress}
      />

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          message={contextMenu.message}
          position={contextMenu.position}
          isOwn={contextMenu.message.sender_id === currentUser.id}
          currentUser={currentUser}
          onClose={() => setContextMenu(null)}
          onReply={(msg) => {
            setReplyingTo(msg);
            setContextMenu(null);
          }}
          onDeleteForMe={(msgId) => {
            handleDeleteForMe(msgId);
            setContextMenu(null);
          }}
          onDeleteForEveryone={(msgId) => {
            handleDeleteForEveryone(msgId);
            setContextMenu(null);
          }}
          onReact={(msgId, emoji) => {
            handleAddReaction(msgId, emoji);
            setContextMenu(null);
          }}
          onOpenMoreEmojis={(msg) => {
            setContextMenu(null);
            setMediaPickerState({
              isOpen: true,
              initialTab: 'emoji',
              reactionTargetMessageId: msg.id,
            });
          }}
        />
      )}

      {/* Full-Screen Image Lightbox (Standard Photos Only) */}
      {lightboxImage && lightboxImage.media_url && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between p-4 animate-fade-in"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="flex items-center justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs text-[#A0A0A0] truncate max-w-[70%]">
              {lightboxImage.file_name || 'Photo'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadFileUrl(
                    lightboxImage.media_url!,
                    lightboxImage.file_name || 'photo.jpg'
                  )
                }
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                title="Download photo"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={lightboxImage.media_url}
              alt={lightboxImage.file_name || 'Photo'}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] max-w-full object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* View Once Photo Modal */}
      {viewOnceMedia && (
        <ViewOnceModal
          isOpen={true}
          message={viewOnceMedia}
          onClose={() => setViewOnceMedia(null)}
          onViewed={handleMarkViewOnceViewed}
          onMarkAsViewed={handleMarkViewOnceViewed}
        />
      )}

      {/* Media Picker Modal (Emojis / Reaction Mode, Tenor/Giphy GIFs, Stickers, Photo w/ View Once) */}
      {mediaPickerState.isOpen && (
        <MediaPickerModal
          isOpen={mediaPickerState.isOpen}
          initialTab={mediaPickerState.initialTab}
          reactionOnly={!!mediaPickerState.reactionTargetMessageId}
          onClose={() =>
            setMediaPickerState((prev) => ({
              ...prev,
              isOpen: false,
              reactionTargetMessageId: null,
            }))
          }
          onSelectEmoji={(emoji) => {
            if (mediaPickerState.reactionTargetMessageId) {
              handleAddReaction(mediaPickerState.reactionTargetMessageId, emoji);
            } else {
              handleSendMessage({ content: emoji, media_type: 'text', is_view_once: false });
            }
          }}
          onSelectGif={(gif) => {
            handleSendMessage({
              content: '',
              media_type: 'gif',
              media_url: gif.fullUrl,
              is_view_once: false,
            });
          }}
          onSelectSticker={(stickerUrl) => {
            handleSendMessage({
              content: '',
              media_type: 'sticker',
              media_url: stickerUrl,
              is_view_once: false,
            });
          }}
          onSelectPhoto={async (file, { isViewOnce, caption }) => {
            await handleSendMessage({
              content: caption,
              media_type: 'image',
              file_name: file.name,
              file_size: file.size,
              is_view_once: isViewOnce,
              reply_to_id: replyingTo?.id || null,
              file,
            });
          }}
        />
      )}

      {/* P2P Transfer HUD Modal */}
      {activeP2P && activeP2P.isOpen && (
        <P2PTransferModal
          isOpen={activeP2P.isOpen}
          onClose={() => setActiveP2P((prev) => (prev ? { ...prev, isOpen: false } : null))}
          fileName={activeP2P.fileName}
          fileSize={activeP2P.fileSize}
          metadata={activeP2P.metadata}
          progress={activeP2P.progress}
          isSender={activeP2P.isSender}
          isIncomingRequest={activeP2P.isIncomingRequest}
          onAcceptRequest={handleAcceptP2PRequest}
          onRejectRequest={handleRejectP2PRequest}
          onDownloadFile={activeP2P.completedBlob ? handleDownloadP2PBlob : undefined}
          onPause={() => {
            if (activeP2P.isSender) p2pSenderRef.current?.pause();
            else p2pReceiverRef.current?.pause();
          }}
          onResume={() => {
            if (activeP2P.isSender) p2pSenderRef.current?.resume();
            else p2pReceiverRef.current?.resume();
          }}
          onCancel={() => {
            if (activeP2P.isSender) {
              p2pSenderRef.current?.cancel();
              p2pSenderRef.current = null;
            } else {
              p2pReceiverRef.current?.cancel();
              p2pReceiverRef.current = null;
            }
            if (activeP2P.metadata?.transferId) {
              syncP2PTransferStatus(activeP2P.metadata.transferId, 'cancelled');
            }
            setTimeout(() => setActiveP2P(null), 300);
          }}
        />
      )}
    </div>
  );
}

export { ChatInterface };
