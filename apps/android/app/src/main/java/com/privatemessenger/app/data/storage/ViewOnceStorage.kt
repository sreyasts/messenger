package com.privatemessenger.app.data.storage

import android.content.Context
import android.content.SharedPreferences
import java.time.Instant

/**
 * Persistent synchronous storage for View-Once image/photo state using Android SharedPreferences.
 * Ensures that once a view-once photo has been opened, its message ID and viewed_at ISO-8601
 * timestamp are permanently recorded synchronously so it can never be opened, replayed,
 * or restored across chat reloads or app restarts.
 */
class ViewOnceStorage(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "viewed_once_media"
        private const val KEY_VIEWED_MESSAGE_IDS = "viewed_message_ids"
        private const val KEY_PREFIX_VIEWED_AT = "viewed_at_"
    }

    /**
     * Permanently marks a view-once photo as viewed synchronously and returns the ISO-8601 timestamp.
     */
    @Synchronized
    fun markAsViewed(messageId: String, timestampIso: String = Instant.now().toString()): String {
        val existingTimestamp = prefs.getString(KEY_PREFIX_VIEWED_AT + messageId, null)
        if (!existingTimestamp.isNullOrBlank() && isViewed(messageId)) {
            return existingTimestamp
        }
        val currentSet = getViewedIds().toMutableSet()
        currentSet.add(messageId)
        prefs.edit()
            .putStringSet(KEY_VIEWED_MESSAGE_IDS, currentSet)
            .putString(KEY_PREFIX_VIEWED_AT + messageId, timestampIso)
            .commit()
        return timestampIso
    }

    /**
     * Checks if a view-once photo has already been viewed.
     */
    fun isViewed(messageId: String): Boolean {
        val set = prefs.getStringSet(KEY_VIEWED_MESSAGE_IDS, emptySet()) ?: emptySet()
        return set.contains(messageId)
    }

    /**
     * Returns the recorded viewed_at ISO timestamp if opened, or null.
     */
    fun getViewedAt(messageId: String): String? {
        if (!isViewed(messageId)) return null
        return prefs.getString(KEY_PREFIX_VIEWED_AT + messageId, "Opened") ?: "Opened"
    }

    /**
     * Returns the full set of viewed message IDs.
     */
    fun getViewedIds(): Set<String> {
        val set = prefs.getStringSet(KEY_VIEWED_MESSAGE_IDS, emptySet()) ?: emptySet()
        return HashSet(set)
    }

    /**
     * Clears all viewed media records (useful for testing or full data reset).
     */
    @Synchronized
    fun clear() {
        prefs.edit().clear().commit()
    }
}
