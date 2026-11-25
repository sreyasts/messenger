package com.privatemessenger.app.data.media

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import java.io.File
import java.util.UUID

data class RecordedVoiceNote(
    val file: File,
    val uri: Uri,
    val fileName: String,
    val fileSize: Long,
    val durationSec: Int
)

/**
 * Real Android MediaRecorder voice note recorder storing AAC-LC `.m4a` files
 * in `filesDir/voice_notes/` with proper resource cleanup.
 */
class VoiceNoteRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startTimeMs: Long = 0L

    fun startRecording(): Boolean {
        stopAndReleaseOnly()
        return try {
            val dir = File(context.filesDir, "voice_notes").apply { mkdirs() }
            val file = File(dir, "vn_${UUID.randomUUID().toString().take(8)}.m4a")
            outputFile = file

            val mr = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            mr.setAudioSource(MediaRecorder.AudioSource.MIC)
            mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            mr.setAudioEncodingBitRate(96_000)
            mr.setAudioSamplingRate(44_100)
            mr.setOutputFile(file.absolutePath)
            mr.prepare()
            mr.start()

            recorder = mr
            startTimeMs = System.currentTimeMillis()
            true
        } catch (_: Exception) {
            outputFile?.delete()
            outputFile = null
            stopAndReleaseOnly()
            false
        }
    }

    fun stopRecording(): RecordedVoiceNote? {
        val file = outputFile ?: return null
        val durationSec = ((System.currentTimeMillis() - startTimeMs) / 1000L).toInt().coerceAtLeast(1)
        try {
            recorder?.stop()
        } catch (_: Exception) {
            file.delete()
            stopAndReleaseOnly()
            return null
        } finally {
            stopAndReleaseOnly()
        }
        if (!file.exists() || file.length() == 0L) {
            file.delete()
            return null
        }
        return RecordedVoiceNote(
            file = file,
            uri = Uri.fromFile(file),
            fileName = file.name,
            fileSize = file.length(),
            durationSec = durationSec
        )
    }

    fun cancelRecording() {
        stopAndReleaseOnly()
        outputFile?.delete()
        outputFile = null
    }

    fun release() {
        stopAndReleaseOnly()
    }

    private fun stopAndReleaseOnly() {
        try {
            recorder?.reset()
        } catch (_: Exception) {}
        try {
            recorder?.release()
        } catch (_: Exception) {}
        recorder = null
    }
}

/**
 * Real Android MediaPlayer wrapper for inline chat voice note playback.
 */
class VoiceNotePlayer {
    private var mediaPlayer: MediaPlayer? = null
    private var currentSource: String? = null

    fun play(
        context: Context,
        sourceUriOrUrl: String,
        onPreparedDurationMs: (Int) -> Unit,
        onCompletion: () -> Unit,
        onError: () -> Unit
    ) {
        stop()
        if (sourceUriOrUrl.isBlank()) {
            onError()
            return
        }
        try {
            val mp = MediaPlayer()
            currentSource = sourceUriOrUrl
            if (sourceUriOrUrl.startsWith("http://") || sourceUriOrUrl.startsWith("https://")) {
                mp.setDataSource(sourceUriOrUrl)
            } else if (sourceUriOrUrl.startsWith("/")) {
                mp.setDataSource(sourceUriOrUrl)
            } else {
                mp.setDataSource(context, Uri.parse(sourceUriOrUrl))
            }
            mp.setOnPreparedListener { player ->
                onPreparedDurationMs(player.duration.coerceAtLeast(0))
                player.start()
            }
            mp.setOnCompletionListener {
                onCompletion()
            }
            mp.setOnErrorListener { _, _, _ ->
                onError()
                true
            }
            mp.prepareAsync()
            mediaPlayer = mp
        } catch (_: Exception) {
            onError()
        }
    }

    fun currentPositionMs(): Int = try {
        mediaPlayer?.currentPosition ?: 0
    } catch (_: Exception) {
        0
    }

    fun durationMs(): Int = try {
        mediaPlayer?.duration ?: 0
    } catch (_: Exception) {
        0
    }

    fun isPlaying(): Boolean = try {
        mediaPlayer?.isPlaying == true
    } catch (_: Exception) {
        false
    }

    fun pause() {
        try {
            if (mediaPlayer?.isPlaying == true) {
                mediaPlayer?.pause()
            }
        } catch (_: Exception) {}
    }

    fun resume() {
        try {
            mediaPlayer?.start()
        } catch (_: Exception) {}
    }

    fun stop() {
        try {
            mediaPlayer?.stop()
        } catch (_: Exception) {}
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
        currentSource = null
    }
}
