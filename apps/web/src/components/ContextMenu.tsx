'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Reply, Trash2, EyeOff, Check } from 'lucide-react';
import { Message, User } from '@/types/database';

interface ContextMenuProps {
  message: Message;
  position: { x: number; y: number };
  isOwn?: boolean;
  currentUser?: User;
  currentUserId?: string;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
  onCopy?: (text: string) => void;
  onDeleteForMe: (messageId: string) => void;
  onDeleteForEveryone: (messageId: string) => void;
  onOpenMoreEmojis?: (message: Message) => void;
}

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

export default function ContextMenu({
  message,
  position,
  isOwn,
  currentUser,
  currentUserId,
  onClose,
  onReact,
  onReply,
  onCopy,
  onDeleteForMe,
  onDeleteForEveryone,
  onOpenMoreEmojis,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [showConfirmDeleteEveryone, setShowConfirmDeleteEveryone] = useState(false);

  const effectiveUserId = currentUserId || currentUser?.id;
  const isSender = isOwn !== undefined ? isOwn : message.sender_id === effectiveUserId;

  const [adjustedPos, setAdjustedPos] = useState(position);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const menuWidth = rect.width || 240;
    const menuHeight = rect.height || 260;
    const padding = 12;

    let x = position.x;
    let y = position.y;

    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding;
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding;
    }
    setAdjustedPos({ x: Math.max(padding, x), y: Math.max(padding, y) });
  }, [position, showConfirmDeleteEveryone]);

  const handleCopy = async () => {
    const textToCopy = message.content || '';
    if (!textToCopy) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onCopy?.(textToCopy);
        onClose();
      }, 350);
    } catch {
      onCopy?.(textToCopy);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        style={{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }}
        className="fixed z-50 w-60 rounded-2xl bg-[#141414] border border-[#2A2A2A] shadow-2xl overflow-hidden animate-pop-in"
      >
        {/* Quick Emoji Reaction Bar */}
        {!message.deleted_for_everyone && (
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#242424] bg-[#1A1A1A]">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onReact(message.id, emoji);
                  onClose();
                }}
                className="text-lg hover:scale-125 active:scale-95 transition-transform"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                onOpenMoreEmojis?.(message);
                onClose();
              }}
              className="w-6 h-6 rounded-full bg-[#2A2A2A] text-[#A0A0A0] hover:text-white flex items-center justify-center text-xs font-bold"
              title="More emojis"
            >
              +
            </button>
          </div>
        )}

        {/* Action Items List */}
        <div className="p-1.5 flex flex-col gap-0.5">
          {message.content && !message.deleted_for_everyone && !message.is_view_once && (
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
            >
              {copied ? (
                <Check className="w-4 h-4 text-[#10B981]" />
              ) : (
                <Copy className="w-4 h-4 text-[#A0A0A0]" />
              )}
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>
          )}

          {!message.deleted_for_everyone && (
            <button
              type="button"
              onClick={() => {
                onReply(message);
                onClose();
              }}
              className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
            >
              <Reply className="w-4 h-4 text-[#A0A0A0]" />
              <span>Reply</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onDeleteForMe(message.id);
              onClose();
            }}
            className="flex items-center gap-3 w-full px-3 py-2 text-xs text-[#A0A0A0] hover:text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
          >
            <EyeOff className="w-4 h-4" />
            <span>Delete for Me</span>
          </button>

          {/* Delete for Everyone (with permanent DB audit notice) */}
          {isSender && !message.deleted_for_everyone && (
            <button
              type="button"
              onClick={() => setShowConfirmDeleteEveryone(true)}
              className="flex items-center gap-3 w-full px-3 py-2 text-xs text-[#EF4444] hover:bg-red-500/10 rounded-xl transition-colors text-left"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete for Everyone</span>
            </button>
          )}
        </div>

        {/* Delete Confirmation Modal Layer */}
        {showConfirmDeleteEveryone && (
          <div className="p-3 border-t border-[#262626] bg-[#161616]">
            <p className="text-[11px] text-[#A0A0A0] leading-normal mb-2.5">
              Delete message for everyone in this chat?{' '}
              <span className="text-[#888888] italic">
                (Audit record is permanently preserved in server database).
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmDeleteEveryone(false)}
                className="px-2.5 py-1 text-xs text-[#A0A0A0] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteForEveryone(message.id);
                  onClose();
                }}
                className="px-3 py-1 text-xs bg-[#EF4444] text-white rounded-lg font-medium hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { ContextMenu };
