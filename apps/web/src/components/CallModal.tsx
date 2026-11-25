'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  Radio,
  SwitchCamera,
  MonitorUp,
  AlertCircle,
} from 'lucide-react';
import { ConnectionState, Track, LocalTrackPublication, RemoteTrack } from 'livekit-client';
import { CallStatus, CallType } from '@/types/database';
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import {
  CallConnectionQuality,
  LiveKitCallManager,
} from '@/lib/livekit/LiveKitManager';

export interface CallModalProps {
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
  conversationId?: string;
  callId?: string;
  isIncoming?: boolean;
  callDuration?: number; // in seconds (controlled override)
  callStatus?: 'connecting' | 'ringing' | 'connected' | 'ended';
  isMicMuted?: boolean;
  isCameraOff?: boolean;
  isSpeakerOn?: boolean;
  localVideoRef?: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef?: React.RefObject<HTMLVideoElement | null>;
  onToggleMic?: () => void;
  onToggleCamera?: () => void;
  onToggleSpeaker?: () => void;
  onAcceptCall?: () => void;
  onDeclineCall?: () => void;
  onEndCall?: () => void;
  onCallStatusChange?: (status: CallStatus) => void;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value?: string | null): value is string {
  return Boolean(value && UUID_REGEX.test(value));
}

function extractConversationId(
  explicitId?: string,
  roomName?: string
): string | undefined {
  if (explicitId) return explicitId;
  if (!roomName) return undefined;
  const match = roomName.match(/^(?:conversation|room)-(.+)$/);
  return match?.[1];
}

