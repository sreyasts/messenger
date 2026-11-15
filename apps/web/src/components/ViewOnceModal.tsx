'use client';

import React, { useEffect, useState } from 'react';
import { X, Flame, ShieldAlert, Sparkles } from 'lucide-react';
import { Message } from '@/types/database';

interface ViewOnceModalProps {
  isOpen?: boolean;
  message: Message | null;
  onClose: () => void;
  onViewed?: (messageId: string) => void | Promise<void>;
  onMarkAsViewed?: (messageId: string) => void | Promise<void>;
}

export default function ViewOnceModal({
  isOpen = true,
  message,
  onClose,
  onViewed,
  onMarkAsViewed,
}: ViewOnceModalProps) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!isOpen || !message || message.viewed_at) return;

    // Immediately trigger server audit update: viewed_at = NOW() (call once)
    if (onViewed) {
      onViewed(message.id);
    } else if (onMarkAsViewed) {
      onMarkAsViewed(message.id);
    }

    // Ephemeral 30s auto-dismiss progress bar
    const durationMs = 30000;
    const intervalMs = 200;
    const decrement = (intervalMs / durationMs) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - decrement;
      });
    }, intervalMs);

    // Keyboard ESC listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, message, onViewed, onMarkAsViewed, onClose]);

  if (!isOpen || !message || message.viewed_at) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#000000] select-none touch-none"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Top Header Bar & Progress Bar */}
      <div className="w-full">
        {/* Progress countdown bar */}
        <div className="w-full h-1 bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#E1306C] to-amber-400 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 flex items-center justify-center text-xs font-bold">
              1
            </div>
            <span className="text-xs font-semibold text-white tracking-wide">
              View Once Media
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Ephemeral Media Display Stage */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        {message.media_type === 'video' ? (
          <video
            src={message.media_url}
            autoPlay
            playsInline
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        ) : message.media_type === 'text' ? (
          <div className="max-w-md w-full p-8 rounded-3xl bg-[#141414] border border-[#2A2A2A] shadow-2xl shadow-[#E1306C]/10 text-center space-y-4 animate-fade-in relative">
            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#E1306C]/20 to-[#F27121]/20 text-[#FF4D94] border border-[#E1306C]/40 flex items-center justify-center mx-auto text-lg font-bold shadow-inner">
              1
            </div>
            <p className="text-lg text-white font-medium leading-relaxed whitespace-pre-wrap select-none break-words">
              {message.content}
            </p>
            <span className="text-xs text-[#777777] block">
              Ephemeral View-Once Message
            </span>
          </div>
        ) : (
          <img
            src={message.media_url}
            alt="View Once Ephemeral Media"
            draggable={false}
            className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl pointer-events-none select-none"
          />
        )}
      </div>

      {/* Bottom Privacy & Security Banner */}
      <div className="p-4 text-center bg-gradient-to-t from-black/90 to-transparent flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 text-xs text-[#A0A0A0]">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>Screenshots and screen recordings are restricted</span>
        </div>
        <p className="text-[10px] text-[#666666]">
          This media disappears forever once closed. Full audit records are permanently retained in server database.
        </p>
      </div>
    </div>
  );
}

export { ViewOnceModal };
