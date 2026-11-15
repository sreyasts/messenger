package com.privatemessenger.app.data.storage

import android.content.Context
import android.content.SharedPreferences

/**
 * Persistent storage for View-Once media state using Android SharedPreferences.
 * Ensures that once a view-once text message, image, or video has been viewed,
 * its message ID is permanently recorded so it can never be opened, replayed,
 * or restored across chat reloads or app restarts.
 */
class ViewOnceStorage(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "viewed_once_media"
        private const val KEY_VIEWED_MESSAGE_IDS = "viewed_message_ids"
    }

    /**
     * Permanently marks a view-once message as viewed.
     */
    @Synchronized
    fun markAsViewed(messageId: String) {
        val currentSet = getViewedIds().toMutableSet()
        currentSet.add(messageId)
        prefs.edit().putStringSet(KEY_VIEWED_MESSAGE_IDS, currentSet).commit()
    }

    /**
     * Checks if a view-once message has already been viewed.
     */
    fun isViewed(messageId: String): Boolean {
        val set = prefs.getStringSet(KEY_VIEWED_MESSAGE_IDS, emptySet()) ?: emptySet()
        return set.contains(messageId)
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
    fun clear() {
        prefs.edit().clear().apply()
    }
}
