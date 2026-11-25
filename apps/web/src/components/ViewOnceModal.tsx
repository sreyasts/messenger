'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, ShieldAlert, ImageOff } from 'lucide-react';
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
  const [imageError, setImageError] = useState(false);
  const markedMessageIdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  const onViewedRef = useRef(onViewed);
  const onMarkAsViewedRef = useRef(onMarkAsViewed);

  onCloseRef.current = onClose;
  onViewedRef.current = onViewed;
  onMarkAsViewedRef.current = onMarkAsViewed;

  useEffect(() => {
    setProgress(100);
    setImageError(false);
  }, [message?.id]);

  useEffect(() => {
    if (!isOpen || !message || message.viewed_at) return;

    // Trigger DB audit update once per message open (sets viewed_at = NOW(), keeps row & storage intact)
    if (markedMessageIdRef.current !== message.id) {
      markedMessageIdRef.current = message.id;
      if (onViewedRef.current) {
        onViewedRef.current(message.id);
      } else if (onMarkAsViewedRef.current) {
        onMarkAsViewedRef.current(message.id);
      }
    }

    const durationMs = 30000;
    const intervalMs = 200;
    const decrement = (intervalMs / durationMs) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          onCloseRef.current();
          return 0;
        }
        return prev - decrement;
      });
    }, intervalMs);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, message?.id, message?.viewed_at]);

  if (!isOpen || !message || message.viewed_at) return null;

  const isPhoto = message.media_type === 'image' && !!message.media_url;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#000000] select-none touch-none"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Top Header Bar & Progress Bar */}
      <div className="w-full">
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
              View Once Photo
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Close View Once Photo"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Ephemeral Photo Stage */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        {isPhoto && !imageError ? (
          <img
            src={message.media_url}
            alt="View Once Ephemeral Photo"
            draggable={false}
            onError={() => setImageError(true)}
            className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl pointer-events-none select-none"
          />
        ) : (
          <div className="max-w-sm w-full p-8 rounded-3xl bg-[#141414] border border-[#2A2A2A] text-center space-y-3">
            <ImageOff className="w-10 h-10 text-[#666666] mx-auto" />
            <p className="text-sm font-semibold text-white">
              Photo unavailable
            </p>
            <p className="text-xs text-[#888888]">
              This View Once photo has already been opened or could not be loaded.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Privacy & Audit Retention Banner */}
      <div className="p-4 text-center bg-gradient-to-t from-black/90 to-transparent flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 text-xs text-[#A0A0A0]">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>Screenshots and screen recordings are restricted</span>
        </div>
        <p className="text-[10px] text-[#666666]">
          This photo cannot be reopened once closed. Audit records remain preserved in database.
        </p>
      </div>
    </div>
  );
}

export { ViewOnceModal };
