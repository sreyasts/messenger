package com.privatemessenger.app.telecom

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import com.privatemessenger.app.data.model.AudioRoute

/**
 * Hardware-accelerated Android AudioManager controller for low-latency VoIP / Video calls.
 * Configures MODE_IN_COMMUNICATION, AudioFocus for speech, Speaker/Earpiece/Bluetooth/Wired
 * routing, and cleanly restores prior audio state when the call terminates.
 */
class CallAudioManager(context: Context) {

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var previousSpeakerphone: Boolean = false
    private var focusRequest: AudioFocusRequest? = null
    private var isInitialized = false

    val isHardwareAecSupported: Boolean = try {
        AcousticEchoCanceler.isAvailable()
    } catch (_: Exception) {
        false
    }

    val isHardwareNsSupported: Boolean = try {
        NoiseSuppressor.isAvailable()
    } catch (_: Exception) {
        false
    }

    val isHardwareAgcSupported: Boolean = try {
        AutomaticGainControl.isAvailable()
    } catch (_: Exception) {
        false
    }

    fun startCallAudio(preferSpeaker: Boolean): AudioRoute {
        if (!isInitialized) {
            previousMode = audioManager.mode
            @Suppress("DEPRECATION")
            previousSpeakerphone = audioManager.isSpeakerphoneOn
            isInitialized = true
        }

        requestVoiceFocus()
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        val available = getAvailableRoutes()
        val initialRoute = when {
            available.contains(AudioRoute.BLUETOOTH) -> AudioRoute.BLUETOOTH
            available.contains(AudioRoute.WIRED_HEADSET) -> AudioRoute.WIRED_HEADSET
            preferSpeaker -> AudioRoute.SPEAKER
            else -> AudioRoute.EARPIECE
        }
        setAudioRoute(initialRoute)
        return initialRoute
    }

    fun getAvailableRoutes(): List<AudioRoute> {
        val routes = mutableSetOf(AudioRoute.EARPIECE, AudioRoute.SPEAKER)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.availableCommunicationDevices.forEach { device ->
                    when (device.type) {
                        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                        AudioDeviceInfo.TYPE_BLE_HEADSET,
                        AudioDeviceInfo.TYPE_BLE_SPEAKER -> routes.add(AudioRoute.BLUETOOTH)
                        AudioDeviceInfo.TYPE_WIRED_HEADSET,
                        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                        AudioDeviceInfo.TYPE_USB_HEADSET -> routes.add(AudioRoute.WIRED_HEADSET)
                    }
                }
            } else {
                val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                devices.forEach { device ->
                    when (device.type) {
                        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> routes.add(AudioRoute.BLUETOOTH)
                        AudioDeviceInfo.TYPE_WIRED_HEADSET,
                        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> routes.add(AudioRoute.WIRED_HEADSET)
                    }
                }
            }
        } catch (_: Exception) {}
        return routes.toList()
    }

    fun setAudioRoute(route: AudioRoute) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val targetTypes = when (route) {
                    AudioRoute.SPEAKER -> listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
                    AudioRoute.EARPIECE -> listOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
                    AudioRoute.BLUETOOTH -> listOf(
                        AudioDeviceInfo.TYPE_BLE_HEADSET,
                        AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    )
                    AudioRoute.WIRED_HEADSET -> listOf(
                        AudioDeviceInfo.TYPE_WIRED_HEADSET,
                        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                        AudioDeviceInfo.TYPE_USB_HEADSET
                    )
                }
                val device = audioManager.availableCommunicationDevices.firstOrNull { it.type in targetTypes }
                if (device != null) {
                    audioManager.setCommunicationDevice(device)
                } else if (route == AudioRoute.EARPIECE) {
                    audioManager.clearCommunicationDevice()
                }
            } else {
                @Suppress("DEPRECATION")
                when (route) {
                    AudioRoute.SPEAKER -> {
                        audioManager.stopBluetoothSco()
                        audioManager.isBluetoothScoOn = false
                        audioManager.isSpeakerphoneOn = true
                    }
                    AudioRoute.EARPIECE, AudioRoute.WIRED_HEADSET -> {
                        audioManager.stopBluetoothSco()
                        audioManager.isBluetoothScoOn = false
                        audioManager.isSpeakerphoneOn = false
                    }
                    AudioRoute.BLUETOOTH -> {
                        audioManager.isSpeakerphoneOn = false
                        audioManager.startBluetoothSco()
                        audioManager.isBluetoothScoOn = true
                    }
                }
            }
        } catch (_: Exception) {}
    }

    fun release() {
        if (!isInitialized) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice()
            } else {
                @Suppress("DEPRECATION")
                audioManager.stopBluetoothSco()
                @Suppress("DEPRECATION")
                audioManager.isBluetoothScoOn = false
                @Suppress("DEPRECATION")
                audioManager.isSpeakerphoneOn = previousSpeakerphone
            }
            audioManager.mode = previousMode
            abandonVoiceFocus()
        } catch (_: Exception) {}
        isInitialized = false
    }

    private fun requestVoiceFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(attrs)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener { }
                    .build()
                focusRequest = req
                audioManager.requestAudioFocus(req)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                )
            }
        } catch (_: Exception) {}
    }

    private fun abandonVoiceFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                focusRequest = null
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }
        } catch (_: Exception) {}
    }
}
