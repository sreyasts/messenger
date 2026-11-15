// apps/web/src/lib/livekit/LiveKitManager.ts
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteTrack,
  VideoPresets,
  Track,
} from 'livekit-client';

export interface LiveKitConfig {
  roomName: string;
  participantIdentity: string;
  participantName: string;
  audioOnly?: boolean;
}

export class LiveKitCallManager {
  private room: Room | null = null;
  private isConnected: boolean = false;
  private isMicMuted: boolean = false;
  private isCameraOff: boolean = false;
  private isScreenSharing: boolean = false;

  private onTrackSubscribedCallback?: (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => void;
  private onTrackUnsubscribedCallback?: (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => void;
  private onParticipantDisconnectedCallback?: (participant: RemoteParticipant) => void;
  private onCallEndedCallback?: () => void;

  constructor(callbacks?: {
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
    onParticipantDisconnected?: (participant: RemoteParticipant) => void;
    onCallEnded?: () => void;
  }) {
    if (callbacks) {
      this.onTrackSubscribedCallback = callbacks.onTrackSubscribed;
      this.onTrackUnsubscribedCallback = callbacks.onTrackUnsubscribed;
      this.onParticipantDisconnectedCallback = callbacks.onParticipantDisconnected;
      this.onCallEndedCallback = callbacks.onCallEnded;
    }
  }

  public async startCall(config: LiveKitConfig): Promise<{ room: Room; url: string }> {
    // 1. Fetch token from Supabase Edge Function
    let token = '';
    let livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://demo.livekit.cloud';

    try {
      const response = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (response.ok) {
        const data = await response.json();
        token = data.token;
        if (data.livekitUrl) livekitUrl = data.livekitUrl;
      }
    } catch (err) {
      console.warn('Failed to fetch from livekit-token endpoint, using mock session', err);
    }

    // 2. Instantiate LiveKit Room with Opus and adaptive video settings
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
      publishDefaults: {
        videoCodec: 'vp8',
        dtx: true,
        red: true,
      },
    });

    this.setupListeners();

    if (token) {
      try {
        await this.room.connect(livekitUrl, token);
        this.isConnected = true;

        // Enable local mic with error boundary
        try {
          await this.room.localParticipant.setMicrophoneEnabled(true);
        } catch (micErr) {
          console.warn('Microphone permission not granted or device unavailable:', micErr);
          this.isMicMuted = true;
        }

        // Enable local camera if not audio-only with error boundary
        if (!config.audioOnly) {
          try {
            await this.room.localParticipant.setCameraEnabled(true);
          } catch (camErr) {
            console.warn('Camera permission not granted or device unavailable:', camErr);
            this.isCameraOff = true;
          }
        }
      } catch (connErr) {
        console.error('Failed to connect to LiveKit room:', connErr);
        this.isConnected = false;
        if (this.onCallEndedCallback) {
          this.onCallEndedCallback();
        }
        throw connErr;
      }
    }

    return { room: this.room, url: livekitUrl };
  }

  private setupListeners(): void {
    if (!this.room) return;

    this.room
      .on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant
        ) => {
          if (this.onTrackSubscribedCallback) {
            this.onTrackSubscribedCallback(track, publication, participant);
          }
        }
      )
      .on(
        RoomEvent.TrackUnsubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant
        ) => {
          if (this.onTrackUnsubscribedCallback) {
            this.onTrackUnsubscribedCallback(track, publication, participant);
          }
        }
      )
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        if (this.onParticipantDisconnectedCallback) {
          this.onParticipantDisconnectedCallback(participant);
        }
      })
      .on(RoomEvent.Disconnected, () => {
        this.isConnected = false;
        if (this.onCallEndedCallback) {
          this.onCallEndedCallback();
        }
      });
  }

  public async toggleMicrophone(): Promise<boolean> {
    if (!this.room || !this.room.localParticipant) return false;
    try {
      this.isMicMuted = !this.isMicMuted;
      await this.room.localParticipant.setMicrophoneEnabled(!this.isMicMuted);
      return !this.isMicMuted;
    } catch (err) {
      console.warn('Failed to toggle microphone:', err);
      return !this.isMicMuted;
    }
  }

  public async toggleCamera(): Promise<boolean> {
    if (!this.room || !this.room.localParticipant) return false;
    try {
      this.isCameraOff = !this.isCameraOff;
      await this.room.localParticipant.setCameraEnabled(!this.isCameraOff);
      return !this.isCameraOff;
    } catch (err) {
      console.warn('Failed to toggle camera:', err);
      return !this.isCameraOff;
    }
  }

  public async toggleScreenShare(): Promise<boolean> {
    if (!this.room || !this.room.localParticipant) return false;
    try {
      this.isScreenSharing = !this.isScreenSharing;
      await this.room.localParticipant.setScreenShareEnabled(this.isScreenSharing);
      return this.isScreenSharing;
    } catch (err) {
      console.warn('Failed to toggle screen share:', err);
      this.isScreenSharing = false;
      return false;
    }
  }

  public async endCall(): Promise<void> {
    try {
      if (this.room) {
        await this.room.disconnect();
      }
    } catch (err) {
      console.warn('Error disconnecting from LiveKit room:', err);
    } finally {
      this.room = null;
      this.isConnected = false;
      if (this.onCallEndedCallback) {
        this.onCallEndedCallback();
      }
    }
  }

  public getRoom(): Room | null {
    return this.room;
  }
}
