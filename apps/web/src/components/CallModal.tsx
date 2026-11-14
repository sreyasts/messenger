'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Volume2,
  VolumeX,
  Radio,
} from 'lucide-react';
import { CallType } from '@/types/database';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  callType: CallType | 'audio' | 'video';
  contactName?: string;
  contactAvatar?: string;
  remoteParticipantName?: string;
  remoteParticipantAvatar?: string;
  roomName?: string;
  participantIdentity?: string;
  participantName?: string;
  callDuration?: number; // in seconds
  callStatus?: 'connecting' | 'ringing' | 'connected' | 'ended';
  isMicMuted?: boolean;
  isCameraOff?: boolean;
  isSpeakerOn?: boolean;
  localVideoRef?: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef?: React.RefObject<HTMLVideoElement | null>;
  onToggleMic?: () => void;
  onToggleCamera?: () => void;
  onToggleSpeaker?: () => void;
  onEndCall?: () => void;
}

export default function CallModal({
  isOpen,
  onClose,
  callType,
  contactName,
  contactAvatar,
  remoteParticipantName,
  remoteParticipantAvatar,
  roomName,
  participantIdentity,
  participantName,
  callDuration: externalDuration,
  callStatus: externalStatus,
  isMicMuted: externalMicMuted,
  isCameraOff: externalCameraOff,
  isSpeakerOn: externalSpeakerOn,
  localVideoRef,
  remoteVideoRef,
  onToggleMic,
  onToggleCamera,
  onToggleSpeaker,
  onEndCall,
}: CallModalProps) {
  // Internal state fallback if not managed by parent
  const [internalDuration, setInternalDuration] = useState(0);
  const [internalStatus, setInternalStatus] = useState<'connecting' | 'ringing' | 'connected' | 'ended'>('connecting');
  const [internalMicMuted, setInternalMicMuted] = useState(false);
  const [internalCameraOff, setInternalCameraOff] = useState(false);
  const [internalSpeakerOn, setInternalSpeakerOn] = useState(true);

  const duration = externalDuration !== undefined ? externalDuration : internalDuration;
  const status = externalStatus !== undefined ? externalStatus : internalStatus;
  const micMuted = externalMicMuted !== undefined ? externalMicMuted : internalMicMuted;
  const cameraOff = externalCameraOff !== undefined ? externalCameraOff : internalCameraOff;
  const speakerOn = externalSpeakerOn !== undefined ? externalSpeakerOn : internalSpeakerOn;

  const resolvedName = contactName || remoteParticipantName || participantName || 'Friend';
  const resolvedAvatar = contactAvatar || remoteParticipantAvatar;

  // Manage duration timer and connection simulation if internal
  useEffect(() => {
    if (!isOpen) return;

    const connectTimeout = setTimeout(() => {
      setInternalStatus('connected');
    }, 1500);

    const timer = setInterval(() => {
      setInternalDuration((prev) => prev + 1);
    }, 1000);

    return () => {
      clearTimeout(connectTimeout);
      clearInterval(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handleEnd = () => {
    if (onEndCall) {
      onEndCall();
    } else {
      onClose();
    }
  };

  const handleMicToggle = () => {
    if (onToggleMic) {
      onToggleMic();
    } else {
      setInternalMicMuted((prev) => !prev);
    }
  };

  const handleCameraToggle = () => {
    if (onToggleCamera) {
      onToggleCamera();
    } else {
      setInternalCameraOff((prev) => !prev);
    }
  };

  const handleSpeakerToggle = () => {
    if (onToggleSpeaker) {
      onToggleSpeaker();
    } else {
      setInternalSpeakerOn((prev) => !prev);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-[#000000] text-white select-none animate-fade-in">
      {/* Top Header Bar */}
      <div className="z-10 flex items-center justify-between px-6 py-5 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div>
          <h2 className="text-lg font-bold text-white tracking-wide">
            {resolvedName}
          </h2>
          <div className="text-xs font-medium text-[#A0A0A0] flex items-center gap-1.5">
            {status === 'connected' ? (
              <>
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>{formatDuration(duration)}</span>
              </>
            ) : status === 'ringing' ? (
              'Ringing...'
            ) : (
              'Connecting to LiveKit SFU...'
            )}
          </div>
        </div>

        <div className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-[11px] font-medium text-white/80">
          {callType === 'video' ? 'VP8 720p Video' : 'Opus 48kHz HD Audio'}
        </div>
      </div>

      {/* Main Call View Stage */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {callType === 'video' ? (
          <>
            {/* Remote Video Track */}
            <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
              {remoteVideoRef ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center">
                  {resolvedAvatar ? (
                    <img
                      src={resolvedAvatar}
                      alt={resolvedName}
                      className="w-24 h-24 rounded-full object-cover border-2 border-white/20 mb-3"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-[#1A1A1A] border-2 border-white/20 flex items-center justify-center text-2xl font-bold mb-3">
                      {resolvedName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-[#A0A0A0]">{resolvedName}</span>
                </div>
              )}
            </div>

            {/* Local Video Preview PIP (Top-Right) */}
            <div className="absolute top-4 right-4 z-20 w-32 h-44 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#141414]">
              {cameraOff ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-[#888888]">
                  <VideoOff className="w-6 h-6 mb-1 text-white/50" />
                  <span>Camera Off</span>
                </div>
              ) : localVideoRef ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-[#888888] bg-[#161616]">
                  <Video className="w-6 h-6 mb-1 text-emerald-400" />
                  <span>Self Preview</span>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Voice Call Stage: Concentric Audio Wave Pulsing Aura */
          <div className="relative flex flex-col items-center justify-center">
            {/* Animated Audio Waveform Ring Aura */}
            <div className="absolute w-48 h-48 rounded-full bg-[#E1306C]/15 animate-ping opacity-60" />
            <div className="absolute w-40 h-40 rounded-full bg-[#0084FF]/20 animate-pulse" />

            {/* Contact Avatar */}
            {resolvedAvatar ? (
              <img
                src={resolvedAvatar}
                alt={resolvedName}
                className="relative z-10 w-28 h-28 rounded-full object-cover border-4 border-white/20 shadow-2xl"
              />
            ) : (
              <div className="relative z-10 w-28 h-28 rounded-full bg-[#1E1E1E] border-4 border-white/20 flex items-center justify-center text-3xl font-bold shadow-2xl text-white">
                {resolvedName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Floating Control Dock */}
      <div className="z-10 flex items-center justify-center pb-8 pt-4 bg-gradient-to-t from-black/90 to-transparent">
        <div className="flex items-center gap-5 px-6 py-4 rounded-full bg-[#141414]/90 border border-[#2A2A2A] shadow-2xl backdrop-blur-xl">
          {/* Microphone Toggle */}
          <button
            type="button"
            onClick={handleMicToggle}
            className={`p-3.5 rounded-full transition-all active:scale-90 ${
              micMuted
                ? 'bg-red-500/20 text-red-500 border border-red-500/40'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={micMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {micMuted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* Camera Toggle (Video Call Only) */}
          {callType === 'video' && (
            <button
              type="button"
              onClick={handleCameraToggle}
              className={`p-3.5 rounded-full transition-all active:scale-90 ${
                cameraOff
                  ? 'bg-red-500/20 text-red-500 border border-red-500/40'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
              title={cameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {cameraOff ? (
                <VideoOff className="w-5 h-5" />
              ) : (
                <Video className="w-5 h-5" />
              )}
            </button>
          )}

          {/* Speaker Toggle */}
          <button
            type="button"
            onClick={handleSpeakerToggle}
            className={`p-3.5 rounded-full transition-all active:scale-90 ${
              !speakerOn
                ? 'bg-white/5 text-[#888888]'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={speakerOn ? 'Speaker On' : 'Mute Speaker'}
          >
            {speakerOn ? (
              <Volume2 className="w-5 h-5" />
            ) : (
              <VolumeX className="w-5 h-5" />
            )}
          </button>

          {/* End Call / Hang Up Button */}
          <button
            type="button"
            onClick={handleEnd}
            className="p-4 rounded-full bg-[#EF4444] hover:bg-red-600 text-white shadow-lg active:scale-90 transition-transform"
            title="End Call"
          >
            <PhoneOff className="w-6 h-6 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
}

export { CallModal };
