'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { User, Conversation, Message, MediaType, ThemeAccent } from '@/types/database';
import ChatsList from '@/components/ChatsList';
import ChatInterface from '@/components/ChatInterface';
import ProfilePage from '@/components/ProfilePage';
import NewChatModal from '@/components/NewChatModal';
import CallModal from '@/components/CallModal';
import P2PTransferModal from '@/components/P2PTransferModal';
import GoogleSignInGate from '@/components/GoogleSignInGate';
import { MessageSquarePlus, Sparkles, Shield, Zap } from 'lucide-react';

// Default Mock Conversations for Initial / Demo State
const INITIAL_MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-001',
    type: 'direct',
    title: 'Adhin (Engineer)',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    unread_count: 2,
    other_user: {
      id: 'user-002',
      email: 'adhin@example.com',
      display_name: 'Adhin',
      bio: 'WebRTC 1 GB chunk streaming wizard ⚡',
      avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      theme_accent: 'ocean-blue',
      chat_background_url: '',
      role: 'user',
      is_banned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    last_message: {
      id: 'msg-001',
      conversation_id: 'conv-001',
      sender_id: 'user-002',
      content: 'The 64KB chunk streaming test just passed with zero backpressure drops!',
      media_type: 'text',
      is_view_once: false,
      deleted_for_everyone: false,
      created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    },
  },
  {
    id: 'conv-002',
    type: 'direct',
    title: 'Elena Rostova',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    unread_count: 0,
    other_user: {
      id: 'user-003',
      email: 'elena@example.com',
      display_name: 'Elena Rostova',
      bio: 'UI designer & nature photographer 📷',
      avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
      theme_accent: 'emerald',
      chat_background_url: '',
      role: 'user',
      is_banned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    last_message: {
      id: 'msg-002',
      conversation_id: 'conv-002',
      sender_id: 'user-003',
      content: 'Sent a View Once photo',
      media_type: 'image',
      media_url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800',
      is_view_once: true,
      viewed_at: null,
      deleted_for_everyone: false,
      created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    },
  },
  {
    id: 'conv-003',
    type: 'group',
    title: 'Zero-Cost Monorepo Team',
    avatar_url: null,
    created_at: new Date(Date.now() - 3600000 * 72).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    unread_count: 0,
    last_message: {
      id: 'msg-003',
      conversation_id: 'conv-003',
      sender_id: 'user-004',
      content: 'Marcus: We verified the 500MB DB limit and RLS policies.',
      media_type: 'text',
      is_view_once: false,
      deleted_for_everyone: false,
      created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    },
  },
  {
    id: 'conv-004',
    type: 'direct',
    title: 'Sarah Chen',
    avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
    created_at: new Date(Date.now() - 3600000 * 96).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    unread_count: 1,
    other_user: {
      id: 'user-005',
      email: 'sarah@example.com',
      display_name: 'Sarah Chen',
      bio: 'LiveKit Cloud & WebRTC VoIP specialist 🎙️',
      avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
      theme_accent: 'crimson',
      chat_background_url: '',
      role: 'user',
      is_banned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    last_message: {
      id: 'msg-004',
      conversation_id: 'conv-004',
      sender_id: 'user-005',
      content: 'Can we jump on a quick LiveKit video call to test VP8 codec?',
      media_type: 'text',
      is_view_once: false,
      deleted_for_everyone: false,
      created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    },
  },
];

export default function MessengerHomePage() {
  const { config } = useTheme();

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Navigation State
  const [activeScreen, setActiveScreen] = useState<'chats' | 'chat' | 'profile'>('chats');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Conversations State
  const [conversations, setConversations] = useState<Conversation[]>(INITIAL_MOCK_CONVERSATIONS);

  // Modals State
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<{
    isOpen: boolean;
    callType: 'audio' | 'video';
    roomName: string;
    participantIdentity: string;
    participantName: string;
    remoteParticipantName?: string;
    remoteParticipantAvatar?: string;
  } | null>(null);
  const [activeP2PTransfer, setActiveP2PTransfer] = useState<{
    isOpen: boolean;
    fileName: string;
    fileSize: number;
    isSender: boolean;
    progress: any;
  } | null>(null);

  // Check auth session on mount
  useEffect(() => {
    let isMounted = true;

    async function checkAuthSession() {
      try {
        // 1. Check live Supabase session if configured with token expiration protection
        if (isLiveSupabaseConfigured()) {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          let currentSession = sessionData?.session;

          if (sessionError) {
            console.warn('Error fetching Supabase session:', sessionError);
          }

          // Proactive token expiration handling: refresh if expired or within 60s of expiring
          if (currentSession) {
            const expiresAt = currentSession.expires_at || 0;
            const isExpired = expiresAt * 1000 <= Date.now() + 60000;
            if (isExpired) {
              const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
              if (refreshError || !refreshData.session) {
                console.warn('Session token refresh failed:', refreshError);
                currentSession = null;
              } else {
                currentSession = refreshData.session;
              }
            }
          }

          if (currentSession?.user) {
            const authUser = currentSession.user;
            let profile: User | null = null;
            try {
              const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', authUser.id)
                .single();
              if (!error && data) {
                profile = data as User;
              }
            } catch (profileErr) {
              console.warn('Profile fetch notice:', profileErr);
            }

            if (isMounted) {
              if (profile) {
                setCurrentUser(profile);
              } else {
                setCurrentUser({
                  id: authUser.id,
                  email: authUser.email || '',
                  display_name:
                    authUser.user_metadata?.full_name ||
                    authUser.user_metadata?.name ||
                    authUser.email?.split('@')[0] ||
                    'User',
                  bio: '',
                  avatar_url:
                    authUser.user_metadata?.avatar_url ||
                    authUser.user_metadata?.picture ||
                    '',
                  theme_accent: 'violet-pink',
                  chat_background_url: '',
                  role: 'user',
                  is_banned: false,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
              }
              setIsAuthenticated(true);
              setIsLoadingAuth(false);
              return;
            }
          }
        }

        // 2. Check local demo session storage
        if (typeof window !== 'undefined') {
          try {
            const cachedSession = localStorage.getItem('messenger_demo_session');
            if (cachedSession) {
              const parsedUser = JSON.parse(cachedSession) as User;
              if (parsedUser && typeof parsedUser === 'object' && parsedUser.id) {
                if (isMounted) {
                  setCurrentUser(parsedUser);
                  setIsAuthenticated(true);
                  setIsLoadingAuth(false);
                  return;
                }
              }
            }
          } catch (e) {
            console.warn('Failed to parse cached session', e);
          }
        }

        // 3. Not authenticated
        if (isMounted) {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setIsLoadingAuth(false);
        }
      } catch (err) {
        console.error('Auth check error:', err);
        if (isMounted) {
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
        }
      }
    }

    checkAuthSession();

    // Listen to Supabase auth state changes
    if (isLiveSupabaseConfigured()) {
      const { data: authListener } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          try {
            if (session?.user) {
              const authUser = session.user;
              let profile: User | null = null;
              try {
                const { data } = await supabase
                  .from('users')
                  .select('*')
                  .eq('id', authUser.id)
                  .single();
                if (data) profile = data as User;
              } catch (fetchErr) {
                console.warn('Failed to fetch profile on auth state change:', fetchErr);
              }

              if (isMounted) {
                if (profile) {
                  setCurrentUser(profile);
                } else {
                  setCurrentUser({
                    id: authUser.id,
                    email: authUser.email || '',
                    display_name:
                      authUser.user_metadata?.full_name ||
                      authUser.user_metadata?.name ||
                      authUser.email?.split('@')[0] ||
                      'User',
                    bio: '',
                    avatar_url:
                      authUser.user_metadata?.avatar_url ||
                      authUser.user_metadata?.picture ||
                      '',
                    theme_accent: 'violet-pink',
                    chat_background_url: '',
                    role: 'user',
                    is_banned: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  });
                }
                setIsAuthenticated(true);
                setIsLoadingAuth(false);
              }
            } else {
              // SIGNED_OUT or session expired / invalidated
              if (isMounted) {
                setIsAuthenticated(false);
                setCurrentUser(null);
                setIsLoadingAuth(false);
              }
            }
          } catch (e) {
            console.error('Error handling auth state change:', e);
            if (isMounted) {
              setIsLoadingAuth(false);
            }
          }
        }
      );

      return () => {
        isMounted = false;
        authListener?.subscription?.unsubscribe();
      };
    } else {
      return () => {
        isMounted = false;
      };
    }
  }, []);

  // Initialize Data & Supabase Sync
  useEffect(() => {
    if (!isAuthenticated || !currentUser) {
      return;
    }

    if (!isLiveSupabaseConfigured()) {
      setConversations(INITIAL_MOCK_CONVERSATIONS);
      return;
    }

    async function loadSupabaseData() {
      try {
        // Fetch user conversations
        const { data: convData } = await supabase
          .from('conversation_participants')
          .select(`
            conversation:conversations (
              id, type, title, avatar_url, created_at, updated_at
            )
          `)
          .eq('user_id', currentUser!.id);

        if (convData && convData.length > 0) {
          const loadedConvs = convData
            .map((c: any) => c.conversation)
            .filter(Boolean) as Conversation[];
          setConversations(loadedConvs);
        }
      } catch (err) {
        console.warn('Supabase sync notice: fallback to local cache', err);
      }
    }

    loadSupabaseData();

    // Realtime changes listener for new messages & updates (viewed_at, reactions, etc.)
    const channel = supabase
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: any) => {
          const newMsg = payload.new as Message;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message: newMsg,
                    updated_at: newMsg.created_at,
                    unread_count:
                      newMsg.sender_id === currentUser?.id
                        ? c.unread_count || 0
                        : (c.unread_count || 0) + 1,
                  }
                : c
            )
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload: any) => {
          const updatedMsg = payload.new as Message;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === updatedMsg.conversation_id && c.last_message?.id === updatedMsg.id
                ? {
                    ...c,
                    last_message: updatedMsg,
                  }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, currentUser?.id]);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  // Auth Handlers
  const handleDemoSignIn = useCallback((user: User) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setIsLoadingAuth(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('messenger_demo_session');
        localStorage.removeItem('messenger_session');
      } catch (storageErr) {
        console.warn('Error clearing localStorage on sign out:', storageErr);
      }
    }
    if (isLiveSupabaseConfigured()) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('Error signing out of Supabase:', err);
      }
    }
    setIsAuthenticated(false);
    setCurrentUser(null);
    setActiveConversationId(null);
    setActiveScreen('chats');
  }, []);

  // Handlers
  const handleSelectConversation = useCallback((convId: string) => {
    setActiveConversationId(convId);
    setActiveScreen('chat');
    // Clear unread badge
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
    );
  }, []);

  const handleStartCall = useCallback(
    (type: 'audio' | 'video') => {
      if (!activeConversation || !currentUser) return;
      setActiveCall({
        isOpen: true,
        callType: type,
        roomName: `room-${activeConversation.id}`,
        participantIdentity: currentUser.id,
        participantName: currentUser.display_name,
        remoteParticipantName:
          activeConversation.title ||
          activeConversation.other_user?.display_name ||
          'Friend',
        remoteParticipantAvatar:
          activeConversation.avatar_url ||
          activeConversation.other_user?.avatar_url ||
          '',
      });
    },
    [activeConversation, currentUser]
  );

  const handleUpdateUser = useCallback((updated: Partial<User>) => {
    setCurrentUser((prev) => (prev ? { ...prev, ...updated } : null));
  }, []);

  // Authentication Access Gate: strictly block access if unauthenticated
  if (isLoadingAuth) {
    return (
      <div className="h-screen w-screen bg-[#000000] flex flex-col items-center justify-center text-white space-y-4 select-none">
        <div className="w-12 h-12 rounded-full border-2 border-[#E1306C] border-t-transparent animate-spin" />
        <span className="text-xs text-[#A0A0A0] tracking-wide">
          Securing session...
        </span>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    return <GoogleSignInGate onDemoSignIn={handleDemoSignIn} />;
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-black text-white selection:bg-[#E1306C] selection:text-white flex flex-col">
      {/* Desktop Responsive Split View (>= md: 768px) */}
      <div className="hidden md:flex h-full w-full overflow-hidden">
        {/* Left Sidebar (Screen 1 or Screen 3) */}
        <div className="w-80 lg:w-[380px] h-full flex flex-col border-r border-[#2A2A2A] bg-black flex-shrink-0">
          {activeScreen === 'profile' ? (
            <ProfilePage
              currentUser={currentUser}
              onBack={() => setActiveScreen('chats')}
              onUpdateUser={handleUpdateUser}
              onSignOut={handleSignOut}
            />
          ) : (
            <ChatsList
              conversations={conversations}
              activeConversationId={activeConversationId}
              currentUser={currentUser}
              onSelectConversation={handleSelectConversation}
              onOpenProfile={() => setActiveScreen('profile')}
              onOpenNewChat={() => setIsNewChatOpen(true)}
            />
          )}
        </div>

        {/* Right Main Pane (Screen 2: ChatInterface or Empty Canvas) */}
        <div className="flex-1 h-full flex flex-col bg-black relative">
          {activeConversation ? (
            <ChatInterface
              conversation={activeConversation}
              currentUser={currentUser}
              onBack={() => {
                setActiveConversationId(null);
                setActiveScreen('chats');
              }}
              onStartCall={handleStartCall}
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-black">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-2xl ${config.gradientClass}`}
              >
                <MessageSquarePlus className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
                Your Messages
              </h2>
              <p className="text-sm text-[#A0A0A0] max-w-sm mb-6 leading-relaxed">
                Send private photos, end-to-end P2P files up to 1 GB, voice notes, and make high-definition LiveKit calls with zero server costs.
              </p>
              <button
                onClick={() => setIsNewChatOpen(true)}
                className={`px-6 py-2.5 rounded-full font-semibold text-sm text-white shadow-lg transition-transform hover:scale-105 active:scale-95 ${config.gradientClass}`}
              >
                Send Message
              </button>

              <div className="mt-12 flex items-center space-x-6 text-xs text-[#666666]">
                <div className="flex items-center space-x-1.5">
                  <Shield className="w-4 h-4 text-[#10B981]" />
                  <span>Permanent Audit Retention</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <Zap className="w-4 h-4 text-[#E1306C]" />
                  <span>1 GB WebRTC Chunk Streaming</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Responsive Switcher (< md: 768px) */}
      <div className="md:hidden h-full w-full overflow-hidden flex flex-col">
        {activeScreen === 'chats' && (
          <ChatsList
            conversations={conversations}
            activeConversationId={activeConversationId}
            currentUser={currentUser}
            onSelectConversation={handleSelectConversation}
            onOpenProfile={() => setActiveScreen('profile')}
            onOpenNewChat={() => setIsNewChatOpen(true)}
          />
        )}

        {activeScreen === 'chat' && activeConversation && (
          <ChatInterface
            conversation={activeConversation}
            currentUser={currentUser}
            onBack={() => {
              setActiveConversationId(null);
              setActiveScreen('chats');
            }}
            onStartCall={handleStartCall}
          />
        )}

        {activeScreen === 'profile' && (
          <ProfilePage
            currentUser={currentUser}
            onBack={() => setActiveScreen('chats')}
            onUpdateUser={handleUpdateUser}
            onSignOut={handleSignOut}
          />
        )}
      </div>

      {/* Global Modals */}
      {isNewChatOpen && (
        <NewChatModal
          isOpen={isNewChatOpen}
          onClose={() => setIsNewChatOpen(false)}
          currentUser={currentUser}
          existingConversations={conversations}
          onSelectConversation={(id) => {
            handleSelectConversation(id);
            setIsNewChatOpen(false);
          }}
        />
      )}

      {activeCall && activeCall.isOpen && (
        <CallModal
          isOpen={activeCall.isOpen}
          onClose={() => setActiveCall(null)}
          callType={activeCall.callType}
          roomName={activeCall.roomName}
          participantIdentity={activeCall.participantIdentity}
          participantName={activeCall.participantName}
          remoteParticipantName={activeCall.remoteParticipantName}
          remoteParticipantAvatar={activeCall.remoteParticipantAvatar}
        />
      )}

      {activeP2PTransfer && activeP2PTransfer.isOpen && (
        <P2PTransferModal
          isOpen={activeP2PTransfer.isOpen}
          onClose={() => setActiveP2PTransfer(null)}
          fileName={activeP2PTransfer.fileName}
          fileSize={activeP2PTransfer.fileSize}
          isSender={activeP2PTransfer.isSender}
          progress={activeP2PTransfer.progress}
        />
      )}
    </main>
  );
}
