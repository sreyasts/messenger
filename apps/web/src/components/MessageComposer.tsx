'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Mic,
  Smile,
  Paperclip,
  X,
  Trash2,
  FileUp,
  Image as ImageIcon,
  Headphones,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { MediaType, Message } from '@/types/database';
import { useTheme } from '@/lib/theme/ThemeContext';
import {
  MAX_P2P_FILE_BYTES,
  MAX_SUPABASE_STORAGE_BYTES,
  formatFileSize,
  inferMimeType,
  resolveMediaType,
} from '@/lib/supabase/storage';

export interface OutgoingMessagePayload {
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
  file?: File | Blob;
}

interface MessageComposerProps {
  conversationId: string;
  onSendMessage: (payload: OutgoingMessagePayload) => Promise<void> | void;
  onStartP2PTransfer?: (file: File) => void;
  onTypingChange?: (isTyping: boolean) => void;
  replyingTo?: Message | null;
  replyingToMessage?: Message | null;
  onCancelReply?: () => void;
  onOpenMediaPicker?: (initialTab?: 'emoji' | 'gif' | 'sticker' | 'photo') => void;
  isSending?: boolean;
  uploadProgress?: number | null;
}

export default function MessageComposer({
  conversationId,
  onSendMessage,
  onStartP2PTransfer,
  onTypingChange,
  replyingTo,
  replyingToMessage,
  onCancelReply,
  onOpenMediaPicker,
  isSending = false,
  uploadProgress = null,
}: MessageComposerProps) {
  const { config } = useTheme();
  const [text, setText] = useState('');
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Image attachment preview stage (View Once "1" toggle is ONLY allowed on Images/Photos)
  const [stagedImage, setStagedImage] = useState<{
    file: File;
    previewUrl: string;
    isViewOnce: boolean;
    caption: string;
  } | null>(null);

  const activeReply = replyingTo || replyingToMessage || null;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Voice note recording states & refs (refs avoid stale closures inside async callbacks)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingCancelledRef = useRef(false);
  const isPressingRecordRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const touchStartRecordX = useRef<number | null>(null);
  const [slideCancelOffset, setSlideCancelOffset] = useState(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup preview URL and typing timers on conversation switch / unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
    setComposerError(null);
    setShowAttachmentMenu(false);
    setStagedImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, [conversationId]);

  // Close attachment sheet on outside click
  useEffect(() => {
    if (!showAttachmentMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showAttachmentMenu]);

  // Auto resize textarea height
  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
  }, [text]);

  const notifyTyping = (value: string) => {
    if (!onTypingChange) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (value.trim().length > 0) {
      onTypingChange(true);
      typingTimeoutRef.current = setTimeout(() => {
        onTypingChange(false);
      }, 2500);
    } else {
      onTypingChange(false);
    }
  };

  // Send Plain Text (View Once is NEVER permitted on text)
  const handleSendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setComposerError(null);
    onTypingChange?.(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    try {
      await onSendMessage({
        content: trimmed,
        media_type: 'text',
        mediaType: 'text',
        is_view_once: false,
        isViewOnce: false,
        reply_to_id: activeReply?.id || null,
        replyToId: activeReply?.id,
      });

      setText('');
      onCancelReply?.();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      setComposerError(err?.message || 'Failed to send message');
    }
  };

  // Send Staged Photo (Standard or View Once)
  const handleSendStagedImage = async () => {
    if (!stagedImage || isSending) return;
    setComposerError(null);
    const { file, previewUrl, isViewOnce, caption } = stagedImage;

    try {
      await onSendMessage({
        content: isViewOnce ? '' : caption.trim(),
        media_type: 'image',
        mediaType: 'image',
        file_name: file.name,
        fileName: file.name,
        file_size: file.size,
        fileSize: file.size,
        is_view_once: isViewOnce,
        isViewOnce,
        reply_to_id: activeReply?.id || null,
        replyToId: activeReply?.id,
        file,
      });
      URL.revokeObjectURL(previewUrl);
      setStagedImage(null);
      onCancelReply?.();
    } catch (err: any) {
      setComposerError(err?.message || 'Photo upload failed. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (stagedImage) {
        handleSendStagedImage();
      } else {
        handleSendText();
      }
    }
  };

  // 1 GB / 50 MB Attachment Routing
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShowAttachmentMenu(false);
    setComposerError(null);

    if (file.size > MAX_P2P_FILE_BYTES) {
      setComposerError(`"${file.name}" exceeds the 1 GB maximum P2P file limit.`);
      return;
    }

    // Route files > 50 MB up to 1 GB to WebRTC P2P DataChannel
    if (file.size > MAX_SUPABASE_STORAGE_BYTES) {
      if (onStartP2PTransfer) {
        onStartP2PTransfer(file);
      } else {
        setComposerError('Files larger than 50 MB require an active P2P transfer session.');
      }
      return;
    }

    const mimeType = inferMimeType(file.name, file.type);
    const mediaType = resolveMediaType(file.name, mimeType);

    // Stage images in the preview bar so user can toggle View Once ("1") ONLY on images
    if (mediaType === 'image') {
      if (stagedImage?.previewUrl) {
        URL.revokeObjectURL(stagedImage.previewUrl);
      }
      setStagedImage({
        file,
        previewUrl: URL.createObjectURL(file),
        isViewOnce: false,
        caption: text,
      });
      setText('');
      return;
    }

    // Non-image files (video, audio, document) never allow View Once
    try {
      await onSendMessage({
        content: '',
        media_type: mediaType,
        mediaType,
        file_name: file.name,
        fileName: file.name,
        file_size: file.size,
        fileSize: file.size,
        is_view_once: false,
        isViewOnce: false,
        reply_to_id: activeReply?.id || null,
        replyToId: activeReply?.id,
        file,
      });
      onCancelReply?.();
    } catch (err: any) {
      setComposerError(err?.message || `Failed to upload ${file.name}`);
    }
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
    const step = Math.max(1, Math.floor(bufferLength / totalBars));

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

  const cleanupAudioResources = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const startRecording = async () => {
    if (isRecording || isPressingRecordRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setComposerError('Voice recording is not supported in this browser.');
      return;
    }

    isPressingRecordRef.current = true;
    recordingCancelledRef.current = false;
    setComposerError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // User released the mic button while permission prompt / stream initialization was pending
      if (!isPressingRecordRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      audioChunksRef.current = [];
      setRecordingSeconds(0);
      setSlideCancelOffset(0);

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;
      }

      const preferredMime =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

      const mediaRecorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        cleanupAudioResources();

        if (recordingCancelledRef.current) {
          audioChunksRef.current = [];
          return;
        }

        const resolvedMime = mediaRecorder.mimeType || preferredMime || 'audio/webm';
        const ext = resolvedMime.includes('mp4') ? 'm4a' : resolvedMime.includes('ogg') ? 'ogg' : 'webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: resolvedMime });
        audioChunksRef.current = [];

        if (audioBlob.size > 0) {
          const fileName = `VoiceNote_${Date.now()}.${ext}`;
          const audioFile = new File([audioBlob], fileName, { type: resolvedMime });
          try {
            await onSendMessage({
              content: '',
              media_type: 'audio',
              mediaType: 'audio',
              file_name: fileName,
              fileName,
              file_size: audioFile.size,
              fileSize: audioFile.size,
              is_view_once: false,
              isViewOnce: false,
              reply_to_id: activeReply?.id || null,
              replyToId: activeReply?.id,
              file: audioFile,
            });
            onCancelReply?.();
          } catch (err: any) {
            setComposerError(err?.message || 'Failed to upload voice note');
          }
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      drawWaveform();
    } catch (err: any) {
      isPressingRecordRef.current = false;
      cleanupAudioResources();
      setIsRecording(false);
      setComposerError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please enable mic access to record voice notes.'
          : 'Microphone unavailable on this device.'
      );
    }
  };

  const stopRecording = (cancel: boolean = false) => {
    isPressingRecordRef.current = false;
    recordingCancelledRef.current = cancel;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setSlideCancelOffset(0);
  };

  const handleMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    touchStartRecordX.current = e.clientX;
    startRecording();
  };

  const handleMicPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (touchStartRecordX.current === null || !isRecording) return;
    const deltaX = touchStartRecordX.current - e.clientX;
    if (deltaX > 0) {
      setSlideCancelOffset(deltaX);
      if (deltaX > 110) {
        touchStartRecordX.current = null;
        stopRecording(true);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([20, 50, 20]);
        }
      }
    }
  };

  const handleMicPointerUp = () => {
    if (isRecording || isPressingRecordRef.current) {
      stopRecording(slideCancelOffset > 100);
    }
    touchStartRecordX.current = null;
    setSlideCancelOffset(0);
  };

  return (
    <div className="relative border-t border-[#2A2A2A] bg-[#000000] p-2.5 sm:p-3 safe-bottom">
      {/* Upload Progress Strip */}
      {uploadProgress !== null && uploadProgress >= 0 && uploadProgress < 100 && (
        <div className="mb-2 px-1">
          <div className="flex items-center justify-between text-[11px] text-[#A0A0A0] mb-1">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-[#E1306C]" />
              Uploading attachment...
            </span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full h-1 bg-[#1E1E1E] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${config.gradientClass}`}
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Alert Banner */}
      {composerError && (
        <div className="mb-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{composerError}</span>
          </div>
          <button
            type="button"
            onClick={() => setComposerError(null)}
            className="text-red-300 hover:text-white flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Staged Image Attachment Preview (View Once "1" is ONLY available here for photos) */}
      {stagedImage && (
        <div className="mb-2.5 p-2.5 rounded-2xl bg-[#141414] border border-[#2A2A2A] flex flex-col gap-2.5 animate-pop-in">
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-black border border-[#2A2A2A] flex-shrink-0">
              <img
                src={stagedImage.previewUrl}
                alt={stagedImage.file.name}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {stagedImage.file.name}
              </p>
              <p className="text-[11px] text-[#888888]">
                Photo • {formatFileSize(stagedImage.file.size)}
              </p>
              {stagedImage.isViewOnce && (
                <p className="text-[11px] text-[#FF4D94] font-medium mt-0.5">
                  View Once enabled — disappears after recipient opens
                </p>
              )}
            </div>

            {/* View Once ("1") Toggle — strictly restricted to Image/Photo attachments */}
            <button
              type="button"
              onClick={() =>
                setStagedImage((prev) =>
                  prev ? { ...prev, isViewOnce: !prev.isViewOnce } : null
                )
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                stagedImage.isViewOnce
                  ? 'bg-gradient-to-tr from-[#E1306C] to-[#F27121] text-white ring-2 ring-[#FF4D94]/60'
                  : 'bg-[#1E1E1E] text-[#A0A0A0] hover:text-white border border-[#2E2E2E]'
              }`}
              title={stagedImage.isViewOnce ? 'View Once Active' : 'Send as View Once Photo'}
            >
              <span className="w-4 h-4 rounded-full border-2 border-current border-dashed flex items-center justify-center text-[9px] font-bold">
                1
              </span>
              <span className="hidden sm:inline">View Once</span>
            </button>

            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(stagedImage.previewUrl);
                setStagedImage(null);
              }}
              className="p-1.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#222222]"
              title="Discard photo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={stagedImage.caption}
              disabled={stagedImage.isViewOnce}
              onChange={(e) =>
                setStagedImage((prev) =>
                  prev ? { ...prev, caption: e.target.value } : null
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSendStagedImage();
                }
              }}
              placeholder={
                stagedImage.isViewOnce
                  ? 'Captions disabled for View Once photos'
                  : 'Add a caption (optional)...'
              }
              className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#666666] outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSendStagedImage}
              disabled={isSending}
              className={`px-3.5 py-1.5 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform disabled:opacity-50 ${config.gradientClass}`}
            >
              {isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Send Photo</span>
            </button>
          </div>
        </div>
      )}

      {/* Replying to Bar */}
      {activeReply && !stagedImage && (
        <div
          className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-lg bg-[#141414] border-l-4"
          style={{ borderLeftColor: config.primaryHex }}
        >
          <div className="text-xs truncate">
            <span className="font-semibold mr-1" style={{ color: config.primaryHex }}>
              Replying to {activeReply.sender?.display_name || 'Message'}:
            </span>
            <span className="text-[#A0A0A0]">
              {activeReply.is_view_once
                ? 'View Once Photo'
                : activeReply.content || `[${activeReply.media_type}]`}
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
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
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
        <div
          ref={menuRef}
          className="absolute bottom-16 left-3 z-30 w-56 rounded-2xl bg-[#141414] border border-[#2A2A2A] shadow-2xl p-2 flex flex-col gap-1 backdrop-blur-xl animate-pop-in"
        >
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
          >
            <ImageIcon className="w-4 h-4 text-[#0084FF]" />
            <div>
              <div>Photo (Standard / View Once)</div>
              <div className="text-[10px] text-[#888888]">Images up to 50 MB</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="flex items-center gap-3 w-full px-3 py-2 text-xs text-white hover:bg-[#222222] rounded-xl transition-colors text-left"
          >
            <ImageIcon className="w-4 h-4 text-[#A855F7]" />
            <div>
              <div>Video</div>
              <div className="text-[10px] text-[#888888]">Up to 50 MB cloud or 1 GB P2P</div>
            </div>
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
              <div>Document / Large File</div>
              <div className="text-[10px] text-[#888888]">Up to 1 GB via WebRTC P2P</div>
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
            title="Cancel recording"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Normal Composer Dock — NO View Once toggle on plain text messages */
        <div className="flex items-end gap-1.5 sm:gap-2">
          {/* Attachment Sheet Button */}
          <button
            type="button"
            onClick={() => setShowAttachmentMenu((prev) => !prev)}
            className="p-2.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A] transition-colors"
            title="Attach photo, video, audio, or file up to 1 GB"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Emoji / GIF / Sticker / Photo Picker Button */}
          <button
            type="button"
            onClick={() => onOpenMediaPicker?.('emoji')}
            className="p-2.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A] transition-colors"
            title="Emoji, GIF, Sticker, Photo"
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* Auto-resizing Text Input */}
          <div className="flex-1 min-w-0 bg-[#161616] border border-[#2A2A2A] rounded-2xl px-3.5 py-1.5 focus-within:border-[#E1306C] transition-colors">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                notifyTyping(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              className="w-full bg-transparent text-sm text-white placeholder-[#666666] outline-none resize-none max-h-32 leading-5"
            />
          </div>

          {/* Send Button or Hold-to-Record Mic */}
          {text.trim().length > 0 ? (
            <button
              type="button"
              onClick={handleSendText}
              disabled={isSending}
              className={`p-2.5 rounded-full text-white shadow-md active:scale-90 transition-transform disabled:opacity-50 ${config.gradientClass}`}
              title="Send message"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4 ml-0.5" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onPointerDown={handleMicPointerDown}
              onPointerMove={handleMicPointerMove}
              onPointerUp={handleMicPointerUp}
              onPointerCancel={() => stopRecording(true)}
              className="p-2.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#1A1A1A] active:scale-95 transition-all select-none touch-none"
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
