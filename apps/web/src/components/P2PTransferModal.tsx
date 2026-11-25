'use client';

import React from 'react';
import {
  X,
  Pause,
  Play,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownLeft,
  FileCode,
  Download,
  Check,
} from 'lucide-react';
import { P2PTransferMetadata, TransferProgress } from '@/lib/webrtc/p2pTransfer';
import { formatFileSize } from '@/lib/supabase/storage';

interface P2PTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  transferType?: 'sender' | 'receiver';
  isSender?: boolean;
  fileName?: string;
  fileSize?: number;
  metadata?: P2PTransferMetadata | null;
  progress?: TransferProgress | null | any;
  isIncomingRequest?: boolean;
  onAcceptRequest?: () => void;
  onRejectRequest?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDownloadFile?: () => void;
}

export default function P2PTransferModal({
  isOpen,
  onClose,
  transferType,
  isSender,
  fileName,
  fileSize,
  metadata,
  progress,
  isIncomingRequest = false,
  onAcceptRequest,
  onRejectRequest,
  onPause,
  onResume,
  onCancel,
  onDownloadFile,
}: P2PTransferModalProps) {
  if (!isOpen) return null;

  const effectiveIsSender = isSender !== undefined ? isSender : transferType === 'sender';
  const resolvedFileName = fileName || metadata?.fileName || 'P2P_File';
  const resolvedFileSize = fileSize || metadata?.fileSize || 0;
  const resolvedHash = metadata?.fileHashSha256 || '';

  const percentage =
    typeof progress?.percentage === 'number' && !Number.isNaN(progress.percentage)
      ? progress.percentage
      : 0;
  const speedFormatted = progress?.speedBytesPerSec
    ? `${formatFileSize(progress.speedBytesPerSec)}/s`
    : '0 B/s';
  const transferredFormatted = formatFileSize(progress?.bytesTransferred || 0);
  const totalFormatted = formatFileSize(resolvedFileSize);

  const isCompleted = progress?.status === 'completed';
  const isFailed = progress?.status === 'failed';
  const isCancelled = progress?.status === 'cancelled';
  const isPaused = progress?.status === 'paused';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-[#121212] border border-[#2A2A2A] shadow-2xl p-6 flex flex-col gap-5 animate-pop-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-2xl flex items-center justify-center ${
                effectiveIsSender
                  ? 'bg-[#E1306C]/20 text-[#E1306C] border border-[#E1306C]/30'
                  : 'bg-[#0084FF]/20 text-[#0084FF] border border-[#0084FF]/30'
              }`}
            >
              {effectiveIsSender ? (
                <ArrowUpRight className="w-5 h-5" />
              ) : (
                <ArrowDownLeft className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {effectiveIsSender
                  ? 'Direct WebRTC 1 GB Sender'
                  : isIncomingRequest
                  ? 'Incoming P2P File Transfer'
                  : 'Direct WebRTC 1 GB Receiver'}
              </h3>
              <p className="text-[11px] text-[#A0A0A0]">
                64 KB Chunk Binary Stream • Direct P2P
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[#A0A0A0] hover:text-white hover:bg-[#222222]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File Metadata Card */}
        <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-[#181818] border border-[#262626]">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <FileCode className="w-6 h-6 text-white/90" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {resolvedFileName}
            </p>
            <p className="text-[11px] text-[#888888]">
              {totalFormatted} • {metadata?.fileType || 'Binary Data'}
            </p>
          </div>
        </div>

        {/* Progress Metrics & Bar */}
        {!isIncomingRequest && (
          <div className="space-y-2">
            <div className="flex justify-between items-baseline text-xs">
              <span className="font-semibold text-white text-base">
                {percentage}%
              </span>
              <span className="text-[#A0A0A0]">
                {transferredFormatted} / {totalFormatted}
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-[#242424] overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  isFailed || isCancelled
                    ? 'bg-red-500'
                    : isCompleted
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-[#8A2387] via-[#E1306C] to-[#0084FF]'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-[#888888]">
              <span>
                Status:{' '}
                <strong className="text-white capitalize">
                  {progress?.status || 'Connecting'}
                </strong>
              </span>
              <span>Speed: {speedFormatted}</span>
            </div>
          </div>
        )}

        {/* Error Details if Failed */}
        {isFailed && progress?.errorMessage && (
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {progress.errorMessage}
          </div>
        )}

        {/* SHA-256 Verification Badge */}
        <div
          className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs ${
            isCompleted
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : isFailed
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-[#181818] border-[#262626] text-[#A0A0A0]'
          }`}
        >
          {isCompleted ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )}
          <span className="truncate font-mono text-[10px]">
            {isCompleted
              ? `SHA-256 Verified: ${resolvedHash ? `${resolvedHash.slice(0, 16)}...` : 'Matched'}`
              : isFailed
              ? 'SHA-256 Integrity Check Failed'
              : resolvedHash
              ? `Target SHA-256: ${resolvedHash.slice(0, 16)}...`
              : 'Computing SHA-256 checksum...'}
          </span>
        </div>

        {/* Controls Dock */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#222222]">
          {isIncomingRequest ? (
            <>
              <button
                type="button"
                onClick={onRejectRequest || onClose}
                className="px-3.5 py-2 rounded-xl text-red-400 hover:bg-red-500/10 text-xs font-medium transition-colors"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={onAcceptRequest}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0084FF] text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
              >
                <Check className="w-4 h-4" />
                <span>Accept &amp; Receive</span>
              </button>
            </>
          ) : (
            <>
              {isCompleted && !effectiveIsSender && onDownloadFile && (
                <button
                  type="button"
                  onClick={onDownloadFile}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0084FF] text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Save File</span>
                </button>
              )}

              {!isCompleted && !isFailed && !isCancelled && (
                <>
                  {isPaused ? (
                    <button
                      type="button"
                      onClick={onResume}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#222222] hover:bg-[#2A2A2A] text-white text-xs font-medium transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Resume</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onPause}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#222222] hover:bg-[#2A2A2A] text-white text-xs font-medium transition-colors"
                    >
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onCancel || onClose}
                    className="px-3 py-2 rounded-xl text-red-400 hover:bg-red-500/10 text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}

              {(isCompleted || isFailed || isCancelled) && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl bg-[#222222] hover:bg-[#2A2A2A] text-white text-xs font-medium transition-colors"
                >
                  Close
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { P2PTransferModal };
