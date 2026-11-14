'use client';

import React, { useState } from 'react';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { User } from '@/types/database';
import { Shield, Zap, Video, Lock, Sparkles, AlertCircle } from 'lucide-react';

interface GoogleSignInGateProps {
  onDemoSignIn?: (user: User) => void;
}

export default function GoogleSignInGate({ onDemoSignIn }: GoogleSignInGateProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (isLiveSupabaseConfigured()) {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          },
        });

        if (error) {
          throw error;
        }
      } else {
        // Simulated Google OAuth session when offline / demo environment
        const simulatedUser: User = {
          id: 'user-google-demo',
          email: 'alex.morgan@gmail.com',
          display_name: 'Alex Morgan',
          bio: 'Building $0-cost private messenger apps with native Android & Web PWA 🚀',
          avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          theme_accent: 'violet-pink',
          chat_background_url: '',
          role: 'user',
          is_banned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Persist demo session to localStorage so refreshes keep user signed in
        if (typeof window !== 'undefined') {
          localStorage.setItem('messenger_demo_session', JSON.stringify(simulatedUser));
        }

        if (onDemoSignIn) {
          onDemoSignIn(simulatedUser);
        }
      }
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setErrorMessage(err.message || 'Failed to complete Google Sign-In. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#000000] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Background Ambient Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-tr from-[#8A2387]/20 via-[#E1306C]/20 to-[#F27121]/20 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Glass Card */}
      <div className="w-full max-w-md bg-[#121212]/90 border border-[#2A2A2A] rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative z-10 flex flex-col items-center text-center">
        {/* Glowing App Icon */}
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-[#8A2387] via-[#E1306C] to-[#F27121] p-0.5 shadow-xl shadow-[#E1306C]/30 flex items-center justify-center">
            <div className="w-full h-full bg-[#000000] rounded-[14px] flex items-center justify-center">
              <Lock className="w-9 h-9 text-white animate-pulse" />
            </div>
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-tr from-[#E1306C] to-[#F27121] flex items-center justify-center shadow">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        </div>

        {/* Brand Titles */}
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
          Private Messenger
        </h1>
        <p className="text-sm text-[#A0A0A0] leading-relaxed mb-8 max-w-xs">
          Sign in with your Google account to unlock private messaging, 1 GB P2P chunk transfers, and LiveKit audio & video calls.
        </p>

        {/* Feature Highlights Grid */}
        <div className="w-full grid grid-cols-3 gap-2.5 mb-8 text-left">
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-3 flex flex-col items-center text-center">
            <Shield className="w-5 h-5 text-[#10B981] mb-1.5" />
            <span className="text-[11px] font-semibold text-white">View Once</span>
            <span className="text-[9px] text-[#777777]">Self-destructing</span>
          </div>

          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-3 flex flex-col items-center text-center">
            <Zap className="w-5 h-5 text-[#E1306C] mb-1.5" />
            <span className="text-[11px] font-semibold text-white">1 GB P2P</span>
            <span className="text-[9px] text-[#777777]">Direct transfer</span>
          </div>

          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-3 flex flex-col items-center text-center">
            <Video className="w-5 h-5 text-[#0084FF] mb-1.5" />
            <span className="text-[11px] font-semibold text-white">HD Calls</span>
            <span className="text-[9px] text-[#777777]">LiveKit Cloud</span>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="w-full mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center space-x-2 text-left">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Google Sign-In Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full py-3.5 px-6 rounded-2xl bg-white hover:bg-neutral-100 text-black font-semibold text-sm flex items-center justify-center space-x-3 transition-transform active:scale-95 shadow-xl hover:shadow-white/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {/* Multicolored Google "G" SVG Icon */}
          <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>{isLoading ? 'Connecting with Google...' : 'Sign in with Google'}</span>
        </button>

        {/* Security & Free-Tier Note */}
        <p className="mt-5 text-[11px] text-[#666666]">
          Protected by Google OAuth 2.0 & Supabase Auth.
          <br />
          No password stored. End-to-end encrypted sessions.
        </p>
      </div>
    </div>
  );
}

export { GoogleSignInGate };
