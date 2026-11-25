'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { User, Conversation, Message, ConversationParticipant, Call } from '@/types/database';
import ChatsList from '@/components/ChatsList';
import ChatInterface from '@/components/ChatInterface';
import ProfilePage from '@/components/ProfilePage';
import NewChatModal from '@/components/NewChatModal';
import CallModal from '@/components/CallModal';
import GoogleSignInGate from '@/components/GoogleSignInGate';
import { MessageSquarePlus, Shield, Zap } from 'lucide-react';

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
      content: '',
      media_type: 'image',
      media_url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800',
      file_name: 'mountain_sunset.jpg',
      file_size: 428190,
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

function sortConversationsByLatest(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const timeA = new Date(a.last_message?.created_at || a.updated_at || a.created_at).getTime();
    const timeB = new Date(b.last_message?.created_at || b.updated_at || b.created_at).getTime();
    return timeB - timeA;
  });
}

export default function MessengerHomePage() {
  const { config } = useTheme();

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Navigation State
  const [activeScreen, setActiveScreen] = useState<'chats' | 'chat' | 'profile'>('chats');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  // Conversations State
  const [conversations, setConversations] = useState<Conversation[]>(
    isLiveSupabaseConfigured() ? [] : INITIAL_MOCK_CONVERSATIONS
  );

  // Modals State
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<{
    isOpen: boolean;
    callType: 'audio' | 'video';
    roomName: string;
    conversationId: string;
    callId?: string;
    isIncoming?: boolean;
    participantIdentity: string;
    participantName: string;
    remoteParticipantName?: string;
    remoteParticipantAvatar?: string;
  } | null>(null);
  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const buildFallbackUser = useCallback((authUser: any): User => {
    return {
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
    };
  }, []);

  const resolveSupabaseUserProfile = useCallback(
    async (authUser: any): Promise<User | null> => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single();
        if (!error && data) {
          return data as User;
        }
      } catch (err) {
        console.warn('Profile fetch notice:', err);
      }
      return buildFallbackUser(authUser);
    },
    [buildFallbackUser]
  );

  // Check auth session on mount without duplicate concurrent profile queries
  useEffect(() => {
    let isMounted = true;
    let initialResolved = false;

    async function checkAuthSession() {
      try {
        if (isLiveSupabaseConfigured()) {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          let currentSession = sessionData?.session;

          if (sessionError) {
            console.warn('Error fetching Supabase session:', sessionError);
          }

          if (currentSession) {
            const expiresAt = currentSession.expires_at || 0;
            if (expiresAt * 1000 <= Date.now() + 60000) {
              const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
              currentSession = refreshError || !refreshData.session ? null : refreshData.session;
            }
          }

          if (currentSession?.user) {
            const profile = await resolveSupabaseUserProfile(currentSession.user);
            if (!isMounted) return;
            initialResolved = true;

            if (profile?.is_banned) {
              await supabase.auth.signOut().catch(() => {});
              setAuthError('Your account has been suspended by an administrator.');
              setIsAuthenticated(false);
              setCurrentUser(null);
            } else {
              setAuthError(null);
              setCurrentUser(profile);
              setIsAuthenticated(true);
            }
            setIsLoadingAuth(false);
            return;
          }
        } else if (typeof window !== 'undefined') {
          try {
            const cachedSession = localStorage.getItem('messenger_demo_session');
            if (cachedSession) {
              const parsedUser = JSON.parse(cachedSession) as User;
              if (parsedUser && typeof parsedUser === 'object' && parsedUser.id) {
                if (isMounted) {
                  initialResolved = true;
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

        if (isMounted && !initialResolved) {
          initialResolved = true;
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

    if (isLiveSupabaseConfigured()) {
      const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;
        // Skip duplicate INITIAL_SESSION if checkAuthSession already handled it
        if (event === 'INITIAL_SESSION' && initialResolved) return;

        if (session?.user) {
          const profile = await resolveSupabaseUserProfile(session.user);
          if (!isMounted) return;
          if (profile?.is_banned) {
            await supabase.auth.signOut().catch(() => {});
            setAuthError('Your account has been suspended by an administrator.');
            setIsAuthenticated(false);
            setCurrentUser(null);
          } else {
            setAuthError(null);
            setCurrentUser(profile);
            setIsAuthenticated(true);
          }
          setIsLoadingAuth(false);
        } else {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setIsLoadingAuth(false);
        }
      });

      return () => {
        isMounted = false;
        authListener?.subscription?.unsubscribe();
      };
    }

    return () => {
      isMounted = false;
    };
  }, [resolveSupabaseUserProfile]);

  // Load conversations with participants (other_user), last_message, and unread counts
  const loadSupabaseConversations = useCallback(async (userId: string) => {
    try {
      const { data: myPartRows, error: partError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at, conversation:conversations(*)')
        .eq('user_id', userId);

      if (partError || !myPartRows) {
        console.warn('Could not load conversations:', partError?.message);
        return;
      }

      const rawConvs = myPartRows
        .map((r: any) => ({
          conv: r.conversation as Conversation | null,
          lastReadAt: r.last_read_at as string,
        }))
        .filter((x) => !!x.conv);

      if (rawConvs.length === 0) {
        setConversations([]);
        return;
      }

      const convIds = rawConvs.map((x) => x.conv!.id);

      // Fetch all participants for these conversations to resolve other_user
      const { data: allParticipants } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, last_read_at, joined_at, user:users(*)')
        .in('conversation_id', convIds);

      // Fetch recent messages across these conversations
      const { data: recentMessages } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(200);

      const participantsByConv = new Map<string, ConversationParticipant[]>();
      for (const p of (allParticipants || []) as any[]) {
        const list = participantsByConv.get(p.conversation_id) || [];
        list.push(p as ConversationParticipant);
        participantsByConv.set(p.conversation_id, list);
      }

      const lastMessageByConv = new Map<string, Message>();
      const messagesByConv = new Map<string, Message[]>();
      for (const m of (recentMessages || []) as Message[]) {
        if (!lastMessageByConv.has(m.conversation_id)) {
          lastMessageByConv.set(m.conversation_id, m);
        }
        const arr = messagesByConv.get(m.conversation_id) || [];
        arr.push(m);
        messagesByConv.set(m.conversation_id, arr);
      }

      const hydrated: Conversation[] = rawConvs.map(({ conv, lastReadAt }) => {
        const parts = participantsByConv.get(conv!.id) || [];
        const otherPart = parts.find((p) => p.user_id !== userId);
        const convMsgs = messagesByConv.get(conv!.id) || [];
        const lastReadMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
        const unreadCount = convMsgs.filter(
          (m) => m.sender_id !== userId && new Date(m.created_at).getTime() > lastReadMs
        ).length;

        return {
          ...conv!,
          participants: parts,
          other_user: otherPart?.user,
          last_message: lastMessageByConv.get(conv!.id) || null,
          unread_count: conv!.id === activeConversationIdRef.current ? 0 : unreadCount,
        };
      });

      setConversations(sortConversationsByLatest(hydrated));
    } catch (err) {
      console.warn('Supabase sync notice:', err);
    }
  }, []);

  // Initialize Data & Realtime Sync
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    if (!isLiveSupabaseConfigured()) {
      setConversations(sortConversationsByLatest(INITIAL_MOCK_CONVERSATIONS));
      return;
    }

    loadSupabaseConversations(currentUser.id);

    const channel = supabase
      .channel(`home:sync:${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: any) => {
          const newMsg = payload.new as Message;
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === newMsg.conversation_id);
            if (!exists) {
              // Newly created conversation by another participant
              loadSupabaseConversations(currentUser.id);
              return prev;
            }
            const isActiveChat = newMsg.conversation_id === activeConversationIdRef.current;
            const updated = prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message: newMsg,
                    updated_at: newMsg.created_at,
                    unread_count:
                      isActiveChat || newMsg.sender_id === currentUser.id
                        ? 0
                        : (c.unread_count || 0) + 1,
                  }
                : c
            );
            return sortConversationsByLatest(updated);
          });
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
                ? { ...c, last_message: { ...c.last_message, ...updatedMsg } }
                : c
            )
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${currentUser.id}`,
        },
        () => {
          loadSupabaseConversations(currentUser.id);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls' },
        (payload: any) => {
          const incomingCall = payload.new as Call;
          if (
            !incomingCall ||
            incomingCall.caller_id === currentUser.id ||
            incomingCall.status !== 'ringing' ||
            activeCallRef.current?.isOpen
          ) {
            return;
          }
          const matchingConv = conversationsRef.current.find(
            (c) => c.id === incomingCall.conversation_id
          );
          if (!matchingConv) return;
          setActiveCall({
            isOpen: true,
            callType: incomingCall.call_type,
            roomName: incomingCall.room_name || `conversation-${incomingCall.conversation_id}`,
            conversationId: incomingCall.conversation_id,
            callId: incomingCall.id,
            isIncoming: true,
            participantIdentity: currentUser.id,
            participantName: currentUser.display_name,
            remoteParticipantName:
              matchingConv.title || matchingConv.other_user?.display_name || 'Incoming Call',
            remoteParticipantAvatar:
              matchingConv.avatar_url || matchingConv.other_user?.avatar_url || '',
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, currentUser, loadSupabaseConversations]);

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
      } catch {}
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

  // Conversation selection
  const handleSelectConversation = useCallback(
    (convId: string, createdConversation?: Conversation) => {
      if (createdConversation) {
        setConversations((prev) => {
          if (prev.some((c) => c.id === createdConversation.id)) return prev;
          return sortConversationsByLatest([createdConversation, ...prev]);
        });
      } else {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
        );
      }

      setActiveConversationId(convId);
      setActiveScreen('chat');

      if (isLiveSupabaseConfigured() && currentUser) {
        supabase
          .from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', convId)
          .eq('user_id', currentUser.id)
          .then(() => {});
      }
    },
    [currentUser]
  );

  const handleMessageActivity = useCallback((conversationId: string, lastMessage: Message) => {
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === conversationId
          ? { ...c, last_message: lastMessage, updated_at: lastMessage.created_at, unread_count: 0 }
          : c
      );
      return sortConversationsByLatest(updated);
    });
  }, []);

  const handleStartCall = useCallback(
    (type: 'audio' | 'video') => {
      if (!activeConversation || !currentUser) return;
      setActiveCall({
        isOpen: true,
        callType: type,
        roomName: `conversation-${activeConversation.id}`,
        conversationId: activeConversation.id,
        isIncoming: false,
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

  if (isLoadingAuth) {
    return (
      <div className="h-[100dvh] w-screen bg-[#000000] flex flex-col items-center justify-center text-white space-y-4 select-none">
        <div className="w-12 h-12 rounded-full border-2 border-[#E1306C] border-t-transparent animate-spin" />
        <span className="text-xs text-[#A0A0A0] tracking-wide">Securing session...</span>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    return <GoogleSignInGate onDemoSignIn={handleDemoSignIn} externalError={authError} />;
  }

  return (
    <main className="h-[100dvh] w-screen overflow-hidden bg-black text-white selection:bg-[#E1306C] selection:text-white flex flex-col">
      {/* Desktop Split View */}
      <div className="hidden md:flex h-full w-full overflow-hidden">
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
              onSelectConversation={(id) => handleSelectConversation(id)}
              onOpenProfile={() => setActiveScreen('profile')}
              onOpenNewChat={() => setIsNewChatOpen(true)}
            />
          )}
        </div>

        <div className="flex-1 h-full flex flex-col bg-black relative min-w-0">
          {activeConversation ? (
            <ChatInterface
              conversation={activeConversation}
              currentUser={currentUser}
              onBack={() => {
                setActiveConversationId(null);
                setActiveScreen('chats');
              }}
              onStartCall={handleStartCall}
              onMessageActivity={handleMessageActivity}
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-black">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-2xl ${config.gradientClass}`}
              >
                <MessageSquarePlus className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Your Messages</h2>
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

      {/* Mobile Responsive Switcher */}
      <div className="md:hidden h-full w-full overflow-hidden flex flex-col">
        {activeScreen === 'chats' && (
          <ChatsList
            conversations={conversations}
            activeConversationId={activeConversationId}
            currentUser={currentUser}
            onSelectConversation={(id) => handleSelectConversation(id)}
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
            onMessageActivity={handleMessageActivity}
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
          onSelectConversation={(id, createdConv) => {
            handleSelectConversation(id, createdConv);
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
          conversationId={activeCall.conversationId}
          callId={activeCall.callId}
          isIncoming={activeCall.isIncoming}
          participantIdentity={activeCall.participantIdentity}
          participantName={activeCall.participantName}
          remoteParticipantName={activeCall.remoteParticipantName}
          remoteParticipantAvatar={activeCall.remoteParticipantAvatar}
        />
      )}
    </main>
  );
}
