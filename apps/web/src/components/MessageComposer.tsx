'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Mic,
  Smile,
  Paperclip,
  X,
  Trash2,
  Lock,
  Flame,
  FileUp,
  Image as ImageIcon,
  Headphones,
} from 'lucide-react';
import { MediaType, Message } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';

interface MessageComposerProps {
  conversationId: string;
  onSendMessage: (payload: {
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
  }) => Promise<void> | void;
  onStartP2PTransfer?: (file: File) => void;
  replyingTo?: Message | null;
  replyingToMessage?: Message | null;
  onCancelReply?: () => void;
  onOpenMediaPicker?: (initialTab?: 'emoji' | 'gif' | 'sticker') => void;
  isSending?: boolean;
}

export default function MessageComposer({
  conversationId,
  onSendMessage,
  onStartP2PTransfer,
  replyingTo,
  replyingToMessage,
  onCancelReply,
  onOpenMediaPicker,
  isSending = false,
}: MessageComposerProps) {
  const { config } = useTheme();
  const [text, setText] = useState('');
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  const activeReply = replyingTo || replyingToMessage || null;

  // Auto-resize textarea ref
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hidden file input refs
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Voice note recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingCancelled, setRecordingCancelled] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Touch gesture tracking for slide-to-cancel
  const touchStartRecordX = useRef<number | null>(null);
  const [slideCancelOffset, setSlideCancelOffset] = useState(0);

  // Auto resize textarea height
  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      140
    )}px`;
  }, [text]);

  // Handle Send Text
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !isSending) return;

    await onSendMessage({
      content: trimmed,
      media_type: 'text',
      mediaType: 'text',
      is_view_once: isViewOnce,
      isViewOnce: isViewOnce,
      reply_to_id: activeReply?.id,
      replyToId: activeReply?.id,
    });

    setText('');
    setIsViewOnce(false);
    onCancelReply?.();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 1 GB / 50 MB Attachment Routing
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowAttachmentMenu(false);

    // Route files > 50 MB up to 1 GB to WebRTC P2P DataChannel
    if (file.size > 50 * 1024 * 1024) {
      if (onStartP2PTransfer) {
        onStartP2PTransfer(file);
      }
      e.target.value = '';
      return;
    }

    let mediaType: MediaType = 'file';
    if (file.type.startsWith('image/')) mediaType = 'image';
    else if (file.type.startsWith('video/')) mediaType = 'video';
    else if (file.type.startsWith('audio/')) mediaType = 'audio';

    const fileUrl = URL.createObjectURL(file);

    await onSendMessage({
      content: '',
      media_type: mediaType,
      mediaType,
      media_url: fileUrl,
      mediaUrl: fileUrl,
      file_name: file.name,
      fileName: file.name,
      file_size: file.size,
      fileSize: file.size,
      is_view_once: isViewOnce,
      isViewOnce,
      reply_to_id: activeReply?.id,
      replyToId: activeReply?.id,
    });

    setIsViewOnce(false);
    onCancelReply?.();
    e.target.value = '';
  };

  // Web Audio Waveform Renderer during Voice Recording
  const drawWaveform = () => {
    if (!analyserRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = 3;
    const gap = 2;
    const totalBars = Math.floor(canvas.width / (barWidth + gap));
    const step = Math.floor(bufferLength / totalBars);

    for (let i = 0; i < totalBars; i++) {
      const value = dataArray[i * step] || 0;
      const barHeight = Math.max(3, (value / 255) * canvas.height * 0.9);
      const x = i * (barWidth + gap);
      const y = (canvas.height - barHeight) / 2;

      ctx.fillStyle = '#EF4444';
      ctx.fillRect(x, y, barWidth, barHeight);
    }

    animFrameRef.current = requestAnimationFrame(drawWaveform);
  };

  // Start Voice Recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      setRecordingSeconds(0);
      setRecordingCancelled(false);
      setSlideCancelOffset(0);

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();

        if (recordingCancelled) {
          audioChunksRef.current = [];
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: 'audio/webm;codecs=opus',
        });
        if (audioBlob.size > 0) {
          const audioUrl = URL.createObjectURL(audioBlob);
          await onSendMessage({
            content: '',
            media_type: 'audio',
            mediaType: 'audio',
            media_url: audioUrl,
            mediaUrl: audioUrl,
            file_name: `VoiceNote_${Date.now()}.webm`,
            fileName: `VoiceNote_${Date.now()}.webm`,
            file_size: audioBlob.size,
            fileSize: audioBlob.size,
            is_view_once: false,
            isViewOnce: false,
            reply_to_id: activeReply?.id,
            replyToId: activeReply?.id,
          });
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      drawWaveform();
    } catch (err) {
      console.warn('Microphone permission denied or not available:', err);
    }
  };

  const stopRecording = (cancel: boolean = false) => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setRecordingCancelled(cancel);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleMicTouchStart = (e: React.TouchEvent) => {
    touchStartRecordX.current = e.touches[0].clientX;
    startRecording();
  };

  const handleMicTouchMove = (e: React.TouchEvent) => {
    if (touchStartRecordX.current === null || !isRecording) return;
    const currentX = e.touches[0].clientX;
    const deltaX = touchStartRecordX.current - currentX;

    if (deltaX > 0) {
      setSlideCancelOffset(deltaX);
      if (deltaX > 110) {
        stopRecording(true);
        touchStartRecordX.current = null;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([20, 50, 20]);
        }
      }
    }
  };

  const handleMicTouchEnd = () => {
    if (isRecording) {
      stopRecording(slideCancelOffset > 100);
    }
    touchStartRecordX.current = null;
    setSlideCancelOffset(0);
  };

  return (
    <div className="relative border-t border-[#2A2A2A] bg-[#000000] p-2.5 sm:p-3">
      {/* Replying to Bar */}
      {activeReply && (
        <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-lg bg-[#141414] border-l-4 border-[#E1306C]">
          <div className="text-xs truncate">
            <span className="font-semibold text-[#E1306C] mr-1">
              Replying to {activeReply.sender?.display_name || 'Message'}:
            </span>
            <span className="text-[#A0A0A0]">
              {activeReply.content || `[${activeReply.media_type}]`}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="p-1 text-[#A0A0A0] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Attachment Popover Sheet */}
      {showAttachmentMenu && (
        <div className="absolute bottom-16 left-3 z-30 w-52 rounded-2xl bg-[#141414] border border-[#2A2A2A] shadow-2xl p-2 flex flex-col gap-1 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => mediaInputRef.current?.click()}
            className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
          >
            <ImageIcon className="w-4 h-4 text-[#0084FF]" />
            <span>Photos & Videos</span>
          </button>
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
          >
            <Headphones className="w-4 h-4 text-[#10B981]" />
            <span>Audio File</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
          >
            <FileUp className="w-4 h-4 text-[#E1306C]" />
            <div>
              <div>Document / File</div>
              <div className="text-[10px] text-[#888888]">Up to 1 GB via P2P</div>
            </div>
          </button>
        </div>
      )}

      {/* Voice Note Recording Overlay HUD */}
      {isRecording ? (
        <div className="flex items-center gap-3 w-full h-11 px-3 bg-[#121212] rounded-full border border-red-500/30">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-xs font-mono font-medium text-red-400 flex-shrink-0">
            {Math.floor(recordingSeconds / 60)}:
            {String(recordingSeconds % 60).padStart(2, '0')}
          </span>

          {/* Live Waveform Canvas */}
          <div className="flex-1 h-6 overflow-hidden">
            <canvas
              ref={canvasRef}
              width={160}
              height={24}
              className="w-full h-full"
            />
          </div>

          {/* Slide-to-cancel cue */}
          <div
            className="text-xs text-[#888888] flex items-center gap-1 transition-transform"
            style={{ transform: `translateX(-${slideCancelOffset}px)` }}
          >
            <span>‹ Slide to cancel</span>
          </div>

          <button
            type="button"
            onClick={() => stopRecording(true)}
            className="p-1.5 text-[#888888] hover:text-red-500 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Normal Composer Dock */
        <div className="flex items-end gap-1.5 sm:gap-2">
          {/* Attachment Sheet Button */}
          <button
            type="button"
            onClick={() => setShowAttachmentMenu((prev) => !prev)}
            className="p-2.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A] transition-colors"
            title="Attach file up to 1 GB"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Emoji / GIF / Sticker Button */}
          <button
            type="button"
            onClick={() => onOpenMediaPicker?.('emoji')}
            className="p-2.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A] transition-colors"
            title="Emoji, GIF, Sticker"
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* View Once Toggle Button */}
          <button
            type="button"
            onClick={() => setIsViewOnce((prev) => !prev)}
            className={`p-2 rounded-full transition-all ${
              isViewOnce
                ? 'bg-gradient-to-tr from-[#E1306C] to-[#F27121] text-white ring-2 ring-[#FF4D94]/70 scale-105'
                : 'text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A]'
            }`}
            title={isViewOnce ? 'View Once Active' : 'Toggle View Once Media'}
          >
            <div className="w-5 h-5 rounded-full border-2 border-current border-dashed flex items-center justify-center text-[10px] font-bold">
              1
            </div>
          </button>

          {/* Auto-resizing Text Input */}
          <div className="flex-1 min-w-0 bg-[#161616] border border-[#2A2A2A] rounded-2xl px-3.5 py-1.5 focus-within:border-[#E1306C] transition-colors">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              className="w-full bg-transparent text-sm text-white placeholder-[#666666] outline-none resize-none max-h-32 leading-5"
            />
          </div>

          {/* Send Button or Press-and-Hold Mic */}
          {text.trim().length > 0 ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending}
              className={`p-2.5 rounded-full text-white shadow-md active:scale-90 transition-transform ${config.gradientClass}`}
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          ) : (
            <button
              type="button"
              onMouseDown={startRecording}
              onMouseUp={() => stopRecording(false)}
              onTouchStart={handleMicTouchStart}
              onTouchMove={handleMicTouchMove}
              onTouchEnd={handleMicTouchEnd}
              className="p-2.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A] active:scale-95 transition-all select-none"
              title="Hold to record voice note"
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { MessageComposer };
