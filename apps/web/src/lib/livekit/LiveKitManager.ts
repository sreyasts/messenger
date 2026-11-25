// apps/web/src/lib/livekit/LiveKitManager.ts
import {
  AudioPresets,
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  LocalParticipant,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoCodec,
  VideoPresets,
  supportsAudioOutputSelection,
  supportsVP9,
} from 'livekit-client';

export type CallConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export interface LiveKitConfig {
  roomName: string;
  participantIdentity: string;
  participantName: string;
  audioOnly?: boolean;
  videoCodec?: VideoCodec;
  prefer1080p?: boolean;
  prewarm?: boolean;
  iceServers?: RTCIceServer[];
  speakerDeviceId?: string;
}

export interface LiveKitCallbacks {
  onTrackSubscribed?: (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => void;
  onTrackUnsubscribed?: (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => void;
  onLocalTrackPublished?: (
    publication: LocalTrackPublication,
    participant: LocalParticipant
  ) => void;
  onLocalTrackUnpublished?: (
    publication: LocalTrackPublication,
    participant: LocalParticipant
  ) => void;
  onParticipantConnected?: (participant: RemoteParticipant) => void;
  onParticipantDisconnected?: (participant: RemoteParticipant) => void;
  onConnectionStateChanged?: (state: ConnectionState) => void;
  onConnectionQualityChanged?: (
    quality: CallConnectionQuality,
    participant: Participant
  ) => void;
  onActiveSpeakersChanged?: (speakerIdentities: string[]) => void;
  onAudioPlaybackChanged?: (canPlayback: boolean) => void;
  onMediaDeviceError?: (error: Error) => void;
  onCallEnded?: (reason?: DisconnectReason) => void;
}

export interface LiveKitStartResult {
  room: Room | null;
  url: string;
  isMock: boolean;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function mapConnectionQuality(quality: ConnectionQuality): CallConnectionQuality {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    case ConnectionQuality.Lost:
      return 'lost';
    default:
      return 'unknown';
  }
}

export class LiveKitCallManager {
  private room: Room | null = null;
  private isConnected = false;
  private isMicMuted = false;
  private isCameraOff = false;
  private isScreenSharing = false;
  private isSpeakerMuted = false;
  private facingMode: 'user' | 'environment' = 'user';
  private activeSessionSeq = 0;
  private hasEndedCallbackFired = false;

  private callbacks: LiveKitCallbacks;

  constructor(callbacks?: LiveKitCallbacks) {
    this.callbacks = callbacks ? { ...callbacks } : {};
  }

  /**
   * Pre-warms browser microphone/camera permissions and hardware before joining
   * so call pickup feels instant with zero dangling tracks.
   */
  public async prewarmPermissions(audioOnly = false): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: audioOnly
          ? false
          : {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
              facingMode: this.facingMode,
            },
      });
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore cleanup failure
        }
      });
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Media permission unavailable');
      this.callbacks.onMediaDeviceError?.(error);
      return false;
    }
  }

  public async startCall(config: LiveKitConfig): Promise<LiveKitStartResult> {
    const sessionSeq = ++this.activeSessionSeq;
    this.hasEndedCallbackFired = false;
    this.isCameraOff = !!config.audioOnly;
    this.isMicMuted = false;
    this.isScreenSharing = false;

    if (config.prewarm) {
      await this.prewarmPermissions(!!config.audioOnly);
      if (sessionSeq !== this.activeSessionSeq) {
        return { room: null, url: '', isMock: true };
      }
    }

    // 1. Fetch token from Next.js API route (which proxies to Edge Function or signs locally)
    let token = '';
    let livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://demo.livekit.cloud';
    let isMock = true;

    try {
      const response = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: config.roomName,
          participantIdentity: config.participantIdentity,
          participantName: config.participantName,
        }),
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? AbortSignal.timeout(6000)
          : undefined,
      });

      if (response.ok) {
        const data = await response.json();
        token = typeof data?.token === 'string' ? data.token : '';
        if (typeof data?.livekitUrl === 'string' && data.livekitUrl) {
          livekitUrl = data.livekitUrl;
        }
        isMock = Boolean(data?.isMock) || token.startsWith('mock-livekit-jwt-');
      }
    } catch (err) {
      console.warn('Failed to fetch from livekit-token endpoint, falling back to local preview mode:', err);
      isMock = true;
    }

    if (sessionSeq !== this.activeSessionSeq) {
      return { room: null, url: livekitUrl, isMock };
    }

    // Never attempt a doomed WebSocket handshake with a mock JWT
    if (!token || isMock) {
      return { room: null, url: livekitUrl, isMock: true };
    }

    const prefer1080p = config.prefer1080p ?? true;
    const requestedCodec: VideoCodec =
      config.videoCodec === 'vp9' && !supportsVP9()
        ? 'vp8'
        : config.videoCodec || 'vp8';

    // 2. Instantiate LiveKit Room tuned for high quality + lowest latency
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      singlePeerConnection: true,
      stopLocalTrackOnUnpublish: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
        latency: 0.01,
      },
      videoCaptureDefaults: {
        resolution: prefer1080p
          ? VideoPresets.h1080.resolution
          : VideoPresets.h720.resolution,
        frameRate: 30,
        facingMode: this.facingMode,
      },
      audioOutput: config.speakerDeviceId
        ? { deviceId: config.speakerDeviceId }
        : undefined,
      publishDefaults: {
        videoCodec: requestedCodec,
        backupCodec: true,
        simulcast: true,
        degradationPreference: 'maintain-framerate',
        videoEncoding: {
          ...(prefer1080p
            ? VideoPresets.h1080.encoding
            : VideoPresets.h720.encoding),
          priority: 'high',
        },
        videoSimulcastLayers: prefer1080p
          ? [VideoPresets.h720, VideoPresets.h360]
          : [VideoPresets.h360, VideoPresets.h180],
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
        screenShareSimulcastLayers: [ScreenSharePresets.h720fps15],
        audioPreset: {
          ...AudioPresets.musicHighQuality,
          priority: 'high',
        },
        // DTX off prevents word-start clipping; RED + Opus FEC recover lost packets
        dtx: false,
        red: true,
      },
    });

    this.room = room;
    this.setupListeners(room);

    try {
      // Pre-warm DNS + TLS + edge data center selection before WebSocket connect
      try {
        await room.prepareConnection(livekitUrl, token);
      } catch {
        // Non-fatal; connect() proceeds directly
      }

      if (sessionSeq !== this.activeSessionSeq) {
        await this.safeDisconnect(room);
        return { room: null, url: livekitUrl, isMock: false };
      }

      await room.connect(livekitUrl, token, {
        autoSubscribe: true,
        peerConnectionTimeout: 10000,
        rtcConfig: {
          iceServers:
            config.iceServers && config.iceServers.length > 0
              ? config.iceServers
              : DEFAULT_ICE_SERVERS,
          iceCandidatePoolSize: 4,
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
        },
      });

      if (sessionSeq !== this.activeSessionSeq) {
        await this.safeDisconnect(room);
        return { room: null, url: livekitUrl, isMock: false };
      }

      this.isConnected = true;

      // Enable local mic with isolated error boundary
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        this.isMicMuted = !room.localParticipant.isMicrophoneEnabled;
      } catch (micErr) {
        console.warn('Microphone permission not granted or device unavailable:', micErr);
        this.isMicMuted = true;
        this.callbacks.onMediaDeviceError?.(
          micErr instanceof Error ? micErr : new Error('Microphone unavailable')
        );
      }

      // Enable local camera if video call
      if (!config.audioOnly) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          this.isCameraOff = !room.localParticipant.isCameraEnabled;
        } catch (camErr) {
          console.warn('Camera permission not granted or device unavailable:', camErr);
          this.isCameraOff = true;
          this.callbacks.onMediaDeviceError?.(
            camErr instanceof Error ? camErr : new Error('Camera unavailable')
          );
        }
      }

      // Attach any already-present remote participants/tracks
      room.remoteParticipants.forEach((participant) => {
        this.callbacks.onParticipantConnected?.(participant);
        participant.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track) {
            this.callbacks.onTrackSubscribed?.(pub.track, pub, participant);
          }
        });
      });

      this.callbacks.onAudioPlaybackChanged?.(room.canPlaybackAudio);

      return { room, url: livekitUrl, isMock: false };
    } catch (connErr) {
      console.error('Failed to connect to LiveKit room:', connErr);
      this.isConnected = false;
      await this.safeDisconnect(room);
      if (this.room === room) {
        this.room = null;
      }
      if (!this.hasEndedCallbackFired) {
        this.hasEndedCallbackFired = true;
        this.callbacks.onCallEnded?.();
      }
      return { room: null, url: livekitUrl, isMock: false };
    }
  }

  private setupListeners(room: Room): void {
    room
      .on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant
        ) => {
          this.callbacks.onTrackSubscribed?.(track, publication, participant);
        }
      )
      .on(
        RoomEvent.TrackUnsubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant
        ) => {
          this.callbacks.onTrackUnsubscribed?.(track, publication, participant);
        }
      )
      .on(
        RoomEvent.LocalTrackPublished,
        (publication: LocalTrackPublication, participant: LocalParticipant) => {
          this.callbacks.onLocalTrackPublished?.(publication, participant);
        }
      )
      .on(
        RoomEvent.LocalTrackUnpublished,
        (publication: LocalTrackPublication, participant: LocalParticipant) => {
          this.callbacks.onLocalTrackUnpublished?.(publication, participant);
        }
      )
      .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        this.callbacks.onParticipantConnected?.(participant);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        this.callbacks.onParticipantDisconnected?.(participant);
      })
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        this.isConnected = state === ConnectionState.Connected;
        this.callbacks.onConnectionStateChanged?.(state);
      })
      .on(
        RoomEvent.ConnectionQualityChanged,
        (quality: ConnectionQuality, participant: Participant) => {
          this.callbacks.onConnectionQualityChanged?.(
            mapConnectionQuality(quality),
            participant
          );
        }
      )
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.callbacks.onActiveSpeakersChanged?.(speakers.map((s) => s.identity));
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, (playing: boolean) => {
        this.callbacks.onAudioPlaybackChanged?.(playing);
      })
      .on(RoomEvent.MediaDevicesError, (error: Error) => {
        this.callbacks.onMediaDeviceError?.(error);
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.isConnected = false;
        if (!this.hasEndedCallbackFired) {
          this.hasEndedCallbackFired = true;
          this.callbacks.onCallEnded?.(reason);
        }
      });
  }

  public async toggleMicrophone(): Promise<boolean> {
    return this.setMicrophoneEnabled(this.isMicMuted);
  }

  public async setMicrophoneEnabled(enabled: boolean): Promise<boolean> {
    if (!this.room?.localParticipant) {
      this.isMicMuted = !enabled;
      return enabled;
    }
    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
      this.isMicMuted = !this.room.localParticipant.isMicrophoneEnabled;
      return !this.isMicMuted;
    } catch (err) {
      console.warn('Failed to toggle microphone:', err);
      this.callbacks.onMediaDeviceError?.(
        err instanceof Error ? err : new Error('Failed to toggle microphone')
      );
      return !this.isMicMuted;
    }
  }

  public async toggleCamera(): Promise<boolean> {
    return this.setCameraEnabled(this.isCameraOff);
  }

  public async setCameraEnabled(enabled: boolean): Promise<boolean> {
    if (!this.room?.localParticipant) {
      this.isCameraOff = !enabled;
      return enabled;
    }
    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
      this.isCameraOff = !this.room.localParticipant.isCameraEnabled;
      return !this.isCameraOff;
    } catch (err) {
      console.warn('Failed to toggle camera:', err);
      this.callbacks.onMediaDeviceError?.(
        err instanceof Error ? err : new Error('Failed to toggle camera')
      );
      return !this.isCameraOff;
    }
  }

  public async switchCamera(): Promise<'user' | 'environment'> {
    const nextFacing = this.facingMode === 'user' ? 'environment' : 'user';
    if (!this.room?.localParticipant) {
      this.facingMode = nextFacing;
      return this.facingMode;
    }
    try {
      const devices = await Room.getLocalDevices('videoinput', false);
      const currentId = this.room.getActiveDevice('videoinput');
      if (devices.length > 1) {
        const idx = devices.findIndex((d) => d.deviceId === currentId);
        const nextDevice = devices[(idx + 1) % devices.length];
        if (nextDevice?.deviceId) {
          await this.room.switchActiveDevice('videoinput', nextDevice.deviceId);
          this.facingMode = nextFacing;
          return this.facingMode;
        }
      }
      // Fallback: restart camera track with flipped facingMode
      const camPub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.videoTrack) {
        await camPub.videoTrack.restartTrack({ facingMode: nextFacing });
        this.facingMode = nextFacing;
      }
    } catch (err) {
      console.warn('Failed to switch camera:', err);
    }
    return this.facingMode;
  }

  public async toggleScreenShare(): Promise<boolean> {
    if (!this.room?.localParticipant) return false;
    const next = !this.isScreenSharing;
    try {
      await this.room.localParticipant.setScreenShareEnabled(next);
      this.isScreenSharing = this.room.localParticipant.isScreenShareEnabled;
      return this.isScreenSharing;
    } catch (err) {
      console.warn('Failed to toggle screen share:', err);
      this.isScreenSharing = false;
      return false;
    }
  }

  public async setSpeakerMuted(muted: boolean): Promise<void> {
    this.isSpeakerMuted = muted;
    if (!this.room) return;
    try {
      this.room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((pub) => {
          if (pub.audioTrack) {
            pub.audioTrack.attachedElements.forEach((el) => {
              el.muted = muted;
            });
          }
        });
      });
    } catch (err) {
      console.warn('Failed to update speaker mute state:', err);
    }
  }

  public async switchAudioOutput(deviceId: string): Promise<boolean> {
    if (!this.room || !supportsAudioOutputSelection()) return false;
    try {
      return await this.room.switchActiveDevice('audiooutput', deviceId);
    } catch (err) {
      console.warn('Failed to switch audio output:', err);
      return false;
    }
  }

  public async getAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return await Room.getLocalDevices('audiooutput', false);
    } catch {
      return [];
    }
  }

  public async resumeAudioPlayback(): Promise<boolean> {
    if (!this.room) return true;
    try {
      await this.room.startAudio();
      this.callbacks.onAudioPlaybackChanged?.(this.room.canPlaybackAudio);
      return this.room.canPlaybackAudio;
    } catch (err) {
      console.warn('Failed to resume audio playback:', err);
      return false;
    }
  }

  private async safeDisconnect(room: Room): Promise<void> {
    try {
      room.removeAllListeners();
      await room.disconnect(true);
    } catch (err) {
      console.warn('Error disconnecting LiveKit room:', err);
    }
  }

  public async endCall(): Promise<void> {
    this.activeSessionSeq++;
    const currentRoom = this.room;
    this.room = null;
    this.isConnected = false;

    if (currentRoom) {
      await this.safeDisconnect(currentRoom);
    }

    if (!this.hasEndedCallbackFired) {
      this.hasEndedCallbackFired = true;
      this.callbacks.onCallEnded?.();
    }
  }

  public getRoom(): Room | null {
    return this.room;
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      isMicMuted: this.isMicMuted,
      isCameraOff: this.isCameraOff,
      isScreenSharing: this.isScreenSharing,
      isSpeakerMuted: this.isSpeakerMuted,
      facingMode: this.facingMode,
    };
  }
}
