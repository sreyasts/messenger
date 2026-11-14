'use client';

import React, { useState, useMemo } from 'react';
import { User, Conversation } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { X, Search, Users, User as UserIcon, Check } from 'lucide-react';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onSelectConversation: (conversationId: string) => void;
  existingConversations?: Conversation[];
}

const DIRECTORY_USERS: User[] = [
  {
    id: 'user-002',
    email: 'adhin@example.com',
    display_name: 'Adhin',
    bio: 'WebRTC 1 GB chunk streaming wizard ⚡',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    theme_accent: 'ocean-blue',
    chat_background_url: '',
    role: 'user',
    is_banned: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'user-003',
    email: 'elena@example.com',
    display_name: 'Elena Rostova',
    bio: 'UI designer & nature photographer 📷',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    theme_accent: 'emerald',
    chat_background_url: '',
    role: 'user',
    is_banned: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'user-004',
    email: 'marcus@example.com',
    display_name: 'Marcus Vance',
    bio: 'Supabase free tier architect 🗄️',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
    theme_accent: 'violet-pink',
    chat_background_url: '',
    role: 'user',
    is_banned: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'user-005',
    email: 'sarah@example.com',
    display_name: 'Sarah Chen',
    bio: 'LiveKit Cloud & WebRTC VoIP specialist 🎙️',
    avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
    theme_accent: 'crimson',
    chat_background_url: '',
    role: 'user',
    is_banned: false,
    created_at: '',
    updated_at: '',
  },
];

export default function NewChatModal({
  isOpen,
  onClose,
  currentUser,
  onSelectConversation,
  existingConversations = [],
}: NewChatModalProps) {
  const { config } = useTheme();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const list = DIRECTORY_USERS.filter((u) => u.id !== currentUser.id);
    if (!q) return list;
    return list.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [searchQuery, currentUser.id]);

  if (!isOpen) return null;

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleStartDirectChat = async (user: User) => {
    const existing = existingConversations.find(
      (c) => c.type === 'direct' && c.other_user?.id === user.id
    );

    if (existing) {
      onSelectConversation(existing.id);
      onClose();
      return;
    }

    const newConvId = `conv-${Date.now()}`;

    if (isLiveSupabaseConfigured()) {
      try {
        const { data: convData } = await supabase
          .from('conversations')
          .insert({ type: 'direct' })
          .select()
          .single();

        if (convData) {
          await supabase.from('conversation_participants').insert([
            { conversation_id: convData.id, user_id: currentUser.id },
            { conversation_id: convData.id, user_id: user.id },
          ]);
          onSelectConversation(convData.id);
          onClose();
          return;
        }
      } catch (err) {
        console.error('Supabase direct chat creation error', err);
      }
    }

    onSelectConversation(newConvId);
    onClose();
  };

  const handleCreateGroupChat = async () => {
    if (!groupTitle.trim() || selectedUserIds.length === 0) return;
    setIsCreating(true);

    const newGroupId = `group-${Date.now()}`;

    if (isLiveSupabaseConfigured()) {
      try {
        const { data: convData } = await supabase
          .from('conversations')
          .insert({ type: 'group', title: groupTitle.trim() })
          .select()
          .single();

        if (convData) {
          const participants = [
            { conversation_id: convData.id, user_id: currentUser.id },
            ...selectedUserIds.map((uid) => ({
              conversation_id: convData.id,
              user_id: uid,
            })),
          ];
          await supabase.from('conversation_participants').insert(participants);
          onSelectConversation(convData.id);
          onClose();
          return;
        }
      } catch (err) {
        console.error('Supabase group chat creation error', err);
      }
    }

    setIsCreating(false);
    onSelectConversation(newGroupId);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#121212] border border-[#2A2A2A] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-pop-in">
        {/* Modal Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#1F1F1F]">
          <h2 className="text-base font-bold text-white tracking-tight">
            {mode === 'direct' ? 'New Message' : 'Create Group Chat'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#1E1E1E] text-[#A0A0A0] hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex border-b border-[#1F1F1F] bg-[#141414] p-1.5">
          <button
            onClick={() => setMode('direct')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
              mode === 'direct'
                ? 'bg-[#242424] text-white shadow'
                : 'text-[#888888] hover:text-white'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>Direct Message</span>
          </button>
          <button
            onClick={() => setMode('group')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
              mode === 'group'
                ? 'bg-[#242424] text-white shadow'
                : 'text-[#888888] hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>New Group</span>
          </button>
        </div>

        {/* Group Title Input (Group Mode only) */}
        {mode === 'group' && (
          <div className="p-3 border-b border-[#1F1F1F] bg-[#121212]">
            <input
              type="text"
              placeholder="Group Name (e.g. Project Team, Squad)..."
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2 text-sm text-white placeholder-[#666666] outline-none focus:border-[#444444]"
            />
          </div>
        )}

        {/* Search Users Input */}
        <div className="p-3 border-b border-[#1F1F1F] bg-[#121212]">
          <div className="bg-[#181818] border border-[#2A2A2A] rounded-xl px-3 py-2 flex items-center space-x-2">
            <Search className="w-4 h-4 text-[#A0A0A0]" />
            <input
              type="text"
              placeholder="Search people by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-sm text-white placeholder-[#666666] outline-none flex-1"
            />
          </div>
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#181818] custom-dark-scrollbar p-2">
          {filteredUsers.map((user) => {
            const isSelected = selectedUserIds.includes(user.id);
            return (
              <div
                key={user.id}
                onClick={() => {
                  if (mode === 'direct') {
                    handleStartDirectChat(user);
                  } else {
                    toggleUserSelection(user.id);
                  }
                }}
                className="p-2.5 rounded-xl hover:bg-[#1A1A1A] flex items-center justify-between cursor-pointer transition"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-[#242424] flex items-center justify-center">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.display_name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-white">{user.display_name.slice(0, 2)}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{user.display_name}</h3>
                    <p className="text-xs text-[#777777]">{user.bio || user.email}</p>
                  </div>
                </div>

                {mode === 'group' && (
                  <div
                    className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                      isSelected
                        ? 'bg-[#10B981] border-[#10B981] text-black'
                        : 'border-[#444444] bg-[#181818]'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Group Footer Action */}
        {mode === 'group' && (
          <div className="p-3 border-t border-[#1F1F1F] bg-[#121212]">
            <button
              onClick={handleCreateGroupChat}
              disabled={!groupTitle.trim() || selectedUserIds.length === 0 || isCreating}
              className={`w-full py-2.5 rounded-xl font-bold text-sm text-white shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${config.gradientClass}`}
            >
              {isCreating ? 'Creating Group...' : `Create Group (${selectedUserIds.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { NewChatModal };