function ConnectionQualityMeter({
  quality,
  status,
}: {
  quality: CallConnectionQuality;
  status: string;
}) {
  const activeBars =
    status !== 'connected'
      ? 0
      : quality === 'excellent'
      ? 4
      : quality === 'good'
      ? 3
      : quality === 'poor'
      ? 2
      : quality === 'lost'
      ? 1
      : 3;

  const barColor =
    quality === 'poor'
      ? 'bg-amber-400'
      : quality === 'lost'
      ? 'bg-red-500'
      : 'bg-emerald-400';

  const label =
    status !== 'connected'
      ? status === 'ringing'
        ? 'Ringing'
        : 'Connecting'
      : quality === 'excellent'
      ? 'HD'
      : quality === 'good'
      ? 'Good'
      : quality === 'poor'
      ? 'Weak'
      : quality === 'lost'
      ? 'Reconnecting'
      : 'Live';

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15"
      title={`Connection quality: ${quality}`}
    >
      <div className="flex items-end gap-[2px] h-3">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`w-[3px] rounded-full transition-colors ${
              bar <= activeBars ? barColor : 'bg-white/25'
            }`}
            style={{ height: `${bar * 25}%` }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-white/90">{label}</span>
    </div>
  );
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
  conversationId,
  callId: externalCallId,
  isIncoming = false,
  callDuration: externalDuration,
  callStatus: externalStatus,
  isMicMuted: externalMicMuted,
  isCameraOff: externalCameraOff,
  isSpeakerOn: externalSpeakerOn,
  localVideoRef: externalLocalVideoRef,
  remoteVideoRef: externalRemoteVideoRef,
  onToggleMic,
  onToggleCamera,
  onToggleSpeaker,
  onAcceptCall,
  onDeclineCall,
  onEndCall,
  onCallStatusChange,
}: CallModalProps) {
  const isExternallyControlled =
    externalStatus !== undefined &&
    (Boolean(onEndCall) || Boolean(externalLocalVideoRef) || Boolean(externalRemoteVideoRef));

  const [internalDuration, setInternalDuration] = useState(0);
  const [internalStatus, setInternalStatus] = useState<
    'connecting' | 'ringing' | 'connected' | 'ended'
  >(isIncoming ? 'ringing' : 'connecting');
  const [internalMicMuted, setInternalMicMuted] = useState(false);
  const [internalCameraOff, setInternalCameraOff] = useState(callType === 'audio');
  const [internalSpeakerOn, setInternalSpeakerOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionQuality, setConnectionQuality] =
    useState<CallConnectionQuality>('unknown');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [hasAcceptedIncoming, setHasAcceptedIncoming] = useState(!isIncoming);

  const internalLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);

  const localVideoRef = externalLocalVideoRef ?? internalLocalVideoRef;
  const remoteVideoRef = externalRemoteVideoRef ?? internalRemoteVideoRef;

  const managerRef = useRef<LiveKitCallManager | null>(null);
  const demoStreamRef = useRef<MediaStream | null>(null);
  const activeCallRowIdRef = useRef<string | null>(externalCallId || null);
  const isClosingRef = useRef(false);
  const internalStatusRef = useRef(internalStatus);
  internalStatusRef.current = internalStatus;

  const duration = externalDuration !== undefined ? externalDuration : internalDuration;
  const status = externalStatus !== undefined ? externalStatus : internalStatus;
  const micMuted = externalMicMuted !== undefined ? externalMicMuted : internalMicMuted;
  const cameraOff = externalCameraOff !== undefined ? externalCameraOff : internalCameraOff;
  const speakerOn = externalSpeakerOn !== undefined ? externalSpeakerOn : internalSpeakerOn;

  const speakerOnRef = useRef(speakerOn);
  speakerOnRef.current = speakerOn;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onCallStatusChangeRef = useRef(onCallStatusChange);
  onCallStatusChangeRef.current = onCallStatusChange;

  const resolvedName = contactName || remoteParticipantName || participantName || 'Friend';
  const resolvedAvatar = contactAvatar || remoteParticipantAvatar;
  const resolvedConversationId = extractConversationId(conversationId, roomName);
  const resolvedRoomName =
    roomName || (resolvedConversationId ? `conversation-${resolvedConversationId}` : 'private-call-room');

  const updateSupabaseCallRow = useCallback(
    async (nextStatus: CallStatus) => {
      onCallStatusChangeRef.current?.(nextStatus);
      const rowId = activeCallRowIdRef.current;
      if (!rowId || !isLiveSupabaseConfigured() || !isUuid(rowId)) return;

      const patch: Record<string, string> = { status: nextStatus };
      if (nextStatus === 'ended' || nextStatus === 'declined' || nextStatus === 'missed') {
        patch.ended_at = new Date().toISOString();
      }

      try {
        await supabase.from('calls').update(patch).eq('id', rowId);
      } catch (err) {
        console.warn('Failed to update Supabase call status:', err);
      }
    },
    []
  );

  const stopDemoStream = useCallback(() => {
    if (demoStreamRef.current) {
      demoStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      demoStreamRef.current = null;
    }
    if (internalLocalVideoRef.current) {
      internalLocalVideoRef.current.srcObject = null;
    }
  }, []);

  const clearRemoteMediaElements = useCallback(() => {
    if (remoteAudioContainerRef.current) {
      remoteAudioContainerRef.current.innerHTML = '';
    }
    if (internalRemoteVideoRef.current) {
      internalRemoteVideoRef.current.srcObject = null;
    }
    setHasRemoteVideo(false);
  }, []);

  const attachLocalTrack = useCallback(
    (publication: LocalTrackPublication) => {
      if (
        publication.source === Track.Source.Camera &&
        publication.videoTrack &&
        internalLocalVideoRef.current
      ) {
        publication.videoTrack.attach(internalLocalVideoRef.current);
      }
    },
    []
  );

  const attachRemoteTrack = useCallback((track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      if (internalRemoteVideoRef.current) {
        track.attach(internalRemoteVideoRef.current);
        setHasRemoteVideo(true);
      }
    } else if (track.kind === Track.Kind.Audio) {
      if (remoteAudioContainerRef.current) {
        const audioEl = track.attach() as HTMLAudioElement;
        audioEl.autoplay = true;
        audioEl.muted = !speakerOnRef.current;
        audioEl.dataset.trackSid = track.sid || '';
        remoteAudioContainerRef.current.appendChild(audioEl);
      }
    }
  }, []);

  // Keep remote audio element mute state synchronized with speaker toggle
  useEffect(() => {
    if (remoteAudioContainerRef.current) {
      const audioEls = remoteAudioContainerRef.current.querySelectorAll('audio');
      audioEls.forEach((el) => {
        el.muted = !speakerOn;
      });
    }
    if (managerRef.current) {
      void managerRef.current.setSpeakerMuted(!speakerOn);
    }
  }, [speakerOn]);

  // Reset modal state on open/close
  useEffect(() => {
    if (!isOpen) {
      isClosingRef.current = false;
      setInternalDuration(0);
      setConnectionQuality('unknown');
      setDeviceWarning(null);
      setStatusBanner(null);
      setAudioPlaybackBlocked(false);
      setIsScreenSharing(false);
      setIsDemoMode(false);
      setHasRemoteVideo(false);
      setIsRemoteSpeaking(false);
      setHasAcceptedIncoming(!isIncoming);
      setInternalStatus(isIncoming ? 'ringing' : 'connecting');
      setInternalCameraOff(callType === 'audio');
      setInternalMicMuted(false);
      activeCallRowIdRef.current = externalCallId || null;
    }
  }, [isOpen, isIncoming, callType, externalCallId]);

  // Duration ticker only while connected
  useEffect(() => {
    if (!isOpen || status !== 'connected' || externalDuration !== undefined) return;
    const timer = setInterval(() => {
      setInternalDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, status, externalDuration]);

  // Controlled-mode fallback connection simulation if no LiveKit identity provided
  useEffect(() => {
    if (!isOpen || !isExternallyControlled) return;
    if (externalStatus !== undefined) return;
    const t = setTimeout(() => setInternalStatus('connected'), 1200);
    return () => clearTimeout(t);
  }, [isOpen, isExternallyControlled, externalStatus]);

  // Integrated LiveKit + Supabase `calls` Realtime Signaling Lifecycle
  useEffect(() => {
    if (!isOpen || isExternallyControlled) return;

    let cancelled = false;
    isClosingRef.current = false;
    let ringTimeout: ReturnType<typeof setTimeout> | null = null;
    let callChannel: ReturnType<typeof supabase.channel> | null = null;

    const closeWithStatus = (banner: string) => {
      if (cancelled || isClosingRef.current) return;
      isClosingRef.current = true;
      setStatusBanner(banner);
      setInternalStatus('ended');
      setTimeout(() => {
        if (!cancelled) onCloseRef.current();
      }, 900);
    };

    const manager = new LiveKitCallManager({
      onTrackSubscribed: (track) => {
        if (cancelled) return;
        attachRemoteTrack(track);
        setInternalStatus('connected');
      },
      onTrackUnsubscribed: (track) => {
        try {
          track.detach();
        } catch {
          // ignore
        }
        if (track.kind === Track.Kind.Video) {
          setHasRemoteVideo(false);
        }
      },
      onLocalTrackPublished: (publication) => {
        if (!cancelled) attachLocalTrack(publication);
      },
      onLocalTrackUnpublished: (publication) => {
        if (publication.source === Track.Source.Camera && internalLocalVideoRef.current) {
          try {
            publication.videoTrack?.detach(internalLocalVideoRef.current);
          } catch {
            // ignore
          }
        }
      },
      onParticipantConnected: () => {
        if (cancelled) return;
        setInternalStatus('connected');
        void updateSupabaseCallRow('ongoing');
      },
      onParticipantDisconnected: () => {
        if (cancelled) return;
        setHasRemoteVideo(false);
        void updateSupabaseCallRow('ended');
        closeWithStatus('Call ended');
      },
      onConnectionStateChanged: (connState) => {
        if (cancelled) return;
        if (connState === ConnectionState.Reconnecting || connState === ConnectionState.SignalReconnecting) {
          setStatusBanner('Reconnecting...');
        } else if (connState === ConnectionState.Connected) {
          setStatusBanner(null);
        }
      },
      onConnectionQualityChanged: (quality, participant) => {
        if (cancelled) return;
        if (participant.isLocal || quality !== 'unknown') {
          setConnectionQuality(quality);
        }
      },
      onActiveSpeakersChanged: (speakerIds) => {
        if (cancelled) return;
        const localId = participantIdentity || '';
        setIsRemoteSpeaking(speakerIds.some((id) => id && id !== localId));
      },
      onAudioPlaybackChanged: (canPlayback) => {
        if (!cancelled) setAudioPlaybackBlocked(!canPlayback);
      },
      onMediaDeviceError: (error) => {
        if (!cancelled) {
          setDeviceWarning(error.message || 'Check microphone/camera permissions');
        }
      },
      onCallEnded: () => {
        if (!cancelled && !isClosingRef.current) {
          setInternalStatus('ended');
        }
      },
    });
    managerRef.current = manager;

    async function setupSignalingAndMedia() {
      // Pre-warm permissions immediately even while ringing
      void manager.prewarmPermissions(callType === 'audio');

      // 1. Setup Supabase `calls` table row & Realtime listener when live DB + UUIDs exist
      const canUseSupabaseCalls =
        isLiveSupabaseConfigured() &&
        isUuid(resolvedConversationId) &&
        isUuid(participantIdentity);

      if (canUseSupabaseCalls) {
        try {
          if (!isIncoming && !activeCallRowIdRef.current) {
            const { data: insertedCall, error: insertError } = await supabase
              .from('calls')
              .insert({
                conversation_id: resolvedConversationId,
                caller_id: participantIdentity,
                call_type: callType,
                room_name: resolvedRoomName,
                status: 'ringing',
              })
              .select('id, status')
              .single();

            if (!insertError && insertedCall?.id && !cancelled) {
              activeCallRowIdRef.current = insertedCall.id;
              setInternalStatus('ringing');
            }
          }

          const watchCallId = activeCallRowIdRef.current;
          if (watchCallId && !cancelled) {
            callChannel = supabase
              .channel(`calls:row:${watchCallId}`)
              .on(
                'postgres_changes',
                {
                  event: 'UPDATE',
                  schema: 'public',
                  table: 'calls',
                  filter: `id=eq.${watchCallId}`,
                },
                (payload: { new?: { status?: CallStatus } }) => {
                  const nextStatus = payload.new?.status;
                  if (!nextStatus || cancelled) return;
                  onCallStatusChangeRef.current?.(nextStatus);
                  if (nextStatus === 'ongoing') {
                    setInternalStatus('connected');
                  } else if (nextStatus === 'declined') {
                    closeWithStatus('Call declined');
                  } else if (nextStatus === 'missed') {
                    closeWithStatus('No answer');
                  } else if (nextStatus === 'ended') {
                    closeWithStatus('Call ended');
                  }
                }
              )
              .subscribe();
          }
        } catch (sigErr) {
          console.warn('Supabase call signaling setup notice:', sigErr);
        }
      }

      // 2. If incoming and not yet accepted, wait for Accept click before connecting LiveKit
      if (!hasAcceptedIncoming) {
        return;
      }

      // 3. Connect to LiveKit SFU (or graceful demo local preview when keys are unset)
      const result = await manager.startCall({
        roomName: resolvedRoomName,
        participantIdentity: participantIdentity || `guest-${Date.now()}`,
        participantName: participantName || resolvedName,
        audioOnly: callType === 'audio',
        prefer1080p: true,
        prewarm: false,
      });

      if (cancelled) {
        await manager.endCall();
        return;
      }

      const statusSnapshot = manager.getStatus();
      setInternalMicMuted(statusSnapshot.isMicMuted);
      setInternalCameraOff(statusSnapshot.isCameraOff);

      if (result.isMock || !result.room) {
        setIsDemoMode(true);
        setConnectionQuality('excellent');
        // Provide clean local camera preview in demo mode if permission is granted
        if (callType === 'video' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
          try {
            const previewStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
              audio: false,
            });
            if (cancelled) {
              previewStream.getTracks().forEach((t) => t.stop());
              return;
            }
            demoStreamRef.current = previewStream;
            if (internalLocalVideoRef.current) {
              internalLocalVideoRef.current.srcObject = previewStream;
            }
          } catch {
            // Permission denied or headless browser — render avatar/camera-off gracefully
          }
        }
        setInternalStatus('connected');
      } else {
        // Attach local camera track if already published
        const camPub = result.room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub) attachLocalTrack(camPub);

        // If remote participant already in room, immediately mark connected; else ring up to 45s
        if (result.room.remoteParticipants.size > 0) {
          setInternalStatus('connected');
          void updateSupabaseCallRow('ongoing');
        } else {
          setInternalStatus(canUseSupabaseCalls ? 'ringing' : 'connected');
          if (canUseSupabaseCalls) {
            ringTimeout = setTimeout(() => {
              if (!cancelled && internalStatusRef.current === 'ringing') {
                void updateSupabaseCallRow('missed');
                closeWithStatus('No answer');
              }
            }, 45000);
          }
        }
      }
    }

    void setupSignalingAndMedia();

    return () => {
      cancelled = true;
      if (ringTimeout) clearTimeout(ringTimeout);
      if (callChannel) {
        void supabase.removeChannel(callChannel);
      }
      stopDemoStream();
      clearRemoteMediaElements();
      void manager.endCall();
      if (managerRef.current === manager) {
        managerRef.current = null;
      }
    };
  }, [
    isOpen,
    isExternallyControlled,
    hasAcceptedIncoming,
    isIncoming,
    callType,
    resolvedRoomName,
    resolvedConversationId,
    participantIdentity,
    participantName,
    resolvedName,
    attachLocalTrack,
    attachRemoteTrack,
    clearRemoteMediaElements,
    stopDemoStream,
    updateSupabaseCallRow,
  ]);

  if (!isOpen) return null;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handleEnd = async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    const finalCallStatus: CallStatus =
      internalStatusRef.current === 'ringing' && !isIncoming ? 'missed' : 'ended';
    await updateSupabaseCallRow(finalCallStatus);

    stopDemoStream();
    clearRemoteMediaElements();
    if (managerRef.current) {
      await managerRef.current.endCall();
    }

    if (onEndCall) {
      onEndCall();
    } else {
      onClose();
    }
  };

  const handleAccept = async () => {
    setHasAcceptedIncoming(true);
    setInternalStatus('connecting');
    await updateSupabaseCallRow('ongoing');
    onAcceptCall?.();
  };

  const handleDecline = async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    await updateSupabaseCallRow('declined');
    stopDemoStream();
    if (managerRef.current) {
      await managerRef.current.endCall();
    }
    if (onDeclineCall) {
      onDeclineCall();
    } else {
      onClose();
    }
  };

  const handleMicToggle = async () => {
    if (onToggleMic) {
      onToggleMic();
      return;
    }
    if (managerRef.current?.getRoom()) {
      const enabled = await managerRef.current.toggleMicrophone();
      setInternalMicMuted(!enabled);
    } else {
      setInternalMicMuted((prev) => !prev);
    }
  };

  const handleCameraToggle = async () => {
    if (onToggleCamera) {
      onToggleCamera();
      return;
    }
    if (managerRef.current?.getRoom()) {
      const enabled = await managerRef.current.toggleCamera();
      setInternalCameraOff(!enabled);
    } else {
      const nextOff = !internalCameraOff;
      setInternalCameraOff(nextOff);
      if (demoStreamRef.current) {
        demoStreamRef.current.getVideoTracks().forEach((t) => {
          t.enabled = !nextOff;
        });
      }
    }
  };

  const handleFlipCamera = async () => {
    if (managerRef.current?.getRoom()) {
      await managerRef.current.switchCamera();
    }
  };

  const handleScreenShareToggle = async () => {
    if (!managerRef.current?.getRoom()) return;
    const sharing = await managerRef.current.toggleScreenShare();
    setIsScreenSharing(sharing);
  };

  const handleSpeakerToggle = () => {
    if (onToggleSpeaker) {
      onToggleSpeaker();
      return;
    }
    setInternalSpeakerOn((prev) => !prev);
  };

  const handleResumeAudio = async () => {
    if (managerRef.current) {
      const ok = await managerRef.current.resumeAudioPlayback();
      setAudioPlaybackBlocked(!ok);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-[#000000] text-white select-none animate-fade-in">
      {/* Hidden container for attached LiveKit remote audio tracks */}
      <div ref={remoteAudioContainerRef} className="hidden" aria-hidden="true" />

      {/* Top Header Bar */}
      <div className="z-20 flex items-center justify-between px-6 py-5 bg-gradient-to-b from-black/85 via-black/45 to-transparent">
        <div>
          <h2 className="text-lg font-bold text-white tracking-wide">
            {resolvedName}
          </h2>
          <div className="text-xs font-medium text-[#A0A0A0] flex items-center gap-1.5 mt-0.5">
            {statusBanner ? (
              <span className="text-amber-300">{statusBanner}</span>
            ) : status === 'connected' ? (
              <>
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>{formatDuration(duration)}</span>
              </>
            ) : status === 'ringing' ? (
              isIncoming
                ? callType === 'video'
                  ? 'Incoming video call...'
                  : 'Incoming voice call...'
                : 'Ringing...'
            ) : status === 'ended' ? (
              'Call ended'
            ) : (
              'Connecting to LiveKit SFU...'
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionQualityMeter quality={connectionQuality} status={status} />
          <div className="hidden sm:block px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] font-medium text-white/80">
            {isDemoMode
              ? 'Local Preview Mode'
              : callType === 'video'
              ? 'Simulcast 1080p • Opus RED'
              : 'Opus 48kHz HD • Low Latency'}
          </div>
        </div>
      </div>

      {/* Warning / Autoplay Recovery Banners */}
      {(audioPlaybackBlocked || deviceWarning) && (
        <div className="z-30 mx-auto flex flex-col items-center gap-2 px-4">
          {audioPlaybackBlocked && (
            <button
              type="button"
              onClick={() => void handleResumeAudio()}
              className="px-4 py-1.5 rounded-full bg-emerald-500 text-black text-xs font-semibold shadow-lg hover:bg-emerald-400 transition"
            >
              Tap to enable call audio
            </button>
          )}
          {deviceWarning && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{deviceWarning}</span>
            </div>
          )}
        </div>
      )}

      {/* Main Call View Stage */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {callType === 'video' ? (
          <>
            {/* Remote Video Track */}
            <div className="w-full h-full flex items-center justify-center bg-[#060606]">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-cover ${
                  hasRemoteVideo || externalRemoteVideoRef ? 'block' : 'hidden'
                }`}
              />
              {!hasRemoteVideo && !externalRemoteVideoRef && (
                <div className="flex flex-col items-center justify-center">
                  {resolvedAvatar ? (
                    <img
                      src={resolvedAvatar}
                      alt={resolvedName}
                      className={`w-28 h-28 rounded-full object-cover border-2 mb-3 transition-all ${
                        isRemoteSpeaking
                          ? 'border-emerald-400 ring-4 ring-emerald-400/30'
                          : 'border-white/20'
                      }`}
                    />
                  ) : (
                    <div
                      className={`w-28 h-28 rounded-full bg-[#1A1A1A] border-2 flex items-center justify-center text-2xl font-bold mb-3 ${
                        isRemoteSpeaking ? 'border-emerald-400' : 'border-white/20'
                      }`}
                    >
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
              ) : (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
              )}
            </div>
          </>
        ) : (
          /* Voice Call Stage: Concentric Audio Wave Pulsing Aura */
          <div className="relative flex flex-col items-center justify-center">
            <div
              className={`absolute w-48 h-48 rounded-full bg-[#E1306C]/15 ${
                isRemoteSpeaking || status === 'ringing' ? 'animate-ping opacity-70' : 'opacity-30'
              }`}
            />
            <div className="absolute w-40 h-40 rounded-full bg-[#0084FF]/20 animate-pulse" />

            {resolvedAvatar ? (
              <img
                src={resolvedAvatar}
                alt={resolvedName}
                className={`relative z-10 w-28 h-28 rounded-full object-cover border-4 shadow-2xl transition-all ${
                  isRemoteSpeaking ? 'border-emerald-400 scale-105' : 'border-white/20'
                }`}
              />
            ) : (
              <div
                className={`relative z-10 w-28 h-28 rounded-full bg-[#1E1E1E] border-4 flex items-center justify-center text-3xl font-bold shadow-2xl text-white ${
                  isRemoteSpeaking ? 'border-emerald-400 scale-105' : 'border-white/20'
                }`}
              >
                {resolvedName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Floating Control Dock */}
      <div className="z-20 flex items-center justify-center pb-8 pt-4 bg-gradient-to-t from-black/90 to-transparent">
        {isIncoming && !hasAcceptedIncoming ? (
          <div className="flex items-center gap-8 px-8 py-4 rounded-full bg-[#141414]/90 border border-[#2A2A2A] shadow-2xl backdrop-blur-xl">
            <button
              type="button"
              onClick={() => void handleDecline()}
              className="p-4 rounded-full bg-[#EF4444] hover:bg-red-600 text-white shadow-lg active:scale-90 transition-transform"
              title="Decline Call"
            >
              <PhoneOff className="w-6 h-6 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => void handleAccept()}
              className="p-4 rounded-full bg-[#10B981] hover:bg-emerald-400 text-black shadow-lg active:scale-90 transition-transform"
              title="Accept Call"
            >
              <Phone className="w-6 h-6 fill-current" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 sm:gap-5 px-5 sm:px-6 py-3.5 sm:py-4 rounded-full bg-[#141414]/90 border border-[#2A2A2A] shadow-2xl backdrop-blur-xl">
            {/* Microphone Toggle */}
            <button
              type="button"
              onClick={() => void handleMicToggle()}
              className={`p-3.5 rounded-full transition-all active:scale-90 ${
                micMuted
                  ? 'bg-red-500/20 text-red-500 border border-red-500/40'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
              title={micMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            >
              {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {/* Camera Toggle & Flip (Video Call Only) */}
            {callType === 'video' && (
              <>
                <button
                  type="button"
                  onClick={() => void handleCameraToggle()}
                  className={`p-3.5 rounded-full transition-all active:scale-90 ${
                    cameraOff
                      ? 'bg-red-500/20 text-red-500 border border-red-500/40'
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                  title={cameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>

                {!onToggleCamera && !cameraOff && (
                  <button
                    type="button"
                    onClick={() => void handleFlipCamera()}
                    className="p-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-90"
                    title="Switch Camera"
                  >
                    <SwitchCamera className="w-5 h-5" />
                  </button>
                )}

                {!onToggleCamera && !isDemoMode && (
                  <button
                    type="button"
                    onClick={() => void handleScreenShareToggle()}
                    className={`hidden sm:inline-flex p-3.5 rounded-full transition-all active:scale-90 ${
                      isScreenSharing
                        ? 'bg-[#0084FF]/30 text-[#38A9FF] border border-[#0084FF]/50'
                        : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                    title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
                  >
                    <MonitorUp className="w-5 h-5" />
                  </button>
                )}
              </>
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
              {speakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>

            {/* End Call / Hang Up Button */}
            <button
              type="button"
              onClick={() => void handleEnd()}
              className="p-4 rounded-full bg-[#EF4444] hover:bg-red-600 text-white shadow-lg active:scale-90 transition-transform"
              title="End Call"
            >
              <PhoneOff className="w-6 h-6 fill-current" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { CallModal };
