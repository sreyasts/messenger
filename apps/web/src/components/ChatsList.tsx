'use client';

import React, { useState, useMemo } from 'react';
import { Conversation, User } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';
import { Search, X, SquarePen, Plus, Users, Image as ImageIcon, Mic, FileText, Video, Sparkles } from 'lucide-react';

interface ChatsListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  currentUser: User;
  onSelectConversation: (conversationId: string) => void;
  onOpenProfile: () => void;
  onOpenNewChat: () => void;
}

function formatConversationTime(timestamp?: string): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffHours = (now.getTime() - date.getTime()) / (1000 * 3600);

    if (diffHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffHours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  } catch {
    return '';
  }
}

export default function ChatsList({
  conversations,
  activeConversationId,
  currentUser,
  onSelectConversation,
  onOpenProfile,
  onOpenNewChat,
}: ChatsListProps) {
  const { config } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  // Real-time conversation search filtering
  const filteredConversations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return conversations;

    return conversations.filter((c) => {
      const titleMatch = (c.title || '').toLowerCase().includes(q);
      const participantMatch = (c.other_user?.display_name || '').toLowerCase().includes(q);
      const messageMatch = (c.last_message?.content || '').toLowerCase().includes(q);
      return titleMatch || participantMatch || messageMatch;
    });
  }, [conversations, searchQuery]);

  // Extract active friends row
  const activeFriends = useMemo(() => {
    return conversations
      .filter((c) => c.other_user)
      .map((c) => c.other_user as User);
  }, [conversations]);

  const renderLastMessageSnippet = (c: Conversation) => {
    const msg = c.last_message;
    if (!msg) return <span className="text-xs text-[#666666]">No messages yet</span>;

    if (msg.deleted_for_everyone) {
      return <span className="text-xs italic text-[#666666]">This message was deleted</span>;
    }

    if (msg.is_view_once) {
      return (
        <span className="text-xs italic flex items-center space-x-1" style={{ color: config.primaryHex }}>
          <ImageIcon className="w-3.5 h-3.5 inline mr-1" />
          <span>View Once media</span>
        </span>
      );
    }

    switch (msg.media_type) {
      case 'image':
        return (
          <span className="text-xs text-[#A0A0A0] flex items-center">
            <ImageIcon className="w-3.5 h-3.5 mr-1" /> Photo
          </span>
        );
      case 'video':
        return (
          <span className="text-xs text-[#A0A0A0] flex items-center">
            <Video className="w-3.5 h-3.5 mr-1" /> Video
          </span>
        );
      case 'audio':
        return (
          <span className="text-xs text-[#A0A0A0] flex items-center">
            <Mic className="w-3.5 h-3.5 mr-1" /> Voice note
          </span>
        );
      case 'file':
        return (
          <span className="text-xs text-[#A0A0A0] flex items-center">
            <FileText className="w-3.5 h-3.5 mr-1" /> {msg.file_name || 'File'}
          </span>
        );
      case 'sticker':
      case 'gif':
        return (
          <span className="text-xs text-[#A0A0A0] flex items-center">
            <Sparkles className="w-3.5 h-3.5 mr-1" /> Sticker
          </span>
        );
      default:
        return (
          <span className={`text-xs truncate max-w-[200px] ${c.unread_count && c.unread_count > 0 ? 'text-white font-medium' : 'text-[#A0A0A0]'}`}>
            {msg.content}
          </span>
        );
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-black text-white select-none">
      {/* Top Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-[#1F1F1F] bg-black/90 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          {/* User Profile Avatar with Online Green Dot */}
          <button
            onClick={onOpenProfile}
            title="Open Profile & Settings"
            className="relative group focus:outline-none"
          >
            <div className="w-10 h-10 rounded-full overflow-hidden border border-[#2A2A2A] bg-[#121212] flex items-center justify-center transition-transform group-hover:scale-105">
              {currentUser.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt={currentUser.display_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="font-bold text-sm text-white">
                  {currentUser.display_name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="w-3 h-3 bg-[#10B981] rounded-full border-2 border-black absolute bottom-0 right-0" />
          </button>

          <h1 className="text-xl font-bold tracking-tight text-white">
            Messages
          </h1>
        </div>

        {/* New Chat Button */}
        <button
          onClick={onOpenNewChat}
          title="New Message"
          className="p-2 rounded-full hover:bg-[#1E1E1E] text-white transition active:scale-95"
        >
          <SquarePen className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-3 py-2.5 bg-black">
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl px-3 py-2 flex items-center space-x-2 focus-within:border-[#444444] transition">
          <Search className="w-4 h-4 text-[#A0A0A0]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages..."
            className="bg-transparent text-sm text-white placeholder-[#666666] outline-none flex-1"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-[#A0A0A0] hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Active Friends Row (Instagram-Style "Active Now") */}
      {activeFriends.length > 0 && !searchQuery && (
        <div className="py-2 border-b border-[#1A1A1A] overflow-x-auto no-scrollbar px-3">
          <div className="flex items-center space-x-4">
            {activeFriends.map((friend) => (
              <div
                key={friend.id}
                onClick={() => {
                  const conv = conversations.find((c) => c.other_user?.id === friend.id);
                  if (conv) onSelectConversation(conv.id);
                }}
                className="flex flex-col items-center space-y-1 cursor-pointer group flex-shrink-0"
              >
                <div className="w-12 h-12 rounded-full relative p-[2px] bg-gradient-to-tr from-[#2A2A2A] to-[#444444] group-hover:from-[#E1306C] group-hover:to-[#F27121] transition">
                  <div className="w-full h-full rounded-full overflow-hidden bg-[#121212] flex items-center justify-center">
                    {friend.avatar_url ? (
                      <img src={friend.avatar_url} alt={friend.display_name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-white">{friend.display_name.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="w-3.5 h-3.5 bg-[#10B981] rounded-full border-2 border-black absolute bottom-0 right-0" />
                </div>
                <span className="text-[11px] text-[#A0A0A0] max-w-[56px] truncate group-hover:text-white">
                  {friend.display_name.split(' ')[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#161616] custom-dark-scrollbar">
        {filteredConversations.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center p-6 text-[#666666]">
            <Search className="w-8 h-8 mb-2 stroke-[1.5]" />
            <p className="text-sm">No conversations found</p>
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const displayName = conv.title || conv.other_user?.display_name || 'Direct Chat';
            const avatarUrl = conv.avatar_url || conv.other_user?.avatar_url;

            return (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`px-3 py-3 flex items-center space-x-3 cursor-pointer transition-colors duration-150 ${
                  isActive ? 'bg-[#181818] border-l-4' : 'hover:bg-[#121212]'
                }`}
                style={isActive ? { borderLeftColor: config.primaryHex } : undefined}
              >
                {/* Avatar with Online Badge */}
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-[#181818] border border-[#2A2A2A] flex items-center justify-center">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : conv.type === 'group' ? (
                      <Users className="w-6 h-6 text-[#888888]" />
                    ) : (
                      <span className="text-sm font-bold text-white">{displayName.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  {conv.type === 'direct' && (
                    <div className="w-3.5 h-3.5 bg-[#10B981] rounded-full border-2 border-black absolute bottom-0 right-0" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className={`text-sm truncate ${conv.unread_count && conv.unread_count > 0 ? 'font-bold text-white' : 'font-medium text-white'}`}>
                      {displayName}
                    </h3>
                    <span className="text-[11px] text-[#777777] ml-2 flex-shrink-0">
                      {formatConversationTime(conv.last_message?.created_at || conv.updated_at)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 pr-2">
                      {renderLastMessageSnippet(conv)}
                    </div>

                    {conv.unread_count && conv.unread_count > 0 ? (
                      <div
                        className={`min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md ${config.gradientClass}`}
                      >
                        {conv.unread_count}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Action Button (FAB on Mobile) */}
      <button
        onClick={onOpenNewChat}
        title="Start New Chat"
        className={`md:hidden fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-transform active:scale-95 ${config.gradientClass}`}
      >
        <Plus className="w-7 h-7 text-white stroke-[2.5]" />
      </button>
    </div>
  );
}

export { ChatsList };
