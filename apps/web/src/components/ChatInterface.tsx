'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Conversation, User, Message, MediaType } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import MessageBubble from '@/components/MessageBubble';
import MessageComposer from '@/components/MessageComposer';
import ContextMenu from '@/components/ContextMenu';
import ViewOnceModal from '@/components/ViewOnceModal';
import MediaPickerModal from '@/components/MediaPickerModal';
import P2PTransferModal from '@/components/P2PTransferModal';
import { P2PFileSender, P2PTransferMetadata, TransferProgress } from '@/lib/webrtc/p2pTransfer';
import { ArrowLeft, Phone, Video, MoreVertical, Info, Shield, Check, CheckCheck } from 'lucide-react';

interface ChatInterfaceProps {
  conversation: Conversation;
  currentUser: User;
  onBack: () => void;
  onStartCall: (type: 'audio' | 'video') => void;
}

export default function ChatInterface({
  conversation,
  currentUser,
  onBack,
  onStartCall,
}: ChatInterfaceProps) {
  const { wallpaper, config } = useTheme();

  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    message: Message;
    position: { x: number; y: number };
  } | null>(null);
  const [viewOnceMedia, setViewOnceMedia] = useState<Message | null>(null);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // Active P2P transfer HUD state
  const [activeP2P, setActiveP2P] = useState<{
    isOpen: boolean;
    fileName: string;
    fileSize: number;
    metadata: P2PTransferMetadata | null;
    progress: TransferProgress | null;
    isSender: boolean;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to reconcile viewed_at with localStorage
  const reconcileViewOnce = useCallback((msgList: Message[]): Message[] => {
    let cachedIds: string[] = [];
    if (typeof window !== 'undefined') {
      try {
        cachedIds = JSON.parse(localStorage.getItem('viewed_view_once_ids') || '[]');
      } catch {}
    }

    return msgList.map((msg) => {
      if (msg.is_view_once && !msg.viewed_at) {
        const isLocallyViewed =
          cachedIds.includes(msg.id) ||
          (typeof window !== 'undefined' && !!localStorage.getItem(`view_once_opened_${msg.id}`));
        if (isLocallyViewed) {
          const savedTime =
            (typeof window !== 'undefined' && localStorage.getItem(`view_once_opened_${msg.id}`)) ||
            new Date().toISOString();
          return { ...msg, viewed_at: savedTime };
        }
      }
      return msg;
    });
  }, []);

  const handleMarkViewOnceViewed = useCallback(async (msgId: string) => {
    const timestamp = new Date().toISOString();

    // 1. Update local state to "Opened" and wipe media content
    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.id === msgId ? { ...m, viewed_at: timestamp, media_url: '', content: '' } : m
      );
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`messenger_chat_msgs_${conversation.id}`, JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });

    // 2. Persist to localStorage under viewed_view_once_ids and individual key
    if (typeof window !== 'undefined') {
      try {
        const viewedIds = JSON.parse(localStorage.getItem('viewed_view_once_ids') || '[]');
        if (!viewedIds.includes(msgId)) {
          viewedIds.push(msgId);
          localStorage.setItem('viewed_view_once_ids', JSON.stringify(viewedIds));
        }
        localStorage.setItem(`view_once_opened_${msgId}`, timestamp);
      } catch (e) {
        console.warn('Could not persist viewed view-once to localStorage', e);
      }
    }

    // 3. Asynchronously update Supabase
    if (isLiveSupabaseConfigured()) {
      try {
        await supabase
          .from('messages')
          .update({ viewed_at: timestamp })
          .eq('id', msgId);
      } catch (err) {
        console.error('Failed to update viewed_at in Supabase:', err);
      }
    }
  }, []);

  // Initialize or fetch messages from durable localStorage cache or Supabase
  useEffect(() => {
    let localList: Message[] | null = null;
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`messenger_chat_msgs_${conversation.id}`);
        if (saved) {
          localList = JSON.parse(saved) as Message[];
        }
      } catch {}
    }

    if (localList && localList.length > 0) {
      setMessages(reconcileViewOnce(localList));
    } else {
      const initialList: Message[] = [
        {
          id: `msg-${conversation.id}-1`,
          conversation_id: conversation.id,
          sender_id: conversation.other_user?.id || 'other-id',
          content: `Hey! Welcome to our $0-cost private messenger. Everything is encrypted, zero tracking, and real-time.`,
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
          content: `Awesome! Did you test the WebRTC 1 GB chunk transfer? 🚀`,
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
      setMessages(reconciled);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`messenger_chat_msgs_${conversation.id}`, JSON.stringify(reconciled));
        } catch {}
      }
    }

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    if (isLiveSupabaseConfigured()) {
      async function fetchDbMessages() {
        const { data } = await supabase
          .from('messages')
          .select('*, sender:users(*), reactions(*)')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: true });

        if (data && data.length > 0) {
          setMessages(reconcileViewOnce(data as Message[]));
        }
      }
      fetchDbMessages();

      const channel = supabase
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
              return [...prev, reconciled];
            });
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
            setMessages((prev) =>
              prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m))
            );
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [conversation.id, conversation.other_user, conversation.last_message, currentUser, reconcileViewOnce]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle Send Message
  const handleSendMessage = useCallback(
    async (payload: {
      content: string;
      media_type?: MediaType;
      mediaType?: MediaType;
      media_url?: string;
      mediaUrl?: string;
      file_name?: string;
      fileName?: string;
      file_size?: number;
      fileSize?: number;
      is_view_once?: boolean;
      isViewOnce?: boolean;
      reply_to_id?: string | null;
      replyToId?: string;
    }) => {
      const resolvedMediaType = payload.media_type || payload.mediaType || 'text';
      const resolvedMediaUrl = payload.media_url || payload.mediaUrl || '';
      const resolvedFileName = payload.file_name || payload.fileName || '';
      const resolvedFileSize = payload.file_size || payload.fileSize || 0;
      const resolvedIsViewOnce = payload.is_view_once !== undefined ? payload.is_view_once : !!payload.isViewOnce;
      const resolvedReplyToId = payload.reply_to_id || payload.replyToId || null;

      const newMessage: Message = {
        id: `msg-local-${Date.now()}`,
        conversation_id: conversation.id,
        sender_id: currentUser.id,
        content: payload.content,
        media_type: resolvedMediaType,
        media_url: resolvedMediaUrl,
        file_name: resolvedFileName,
        file_size: resolvedFileSize,
        is_view_once: resolvedIsViewOnce,
        viewed_at: null,
        reply_to_id: resolvedReplyToId,
        reply_to: replyingTo,
        deleted_for_everyone: false,
        created_at: new Date().toISOString(),
        sender: currentUser,
        reactions: [],
      };

      setMessages((prev) => {
        const nextList = [...prev, newMessage];
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`messenger_chat_msgs_${conversation.id}`, JSON.stringify(nextList));
          } catch {}
        }
        return nextList;
      });
      setReplyingTo(null);

      if (isLiveSupabaseConfigured()) {
        try {
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender_id: currentUser.id,
            content: payload.content,
            media_type: resolvedMediaType,
            media_url: resolvedMediaUrl,
            file_name: resolvedFileName,
            file_size: resolvedFileSize,
            is_view_once: resolvedIsViewOnce,
            reply_to_id: resolvedReplyToId,
          });
        } catch (err) {
          console.error('Failed to send message to Supabase', err);
        }
      }
    },
    [conversation.id, currentUser, replyingTo]
  );

  // Handle Start P2P Transfer for Large Files (> 50 MB)
  const handleStartP2PTransfer = useCallback((file: File) => {
    const transferId = `p2p-${Date.now()}`;
    const receiverId = conversation.other_user?.id || 'receiver-id';
    const meta: P2PTransferMetadata = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      fileHashSha256: 'mock-sha256-transfer-verification-token',
      senderId: currentUser.id,
      receiverId,
      conversationId: conversation.id,
    };

    setActiveP2P({
      isOpen: true,
      fileName: file.name,
      fileSize: file.size,
      metadata: meta,
      progress: {
        transferId,
        bytesTransferred: 0,
        totalBytes: file.size,
        percentage: 0,
        speedBytesPerSec: 1024 * 1024 * 4.5, // 4.5 MB/s
        status: 'transferring',
      },
      isSender: true,
    });

    // Simulate transfer progress ticks
    let transferred = 0;
    const interval = setInterval(() => {
      transferred += 1024 * 1024 * 6; // 6 MB per tick
      const pct = Math.min(100, Math.round((transferred / file.size) * 100));
      setActiveP2P((prev) =>
        prev
          ? {
              ...prev,
              progress: {
                ...prev.progress!,
                bytesTransferred: Math.min(transferred, file.size),
                percentage: pct,
                status: pct >= 100 ? 'completed' : 'transferring',
              },
            }
          : null
      );

      if (transferred >= file.size) {
        clearInterval(interval);
        // Post message to chat stream as P2P file
        handleSendMessage({
          content: '',
          media_type: 'file',
          file_name: file.name,
          file_size: file.size,
        });
      }
    }, 400);
  }, [handleSendMessage]);

  // Handle Reactions
  const handleAddReaction = useCallback((messageId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const existingReactions = m.reactions || [];
        const foundIndex = existingReactions.findIndex(
          (r) => r.user_id === currentUser.id && r.emoji === emoji
        );

        if (foundIndex >= 0) {
          return {
            ...m,
            reactions: existingReactions.filter((_, i) => i !== foundIndex),
          };
        } else {
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
        }
      })
    );
  }, [currentUser.id]);

  // Handle Delete for Everyone (Soft Delete Audit)
  const handleDeleteForEveryone = useCallback(async (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deleted_for_everyone: true,
              deleted_at: new Date().toISOString(),
              deleted_by: currentUser.id,
            }
          : m
      )
    );

    if (isLiveSupabaseConfigured()) {
      await supabase
        .from('messages')
        .update({
          deleted_for_everyone: true,
          deleted_at: new Date().toISOString(),
          deleted_by: currentUser.id,
        })
        .eq('id', messageId);
    }
  }, [currentUser.id]);

  // Handle Delete for Me
  const handleDeleteForMe = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

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
      <div className="h-16 px-4 flex items-center justify-between border-b border-[#1F1F1F] bg-black/95 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center space-x-3">
          {/* Back Button (Mobile) */}
          <button
            onClick={onBack}
            className="md:hidden p-1.5 -ml-1 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>

          {/* Contact Avatar */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden border border-[#2A2A2A] bg-[#121212] flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="font-bold text-sm text-white">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="w-3 h-3 bg-[#10B981] rounded-full border-2 border-black absolute bottom-0 right-0" />
          </div>

          {/* Title & Status */}
          <div className="flex flex-col min-w-0">
            <h2 className="text-sm font-bold text-white truncate max-w-[180px] sm:max-w-[260px]">
              {displayName}
            </h2>
            <span className="text-[11px] text-[#10B981] font-medium flex items-center space-x-1">
              <span>{isTyping ? 'typing...' : 'Online'}</span>
            </span>
          </div>
        </div>

        {/* Audio & Video Call Action Buttons */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => onStartCall('audio')}
            title="Start Audio Call"
            className="p-2.5 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
          >
            <Phone className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={() => onStartCall('video')}
            title="Start Video Call"
            className="p-2.5 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
          >
            <Video className="w-5 h-5 text-white" />
          </button>
          <button
            title="Conversation Options"
            className="p-2.5 rounded-full hover:bg-[#1E1E1E] text-[#A0A0A0] hover:text-white transition"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Message Stream Container */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-dark-scrollbar">
        {/* Date Divider */}
        <div className="flex items-center justify-center my-3">
          <span className="bg-[#181818] border border-[#2A2A2A] text-[#888888] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
            Today
          </span>
        </div>

        {/* Messages List */}
        {messages.map((message) => {
          const isOwn = message.sender_id === currentUser.id;
          return (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={isOwn}
              currentUser={currentUser}
              onReply={(msg) => setReplyingTo(msg)}
              onOpenContextMenu={(msg, e) => {
                e.preventDefault();
                setContextMenu({
                  message: msg,
                  position: { x: (e as React.MouseEvent).clientX || 120, y: (e as React.MouseEvent).clientY || 200 },
                });
              }}
              onOpenViewOnce={(msg) => setViewOnceMedia(msg)}
              onAddReaction={handleAddReaction}
              onOpenP2PHUD={() => {
                const transferId = `p2p-${message.id}`;
                setActiveP2P({
                  isOpen: true,
                  fileName: message.file_name || 'Large_Transfer_File',
                  fileSize: message.file_size || 50 * 1024 * 1024,
                  metadata: {
                    transferId,
                    fileName: message.file_name || 'Large_Transfer_File',
                    fileSize: message.file_size || 50 * 1024 * 1024,
                    fileType: 'application/octet-stream',
                    fileHashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                    senderId: message.sender_id,
                    receiverId: currentUser.id,
                    conversationId: conversation.id,
                  },
                  progress: {
                    transferId,
                    bytesTransferred: message.file_size || 50 * 1024 * 1024,
                    totalBytes: message.file_size || 50 * 1024 * 1024,
                    percentage: 100,
                    speedBytesPerSec: 0,
                    status: 'completed',
                  },
                  isSender: false,
                });
              }}
            />
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Replying-To Preview Banner */}
      {replyingTo && (
        <div
          className="bg-[#181818] border-t border-l-4 border-[#2A2A2A] px-4 py-2 flex items-center justify-between"
          style={{ borderLeftColor: config.primaryHex }}
        >
          <div className="flex flex-col min-w-0 pr-3">
            <span className="text-[11px] font-semibold text-white">
              Replying to {replyingTo.sender_id === currentUser.id ? 'yourself' : displayName}
            </span>
            <span className="text-xs text-[#A0A0A0] truncate max-w-sm">
              {replyingTo.content || (replyingTo.is_view_once ? 'View Once media' : 'Attachment')}
            </span>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="text-[#A0A0A0] hover:text-white p-1 rounded-full hover:bg-[#242424]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Integrated Message Composer */}
      <MessageComposer
        conversationId={conversation.id}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSendMessage={handleSendMessage}
        onOpenMediaPicker={() => setIsMediaPickerOpen(true)}
        onStartP2PTransfer={handleStartP2PTransfer}
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
          onCopy={(text) => {
            navigator.clipboard.writeText(text);
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
        />
      )}

      {/* View Once Media Modal */}
      {viewOnceMedia && (
        <ViewOnceModal
          isOpen={true}
          message={viewOnceMedia}
          onClose={() => setViewOnceMedia(null)}
          onViewed={handleMarkViewOnceViewed}
          onMarkAsViewed={handleMarkViewOnceViewed}
        />
      )}

      {/* Media Picker Modal (Emojis, Tenor/Giphy GIFs, Stickers) */}
      {isMediaPickerOpen && (
        <MediaPickerModal
          isOpen={isMediaPickerOpen}
          onClose={() => setIsMediaPickerOpen(false)}
          onSelectEmoji={(emoji) => {
            handleSendMessage({ content: emoji, media_type: 'text' });
            setIsMediaPickerOpen(false);
          }}
          onSelectGif={(gif) => {
            handleSendMessage({ content: gif.fullUrl, media_type: 'gif', media_url: gif.fullUrl });
            setIsMediaPickerOpen(false);
          }}
          onSelectSticker={(stickerUrl) => {
            handleSendMessage({ content: stickerUrl, media_type: 'sticker', media_url: stickerUrl });
            setIsMediaPickerOpen(false);
          }}
        />
      )}

      {/* P2P Transfer HUD Modal */}
      {activeP2P && activeP2P.isOpen && (
        <P2PTransferModal
          isOpen={activeP2P.isOpen}
          onClose={() => setActiveP2P(null)}
          fileName={activeP2P.fileName}
          fileSize={activeP2P.fileSize}
          metadata={activeP2P.metadata}
          progress={activeP2P.progress}
          isSender={activeP2P.isSender}
        />
      )}
    </div>
  );
}

export { ChatInterface };
