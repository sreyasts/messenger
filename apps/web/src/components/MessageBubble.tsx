'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  Sparkles,
  Ban,
  Reply,
  Play,
  Pause,
  FileText,
  Download,
  Flame,
  CheckCircle2,
} from 'lucide-react';
import { Message, Reaction, User } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';

interface MessageBubbleProps {
  message: Message;
  isOwn?: boolean;
  currentUser?: User;
  currentUserId?: string;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  showAvatar?: boolean;
  showSenderName?: boolean;
  onReply?: (message: Message) => void;
  onOpenContextMenu?: (message: Message, e: React.MouseEvent | React.TouchEvent) => void;
  onContextMenu?: (e: React.MouseEvent | React.TouchEvent, message: Message) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onOpenViewOnce?: (message: Message) => void;
  onOpenP2PHUD?: (transferId: string) => void;
  onScrollToMessage?: (messageId: string) => void;
}

export default function MessageBubble({
  message,
  isOwn,
  currentUser,
  currentUserId,
  isFirstInGroup = true,
  isLastInGroup = true,
  showAvatar = false,
  showSenderName = false,
  onReply,
  onOpenContextMenu,
  onContextMenu,
  onAddReaction,
  onReact,
  onOpenViewOnce,
  onOpenP2PHUD,
  onScrollToMessage,
}: MessageBubbleProps) {
  const { config } = useTheme();
  const effectiveUserId = currentUserId || currentUser?.id || '';
  const isOutgoing = isOwn !== undefined ? isOwn : message.sender_id === effectiveUserId;

  // Swipe-to-reply state
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const isSwiping = useRef(false);

  // Long-press timer state
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // Voice note audio playback state
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Format timestamp (e.g. 10:45 AM)
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Group reactions by emoji
  const groupedReactions = useMemo(() => {
    if (!message.reactions || message.reactions.length === 0) return [];
    const map = new Map<string, { count: number; userReacted: boolean }>();
    message.reactions.forEach((r) => {
      const existing = map.get(r.emoji) || { count: 0, userReacted: false };
      existing.count += 1;
      if (r.user_id === effectiveUserId) existing.userReacted = true;
      map.set(r.emoji, existing);
    });
    return Array.from(map.entries()).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      userReacted: data.userReacted,
    }));
  }, [message.reactions, effectiveUserId]);

  const triggerContextMenu = (e: React.MouseEvent | React.TouchEvent) => {
    if (onOpenContextMenu) {
      onOpenContextMenu(message, e);
    } else if (onContextMenu) {
      onContextMenu(e, message);
    }
  };

  const triggerReaction = (emoji: string) => {
    if (onAddReaction) {
      onAddReaction(message.id, emoji);
    } else if (onReact) {
      onReact(message.id, emoji);
    }
  };

  // Touch handlers for swipe-to-reply & long-press
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchStartX(touch.clientX);
    setTouchStartY(touch.clientY);
    isSwiping.current = false;

    longPressTimer.current = setTimeout(() => {
      if (!isSwiping.current) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(25);
        }
        triggerContextMenu(e);
      }
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null || touchStartY === null) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    if (Math.abs(deltaY) > 25 && !isSwiping.current) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      return;
    }

    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }

    if (deltaX > 0 && deltaX < 120) {
      isSwiping.current = true;
      setSwipeOffset(deltaX);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (swipeOffset >= 60 && onReply) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15);
      }
      onReply(message);
    }
    setSwipeOffset(0);
    setTouchStartX(null);
    setTouchStartY(null);
    isSwiping.current = false;
  };

  const handleAudioToggle = () => {
    if (!audioRef.current) return;
    if (isPlayingAudio) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      audioRef.current.play();
      setIsPlayingAudio(true);
    }
  };

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current) return;
    const current = audioRef.current.currentTime;
    const total = audioRef.current.duration || 1;
    setAudioProgress((current / total) * 100);
  };

  const getCornerRounding = () => {
    if (isOutgoing) {
      if (isFirstInGroup && isLastInGroup) return 'rounded-2xl';
      if (isFirstInGroup) return 'rounded-2xl rounded-br-md';
      if (isLastInGroup) return 'rounded-2xl rounded-tr-md';
      return 'rounded-2xl rounded-r-md';
    } else {
      if (isFirstInGroup && isLastInGroup) return 'rounded-2xl';
      if (isFirstInGroup) return 'rounded-2xl rounded-bl-md';
      if (isLastInGroup) return 'rounded-2xl rounded-tl-md';
      return 'rounded-2xl rounded-l-md';
    }
  };

  return (
    <div
      className={`group relative flex w-full mb-1 select-none transition-transform ${
        isOutgoing ? 'justify-end' : 'justify-start'
      }`}
      style={{
        transform: swipeOffset > 0 ? `translateX(${Math.min(swipeOffset * 0.7, 70)}px)` : undefined,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        triggerContextMenu(e);
      }}
    >
      {/* Swipe to reply reveal indicator */}
      {swipeOffset > 20 && (
        <div
          className="absolute -left-10 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-[#1A1A1A] text-white border border-[#2A2A2A] shadow-md transition-opacity"
          style={{ opacity: Math.min(swipeOffset / 60, 1) }}
        >
          <Reply className="w-4 h-4 text-[#A0A0A0]" />
        </div>
      )}

      {/* Receiver avatar */}
      {!isOutgoing && showAvatar && (
        <div className="mr-2 flex-shrink-0 self-end mb-1">
          {message.sender?.avatar_url ? (
            <img
              src={message.sender.avatar_url}
              alt={message.sender.display_name}
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#242424] text-[#A0A0A0] text-xs font-medium flex items-center justify-center">
              {message.sender?.display_name?.slice(0, 1).toUpperCase() || '?'}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col max-w-[82%] sm:max-w-[70%]">
        {/* Sender name for group chats */}
        {!isOutgoing && showSenderName && message.sender?.display_name && (
          <span className="text-[11px] font-semibold text-[#E1306C] mb-0.5 ml-2">
            {message.sender.display_name}
          </span>
        )}

        {/* Message Bubble Container */}
        <div
          className={`relative px-3.5 py-2 shadow-sm transition-all ${getCornerRounding()} ${
            message.deleted_for_everyone
              ? 'bg-[#181818] border border-[#262626] text-[#A0A0A0]'
              : isOutgoing
              ? config.bubbleClass
              : 'bg-[#1E1E1E] text-white border border-[#2A2A2A]'
          }`}
        >
          {/* Quote Block for Replies */}
          {message.reply_to && !message.deleted_for_everyone && (
            <div
              onClick={() => onScrollToMessage?.(message.reply_to_id!)}
              className={`mb-2 p-2 rounded-lg text-xs cursor-pointer border-l-2 ${
                isOutgoing
                  ? 'bg-black/25 border-white/70 text-white/90 hover:bg-black/35'
                  : 'bg-[#141414] border-[#0084FF] text-[#A0A0A0] hover:bg-[#181818]'
              }`}
            >
              <div className="font-semibold text-white/95 truncate">
                {message.reply_to.sender?.display_name || 'Replied Message'}
              </div>
              <div className="line-clamp-1 opacity-80">
                {message.reply_to.is_view_once
                  ? 'View Once Media'
                  : message.reply_to.content ||
                    (message.reply_to.media_type !== 'text'
                      ? `[${message.reply_to.media_type}]`
                      : '')}
              </div>
            </div>
          )}

          {/* Soft-deleted placeholder */}
          {message.deleted_for_everyone ? (
            <div className="flex items-center gap-1.5 py-0.5 text-xs italic text-[#888888]">
              <Ban className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
              <span>This message was deleted</span>
            </div>
          ) : message.is_view_once ? (
            /* View Once Media Pill */
            <div className="py-1">
              {message.viewed_at ? (
                <div className="flex items-center gap-2 py-1.5 px-3 rounded-full bg-white/10 text-white/60 text-xs font-medium cursor-not-allowed">
                  <CheckCircle2 className="w-4 h-4 text-white/50" />
                  <span>Opened</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenViewOnce?.(message)}
                  className={`flex items-center gap-2 py-2 px-3.5 rounded-full text-xs font-semibold shadow-md active:scale-95 transition-all ${
                    isOutgoing
                      ? 'bg-white/20 text-white hover:bg-white/30'
                      : 'bg-gradient-to-r from-[#8A2387] via-[#E1306C] to-[#F27121] text-white hover:opacity-95 ring-2 ring-[#FF4D94]/50'
                  }`}
                >
                  <Flame className="w-4 h-4 animate-pulse text-amber-300" />
                  <span>
                    View{' '}
                    {message.media_type === 'video'
                      ? 'Video'
                      : message.media_type === 'text'
                      ? 'Message'
                      : 'Photo'}
                  </span>
                  <span className="w-4 h-4 rounded-full border border-white/60 flex items-center justify-center text-[10px]">
                    1
                  </span>
                </button>
              )}
            </div>
          ) : (
            /* Normal Message Contents */
            <>
              {/* Media: Image */}
              {message.media_type === 'image' && message.media_url && (
                <div className="mb-1.5 -mx-1 -mt-1 overflow-hidden rounded-xl">
                  <img
                    src={message.media_url}
                    alt={message.file_name || 'Image'}
                    loading="lazy"
                    className="max-h-72 w-full object-cover rounded-xl cursor-pointer hover:opacity-95 transition-opacity"
                  />
                </div>
              )}

              {/* Media: Video */}
              {message.media_type === 'video' && message.media_url && (
                <div className="mb-1.5 -mx-1 -mt-1 overflow-hidden rounded-xl bg-black">
                  <video
                    src={message.media_url}
                    controls
                    preload="metadata"
                    className="max-h-72 w-full rounded-xl"
                  />
                </div>
              )}

              {/* Media: Voice Note */}
              {message.media_type === 'audio' && message.media_url && (
                <div className="flex items-center gap-2.5 py-1 min-w-[200px]">
                  <audio
                    ref={audioRef}
                    src={message.media_url}
                    onTimeUpdate={handleAudioTimeUpdate}
                    onLoadedMetadata={() =>
                      setAudioDuration(audioRef.current?.duration || 0)
                    }
                    onEnded={() => {
                      setIsPlayingAudio(false);
                      setAudioProgress(0);
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAudioToggle}
                    className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-90 ${
                      isOutgoing ? 'bg-white text-black' : 'bg-[#E1306C] text-white'
                    }`}
                  >
                    {isPlayingAudio ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  <div className="flex-1 flex flex-col gap-1">
                    <div className="relative w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white rounded-full transition-all"
                        style={{ width: `${audioProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-white/70">
                      <span>
                        {isPlayingAudio && audioRef.current
                          ? `${Math.floor(audioRef.current.currentTime)}s`
                          : audioDuration
                          ? `${Math.floor(audioDuration)}s`
                          : 'Voice Note'}
                      </span>
                      <span>Audio</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Media: GIF */}
              {message.media_type === 'gif' && message.media_url && (
                <div className="mb-1.5 -mx-1 -mt-1 overflow-hidden rounded-xl">
                  <img
                    src={message.media_url}
                    alt="GIF"
                    className="max-h-64 w-full object-cover rounded-xl"
                  />
                </div>
              )}

              {/* Media: Sticker */}
              {message.media_type === 'sticker' && message.media_url && (
                <div className="p-1">
                  <img
                    src={message.media_url}
                    alt="Sticker"
                    className="w-36 h-36 object-contain"
                  />
                </div>
              )}

              {/* Media: Document File */}
              {message.media_type === 'file' && (
                <div className="flex items-center gap-3 p-2 rounded-xl bg-black/25 mb-1.5 border border-white/10">
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-white/90" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">
                      {message.file_name || 'Document'}
                    </p>
                    <p className="text-[10px] text-white/60">
                      {message.file_size
                        ? `${(message.file_size / (1024 * 1024)).toFixed(1)} MB`
                        : 'File'}
                    </p>
                  </div>
                  {message.media_url ? (
                    <a
                      href={message.media_url}
                      download={message.file_name || 'download'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-full hover:bg-white/20 text-white/80 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenP2PHUD?.(message.id)}
                      className="text-[11px] font-semibold text-[#0084FF] underline"
                    >
                      P2P Sync
                    </button>
                  )}
                </div>
              )}

              {/* Text Content */}
              {message.content && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {message.content}
                </p>
              )}
            </>
          )}

          {/* Footer Metadata: Timestamp & Read Receipts */}
          <div
            className={`flex items-center gap-1 mt-1 justify-end text-[10px] select-none ${
              isOutgoing ? 'text-white/70' : 'text-[#888888]'
            }`}
          >
            <span>{formatTime(message.created_at)}</span>
            {isOutgoing && (
              <span className="flex items-center ml-0.5">
                {message.viewed_at ? (
                  <CheckCheck className="w-3.5 h-3.5 text-[#38A9FF]" />
                ) : (
                  <CheckCheck className="w-3.5 h-3.5 text-white/70" />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Emoji Reactions Pill Row */}
        {groupedReactions.length > 0 && (
          <div
            className={`flex flex-wrap gap-1 mt-1 ${
              isOutgoing ? 'justify-end mr-1' : 'justify-start ml-1'
            }`}
          >
            {groupedReactions.map(({ emoji, count, userReacted }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => triggerReaction(emoji)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all active:scale-95 ${
                  userReacted
                    ? 'bg-[#2A2A2A] text-white border border-[#E1306C]'
                    : 'bg-[#181818] text-[#D0D0D0] border border-[#2E2E2E] hover:bg-[#222222]'
                }`}
              >
                <span>{emoji}</span>
                {count > 1 && (
                  <span className="text-[10px] font-semibold opacity-80">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { MessageBubble };
