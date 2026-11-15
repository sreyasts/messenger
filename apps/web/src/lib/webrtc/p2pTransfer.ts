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

const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
const BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB
const BUFFER_LOW_WATERMARK = 1 * 1024 * 1024; // 1 MB

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class P2PFileSender {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private file: File;
  private metadata: P2PTransferMetadata;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private currentOffset: number = 0;
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
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalSender({
          type: 'p2p_ice',
          transferId: this.metadata.transferId,
          candidate: event.candidate,
        });
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
        console.error('Unhandled error during P2P file streaming:', err);
        this.notifyProgress(this.currentOffset, 'failed', 0);
        if (this.onProgressCallback) {
          this.onProgressCallback({
            transferId: this.metadata.transferId,
            bytesTransferred: this.currentOffset,
            totalBytes: this.file.size,
            percentage: this.file.size > 0 ? Math.min(100, Math.round((this.currentOffset / this.file.size) * 100)) : 0,
            speedBytesPerSec: 0,
            status: 'failed',
            errorMessage: err?.message || 'DataChannel streaming error',
          });
        }
      });
    };

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    this.signalSender({
      type: 'p2p_offer',
      transferId: this.metadata.transferId,
      sdp: offer,
      metadata: this.metadata,
    });
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.peerConnection) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  public pause(): void {
    this.isPaused = true;
    this.notifyProgress(this.currentOffset, 'paused');
  }

  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
    }
  }

  public cancel(): void {
    this.isCancelled = true;
    this.close();
    this.notifyProgress(this.currentOffset, 'cancelled');
  }

  private async streamFile(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    this.currentOffset = 0;
    const totalBytes = this.file.size;
    let lastTime = performance.now();
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

      while (this.currentOffset < totalBytes) {
        if (this.isCancelled) return;

        while (this.isPaused) {
          await new Promise((res) => setTimeout(res, 200));
          if (this.isCancelled) return;
        }

        // Backpressure control: Wait if buffer exceeds threshold with stall protection
        if (this.dataChannel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
          await new Promise<void>((resolve) => {
            if (!this.dataChannel || this.dataChannel.readyState !== 'open' || this.isCancelled) {
              return resolve();
            }

            let resolved = false;
            let pollTimer: NodeJS.Timeout | null = null;
            const cleanup = () => {
              if (resolved) return;
              resolved = true;
              if (pollTimer) clearInterval(pollTimer);
              if (this.dataChannel && this.dataChannel.onbufferedamountlow) {
                this.dataChannel.onbufferedamountlow = null;
              }
              resolve();
            };

            this.dataChannel.onbufferedamountlow = () => {
              cleanup();
            };

            // Safeguard against edge-trigger misses, sudden connection closes, or buffer stalls
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
        if (timeDiff >= 0.5) {
          currentSpeed = bytesSinceLastSpeedCheck / timeDiff;
          bytesSinceLastSpeedCheck = 0;
          lastTime = now;
        }

        this.notifyProgress(this.currentOffset, 'transferring', currentSpeed);
      }

      if (this.isCancelled || !this.dataChannel || this.dataChannel.readyState !== 'open') return;

      // Send EOF frame
      this.dataChannel.send(JSON.stringify({ type: 'EOF', transferId: this.metadata.transferId }));
      this.notifyProgress(totalBytes, 'completed', 0);
    } catch (err: any) {
      if (!this.isCancelled) {
        console.error('P2P streamFile error:', err);
        this.notifyProgress(this.currentOffset, 'failed', 0);
        throw err;
      }
    }
  }

  private notifyProgress(
    bytesTransferred: number,
    status: TransferProgress['status'],
    speed: number = 0
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
      });
    }
  }

  public close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
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
    this.metadata = metadata;
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalSender({
          type: 'p2p_ice',
          transferId: metadata.transferId,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.dataChannel.binaryType = 'arraybuffer';
      this.dataChannel.onmessage = (msgEvent) => this.handleDataChannelMessage(msgEvent);
    };

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this.signalSender({
      type: 'p2p_answer',
      transferId: metadata.transferId,
      sdp: answer,
    });
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.peerConnection) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private async handleDataChannelMessage(event: MessageEvent): Promise<void> {
    try {
      if (typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'EOF') {
            await this.finalizeFile();
          }
        } catch (err) {
          console.warn('Received text frame in DataChannel:', event.data, err);
        }
        return;
      }

      const chunk = event.data as ArrayBuffer;
      this.receivedChunks.push(chunk);
      this.receivedBytes += chunk.byteLength;

      if (this.metadata && this.onProgressCallback) {
        const percentage =
          this.metadata.fileSize > 0
            ? Math.min(
                100,
                Math.round((this.receivedBytes / this.metadata.fileSize) * 100)
              )
            : 100;
        this.onProgressCallback({
          transferId: this.metadata.transferId,
          bytesTransferred: this.receivedBytes,
          totalBytes: this.metadata.fileSize,
          percentage,
          speedBytesPerSec: 0,
          status: 'transferring',
        });
      }
    } catch (err: any) {
      console.error('Error handling DataChannel message:', err);
      if (this.metadata && this.onProgressCallback) {
        this.onProgressCallback({
          transferId: this.metadata.transferId,
          bytesTransferred: this.receivedBytes,
          totalBytes: this.metadata.fileSize,
          percentage: 0,
          speedBytesPerSec: 0,
          status: 'failed',
          errorMessage: err?.message || 'DataChannel reception error',
        });
      }
    }
  }

  private async finalizeFile(): Promise<void> {
    if (!this.metadata) return;

    try {
      const fileBlob = new Blob(this.receivedChunks, {
        type: this.metadata.fileType || 'application/octet-stream',
      });

      // Verify SHA-256 integrity
      const arrayBuffer = await fileBlob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const calculatedHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      if (calculatedHash.toLowerCase() !== this.metadata.fileHashSha256.toLowerCase()) {
        if (this.onProgressCallback) {
          this.onProgressCallback({
            transferId: this.metadata.transferId,
            bytesTransferred: this.receivedBytes,
            totalBytes: this.metadata.fileSize,
            percentage: 100,
            speedBytesPerSec: 0,
            status: 'failed',
            errorMessage: 'SHA-256 checksum mismatch. File integrity verification failed.',
          });
        }
        return;
      }

      if (this.onProgressCallback) {
        this.onProgressCallback({
          transferId: this.metadata.transferId,
          bytesTransferred: this.receivedBytes,
          totalBytes: this.metadata.fileSize,
          percentage: 100,
          speedBytesPerSec: 0,
          status: 'completed',
        });
      }

      if (this.onCompleteCallback) {
        this.onCompleteCallback(fileBlob, this.metadata);
      }
    } catch (err: any) {
      console.error('Error finalizing P2P file:', err);
      if (this.onProgressCallback) {
        this.onProgressCallback({
          transferId: this.metadata.transferId,
          bytesTransferred: this.receivedBytes,
          totalBytes: this.metadata.fileSize,
          percentage: 100,
          speedBytesPerSec: 0,
          status: 'failed',
          errorMessage: err?.message || 'File assembly failed',
        });
      }
    }
  }

  public close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}

// Utility to calculate SHA-256 for a file
export async function calculateFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
