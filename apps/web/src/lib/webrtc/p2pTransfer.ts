// apps/web/src/lib/webrtc/p2pTransfer.ts
// High-performance WebRTC DataChannel 1 GB P2P binary chunk streaming engine with backpressure control

export interface P2PTransferMetadata {
  transferId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileHashSha256: string;
  senderId: string;
  receiverId: string;
  conversationId: string;
}

export interface TransferProgress {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  status: 'connecting' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';
  errorMessage?: string;
}

export const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
export const BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB
export const BUFFER_LOW_WATERMARK = 1 * 1024 * 1024; // 1 MB
const HASH_SLICE_BYTES = 4 * 1024 * 1024; // 4 MB incremental read window for large files

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Incremental pure-TS SHA-256 so 1 GB files can be hashed in 4 MB / 64 KB slices without OOM
class IncrementalSha256 {
  private static readonly K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLen = 0;
  private totalBytes = 0;
  private w = new Uint32Array(64);

  update(data: Uint8Array): void {
    this.totalBytes += data.length;
    let offset = 0;

    if (this.bufferLen > 0) {
      const needed = 64 - this.bufferLen;
      if (data.length < needed) {
        this.buffer.set(data, this.bufferLen);
        this.bufferLen += data.length;
        return;
      }
      this.buffer.set(data.subarray(0, needed), this.bufferLen);
      this.compressBlock(this.buffer, 0);
      this.bufferLen = 0;
      offset = needed;
    }

    while (offset + 64 <= data.length) {
      this.compressBlock(data, offset);
      offset += 64;
    }

    if (offset < data.length) {
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLen = data.length - offset;
    }
  }

  digestHex(): string {
    const bitLenHi = Math.floor((this.totalBytes * 8) / 0x100000000);
    const bitLenLo = (this.totalBytes * 8) >>> 0;

    const padLen = this.bufferLen < 56 ? 56 - this.bufferLen : 120 - this.bufferLen;
    const padding = new Uint8Array(padLen + 8);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(padLen, bitLenHi, false);
    view.setUint32(padLen + 4, bitLenLo, false);

    this.update(padding);

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += this.h[i].toString(16).padStart(8, '0');
    }
    return hex;
  }

  private compressBlock(block: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
    }

    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    let f = this.h[5];
    let g = this.h[6];
    let h = this.h[7];

    const K = IncrementalSha256.K;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }
}

export class P2PFileSender {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private file: File;
  private metadata: P2PTransferMetadata;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private isCompleted: boolean = false;
  private currentOffset: number = 0;
  private hasRemoteDescription: boolean = false;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private resumeResolver: (() => void) | null = null;
  private onProgressCallback?: (progress: TransferProgress) => void;
  private signalSender: (signal: any) => void;

  constructor(
    file: File,
    metadata: P2PTransferMetadata,
    signalSender: (signal: any) => void,
    onProgress?: (progress: TransferProgress) => void
  ) {
    this.file = file;
    this.metadata = metadata;
    this.signalSender = signalSender;
    this.onProgressCallback = onProgress;
  }

  public async start(): Promise<void> {
    if (this.isCancelled) return;
    this.close();
    this.hasRemoteDescription = false;
    this.pendingIceCandidates = [];
    this.isCompleted = false;

    this.notifyProgress(0, 'connecting', 0);
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalSender({
          type: 'p2p_ice',
          transferId: this.metadata.transferId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection || this.isCancelled || this.isCompleted) return;
      const state = this.peerConnection.connectionState;
      if (state === 'failed') {
        this.notifyProgress(this.currentOffset, 'failed', 0, 'WebRTC peer connection failed');
      } else if (state === 'closed' && !this.isCompleted) {
        this.notifyProgress(this.currentOffset, 'cancelled', 0);
      }
    };

    // Create reliable binary DataChannel
    this.dataChannel = this.peerConnection.createDataChannel('p2p-file-transfer', {
      ordered: true,
    });
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;

    this.dataChannel.onopen = () => {
      this.streamFile().catch((err) => {
        if (this.isCancelled) return;
        console.error('Unhandled error during P2P file streaming:', err);
        this.notifyProgress(
          this.currentOffset,
          'failed',
          0,
          err?.message || 'DataChannel streaming error'
        );
      });
    };

    this.dataChannel.onerror = () => {
      if (!this.isCancelled && !this.isCompleted) {
        this.notifyProgress(this.currentOffset, 'failed', 0, 'DataChannel transport error');
      }
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'CONTROL') {
          if (msg.action === 'PAUSE') {
            this.isPaused = true;
            this.notifyProgress(this.currentOffset, 'paused', 0);
          } else if (msg.action === 'RESUME') {
            this.resume(false);
          } else if (msg.action === 'CANCEL') {
            this.isCancelled = true;
            this.wakePauseWaiter();
            this.close();
            this.notifyProgress(this.currentOffset, 'cancelled', 0);
          }
        }
      } catch {}
    };

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    this.signalSender({
      type: 'p2p_offer',
      transferId: this.metadata.transferId,
      sdp: this.peerConnection.localDescription || offer,
      metadata: this.metadata,
    });
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection || this.isCancelled) return;
    // Glare/duplicate answer guard
    if (this.peerConnection.signalingState !== 'have-local-offer') {
      return;
    }
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    this.hasRemoteDescription = true;
    await this.flushPendingIceCandidates();
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate || this.isCancelled) return;
    if (!this.peerConnection || !this.hasRemoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Ignored invalid/stale sender ICE candidate:', err);
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.peerConnection || !this.hasRemoteDescription) return;
    const queued = this.pendingIceCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Ignored queued sender ICE candidate error:', err);
      }
    }
  }

  public pause(notifyPeer: boolean = true): void {
    if (this.isCancelled || this.isCompleted) return;
    this.isPaused = true;
    if (notifyPeer && this.dataChannel?.readyState === 'open') {
      try {
        this.dataChannel.send(
          JSON.stringify({ type: 'CONTROL', action: 'PAUSE', transferId: this.metadata.transferId })
        );
      } catch {}
    }
    this.notifyProgress(this.currentOffset, 'paused', 0);
  }

  public resume(notifyPeer: boolean = true): void {
    if (this.isCancelled || this.isCompleted) return;
    if (this.isPaused) {
      this.isPaused = false;
      this.wakePauseWaiter();
      if (notifyPeer && this.dataChannel?.readyState === 'open') {
        try {
          this.dataChannel.send(
            JSON.stringify({ type: 'CONTROL', action: 'RESUME', transferId: this.metadata.transferId })
          );
        } catch {}
      }
      this.notifyProgress(this.currentOffset, 'transferring', 0);
    }
  }

  public cancel(): void {
    if (this.isCancelled) return;
    this.isCancelled = true;
    this.wakePauseWaiter();
    if (this.dataChannel?.readyState === 'open') {
      try {
        this.dataChannel.send(
          JSON.stringify({ type: 'CONTROL', action: 'CANCEL', transferId: this.metadata.transferId })
        );
      } catch {}
    }
    this.close();
    this.notifyProgress(this.currentOffset, 'cancelled', 0);
  }

  private wakePauseWaiter(): void {
    if (this.resumeResolver) {
      const resolve = this.resumeResolver;
      this.resumeResolver = null;
      resolve();
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.isPaused && !this.isCancelled) {
      await new Promise<void>((resolve) => {
        this.resumeResolver = resolve;
      });
    }
  }

  private async streamFile(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    this.currentOffset = 0;
    const totalBytes = this.file.size;
    let lastTime = performance.now();
    let lastUiReport = 0;
    let bytesSinceLastSpeedCheck = 0;
    let currentSpeed = 0;

    try {
      // Send header frame first
      this.dataChannel.send(
        JSON.stringify({
          type: 'HEADER',
          metadata: this.metadata,
        })
      );

      this.notifyProgress(0, 'transferring', 0);

      while (this.currentOffset < totalBytes) {
        if (this.isCancelled) return;

        if (this.isPaused) {
          await this.waitWhilePaused();
          if (this.isCancelled) return;
          lastTime = performance.now();
          bytesSinceLastSpeedCheck = 0;
        }

        // Backpressure control: Wait if buffer exceeds threshold with stall protection
        if (this.dataChannel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
          await new Promise<void>((resolve) => {
            if (!this.dataChannel || this.dataChannel.readyState !== 'open' || this.isCancelled) {
              return resolve();
            }

            let resolved = false;
            let pollTimer: ReturnType<typeof setInterval> | null = null;
            const cleanup = () => {
              if (resolved) return;
              resolved = true;
              if (pollTimer) clearInterval(pollTimer);
              if (this.dataChannel) {
                this.dataChannel.onbufferedamountlow = null;
              }
              resolve();
            };

            this.dataChannel.onbufferedamountlow = () => {
              cleanup();
            };

            pollTimer = setInterval(() => {
              if (
                !this.dataChannel ||
                this.dataChannel.readyState !== 'open' ||
                this.isCancelled ||
                this.dataChannel.bufferedAmount <= BUFFER_LOW_WATERMARK
              ) {
                cleanup();
              }
            }, 50);
          });
        }

        if (this.isCancelled || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

        const slice = this.file.slice(this.currentOffset, this.currentOffset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        this.dataChannel.send(buffer);

        this.currentOffset += buffer.byteLength;
        bytesSinceLastSpeedCheck += buffer.byteLength;

        if (this.isCancelled) return;

        const now = performance.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.4) {
          currentSpeed = bytesSinceLastSpeedCheck / timeDiff;
          bytesSinceLastSpeedCheck = 0;
          lastTime = now;
        }

        // Throttle UI updates slightly on 16k+ chunks while ensuring 100% update fires immediately
        if (now - lastUiReport >= 120 || this.currentOffset >= totalBytes) {
          lastUiReport = now;
          this.notifyProgress(this.currentOffset, 'transferring', currentSpeed);
        }
      }

      if (this.isCancelled || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

      // Wait briefly for SCTP send buffer to drain before signaling EOF
      while (this.dataChannel.bufferedAmount > 0 && this.dataChannel.readyState === 'open' && !this.isCancelled) {
        await new Promise((r) => setTimeout(r, 30));
      }

      if (this.isCancelled || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

      this.dataChannel.send(JSON.stringify({ type: 'EOF', transferId: this.metadata.transferId }));
      this.isCompleted = true;
      this.notifyProgress(totalBytes, 'completed', 0);
    } catch (err: any) {
      if (!this.isCancelled) {
        console.error('P2P streamFile error:', err);
        this.notifyProgress(
          this.currentOffset,
          'failed',
          0,
          err?.message || 'DataChannel streaming failed'
        );
        throw err;
      }
    }
  }

  private notifyProgress(
    bytesTransferred: number,
    status: TransferProgress['status'],
    speed: number = 0,
    errorMessage?: string
  ): void {
    if (this.onProgressCallback) {
      const percentage =
        this.file.size > 0
          ? Math.min(100, Math.round((bytesTransferred / this.file.size) * 100))
          : 100;
      this.onProgressCallback({
        transferId: this.metadata.transferId,
        bytesTransferred,
        totalBytes: this.file.size,
        percentage,
        speedBytesPerSec: speed,
        status,
        errorMessage,
      });
    }
  }

  public close(): void {
    this.wakePauseWaiter();
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
  }
}

export class P2PFileReceiver {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private receivedChunks: ArrayBuffer[] = [];
  private receivedBytes: number = 0;
  private metadata: P2PTransferMetadata | null = null;
  private hasRemoteDescription: boolean = false;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private isCancelled: boolean = false;
  private isCompleted: boolean = false;
  private incrementalHash = new IncrementalSha256();
  private lastSpeedTime = 0;
  private lastUiReport = 0;
  private bytesSinceSpeedCheck = 0;
  private currentSpeed = 0;
  private signalSender: (signal: any) => void;
  private onProgressCallback?: (progress: TransferProgress) => void;
  private onCompleteCallback?: (fileBlob: Blob, metadata: P2PTransferMetadata) => void;

  constructor(
    signalSender: (signal: any) => void,
    onProgress?: (progress: TransferProgress) => void,
    onComplete?: (fileBlob: Blob, metadata: P2PTransferMetadata) => void
  ) {
    this.signalSender = signalSender;
    this.onProgressCallback = onProgress;
    this.onCompleteCallback = onComplete;
  }

  public async handleOffer(
    offer: RTCSessionDescriptionInit,
    metadata: P2PTransferMetadata
  ): Promise<void> {
    if (this.isCancelled) return;

    // Reset state safely on fresh offer (prevents glare/stale channel issues)
    this.closeConnectionOnly();
    this.metadata = metadata;
    this.receivedChunks = [];
    this.receivedBytes = 0;
    this.hasRemoteDescription = false;
    this.isCompleted = false;
    this.incrementalHash = new IncrementalSha256();
    this.lastSpeedTime = performance.now();
    this.lastUiReport = 0;
    this.bytesSinceSpeedCheck = 0;
    this.currentSpeed = 0;

    this.notifyProgress('connecting', 0);

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalSender({
          type: 'p2p_ice',
          transferId: metadata.transferId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection || this.isCancelled || this.isCompleted) return;
      if (this.peerConnection.connectionState === 'failed') {
        this.notifyProgress('failed', 0, 'WebRTC peer connection failed');
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.dataChannel.binaryType = 'arraybuffer';
      this.dataChannel.onmessage = (msgEvent) => this.handleDataChannelMessage(msgEvent);
      this.dataChannel.onerror = () => {
        if (!this.isCancelled && !this.isCompleted) {
          this.notifyProgress('failed', 0, 'DataChannel reception error');
        }
      };
    };

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    this.hasRemoteDescription = true;
    await this.flushPendingIceCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this.signalSender({
      type: 'p2p_answer',
      transferId: metadata.transferId,
      sdp: this.peerConnection.localDescription || answer,
    });
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate || this.isCancelled) return;
    if (!this.peerConnection || !this.hasRemoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Ignored invalid/stale receiver ICE candidate:', err);
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.peerConnection || !this.hasRemoteDescription) return;
    const queued = this.pendingIceCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Ignored queued receiver ICE candidate error:', err);
      }
    }
  }

  public pause(): void {
    if (this.isCancelled || this.isCompleted) return;
    if (this.dataChannel?.readyState === 'open' && this.metadata) {
      try {
        this.dataChannel.send(
          JSON.stringify({ type: 'CONTROL', action: 'PAUSE', transferId: this.metadata.transferId })
        );
      } catch {}
    }
    this.notifyProgress('paused', 0);
  }

  public resume(): void {
    if (this.isCancelled || this.isCompleted) return;
    if (this.dataChannel?.readyState === 'open' && this.metadata) {
      try {
        this.dataChannel.send(
          JSON.stringify({ type: 'CONTROL', action: 'RESUME', transferId: this.metadata.transferId })
        );
      } catch {}
    }
    this.notifyProgress('transferring', this.currentSpeed);
  }

  public cancel(): void {
    if (this.isCancelled) return;
    this.isCancelled = true;
    if (this.dataChannel?.readyState === 'open' && this.metadata) {
      try {
        this.dataChannel.send(
          JSON.stringify({ type: 'CONTROL', action: 'CANCEL', transferId: this.metadata.transferId })
        );
      } catch {}
    }
    this.close();
    this.notifyProgress('cancelled', 0);
  }

  private async handleDataChannelMessage(event: MessageEvent): Promise<void> {
    if (this.isCancelled) return;
    try {
      if (typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'HEADER' && payload.metadata) {
            this.metadata = { ...this.metadata, ...payload.metadata };
            this.notifyProgress('transferring', 0);
          } else if (payload.type === 'CONTROL') {
            if (payload.action === 'PAUSE') this.notifyProgress('paused', 0);
            else if (payload.action === 'RESUME') {
              this.lastSpeedTime = performance.now();
              this.bytesSinceSpeedCheck = 0;
              this.notifyProgress('transferring', 0);
            } else if (payload.action === 'CANCEL') {
              this.isCancelled = true;
              this.close();
              this.notifyProgress('cancelled', 0);
            }
          } else if (payload.type === 'EOF') {
            await this.finalizeFile();
          }
        } catch (err) {
          console.warn('Received text frame in DataChannel:', event.data, err);
        }
        return;
      }

      const chunk =
        event.data instanceof ArrayBuffer
          ? event.data
          : await (event.data as Blob).arrayBuffer();

      this.receivedChunks.push(chunk);
      this.receivedBytes += chunk.byteLength;
      this.incrementalHash.update(new Uint8Array(chunk));
      this.bytesSinceSpeedCheck += chunk.byteLength;

      const now = performance.now();
      const timeDiff = (now - this.lastSpeedTime) / 1000;
      if (timeDiff >= 0.4) {
        this.currentSpeed = this.bytesSinceSpeedCheck / timeDiff;
        this.bytesSinceSpeedCheck = 0;
        this.lastSpeedTime = now;
      }

      if (
        this.metadata &&
        (now - this.lastUiReport >= 120 || this.receivedBytes >= this.metadata.fileSize)
      ) {
        this.lastUiReport = now;
        this.notifyProgress('transferring', this.currentSpeed);
      }
    } catch (err: any) {
      console.error('Error handling DataChannel message:', err);
      this.notifyProgress('failed', 0, err?.message || 'DataChannel reception error');
    }
  }

  private async finalizeFile(): Promise<void> {
    if (!this.metadata || this.isCancelled) return;

    try {
      const fileBlob = new Blob(this.receivedChunks, {
        type: this.metadata.fileType || 'application/octet-stream',
      });
      // Release chunk array references promptly so Blob owns the backing memory
      this.receivedChunks = [];

      const calculatedHash = this.incrementalHash.digestHex();
      const expectedHash = (this.metadata.fileHashSha256 || '').trim().toLowerCase();

      if (expectedHash && calculatedHash.toLowerCase() !== expectedHash) {
        this.notifyProgress(
          'failed',
          0,
          'SHA-256 checksum mismatch. File integrity verification failed.'
        );
        return;
      }

      this.isCompleted = true;
      this.notifyProgress('completed', 0);

      if (this.onCompleteCallback) {
        this.onCompleteCallback(fileBlob, {
          ...this.metadata,
          fileHashSha256: calculatedHash,
        });
      }
    } catch (err: any) {
      console.error('Error finalizing P2P file:', err);
      this.notifyProgress('failed', 0, err?.message || 'File assembly failed');
    }
  }

  private notifyProgress(
    status: TransferProgress['status'],
    speed: number = 0,
    errorMessage?: string
  ): void {
    if (!this.metadata || !this.onProgressCallback) return;
    const percentage =
      status === 'completed'
        ? 100
        : this.metadata.fileSize > 0
        ? Math.min(100, Math.round((this.receivedBytes / this.metadata.fileSize) * 100))
        : 100;

    this.onProgressCallback({
      transferId: this.metadata.transferId,
      bytesTransferred: this.receivedBytes,
      totalBytes: this.metadata.fileSize,
      percentage,
      speedBytesPerSec: speed,
      status,
      errorMessage,
    });
  }

  private closeConnectionOnly(): void {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
  }

  public close(): void {
    this.closeConnectionOnly();
    this.receivedChunks = [];
    this.pendingIceCandidates = [];
  }
}

// Memory-safe SHA-256 calculation for files up to 1 GB
export async function calculateFileSha256(file: File): Promise<string> {
  if (file.size <= 128 * 1024 * 1024 && typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const hasher = new IncrementalSha256();
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + HASH_SLICE_BYTES);
    const buf = await slice.arrayBuffer();
    hasher.update(new Uint8Array(buf));
    offset += buf.byteLength;
  }
  return hasher.digestHex();
}
