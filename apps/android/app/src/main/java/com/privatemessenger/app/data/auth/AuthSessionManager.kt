package com.privatemessenger.app.data.auth

import android.content.Context
import android.content.SharedPreferences
import com.privatemessenger.app.data.model.ThemeAccent
import com.privatemessenger.app.data.model.User

/**
 * Manages persistent user authentication session using Android SharedPreferences.
 * Persists authenticated user identity and credentials across app restarts and process recreation.
 */
class AuthSessionManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "messenger_auth_session"
        private const val KEY_IS_AUTHENTICATED = "is_authenticated"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_EMAIL = "email"
        private const val KEY_DISPLAY_NAME = "display_name"
        private const val KEY_BIO = "bio"
        private const val KEY_AVATAR_URL = "avatar_url"
        private const val KEY_THEME_ACCENT = "theme_accent"
        private const val KEY_CHAT_BACKGROUND_URL = "chat_background_url"
        private const val KEY_ROLE = "role"
    }

    /**
     * Checks if a valid authenticated user session currently exists.
     */
    fun isAuthenticated(): Boolean {
        return prefs.getBoolean(KEY_IS_AUTHENTICATED, false) && !prefs.getString(KEY_USER_ID, null).isNullOrBlank()
    }

    /**
     * Retrieves the current authenticated user session, or null if unauthenticated.
     */
    fun getSession(): User? {
        if (!isAuthenticated()) return null

        val id = prefs.getString(KEY_USER_ID, null) ?: return null
        val email = prefs.getString(KEY_EMAIL, "") ?: ""
        val displayName = prefs.getString(KEY_DISPLAY_NAME, "User") ?: "User"
        val bio = prefs.getString(KEY_BIO, "") ?: ""
        val avatarUrl = prefs.getString(KEY_AVATAR_URL, "") ?: ""
        val accentKey = prefs.getString(KEY_THEME_ACCENT, "violet-pink") ?: "violet-pink"
        val chatBackgroundUrl = prefs.getString(KEY_CHAT_BACKGROUND_URL, "") ?: ""
        val role = prefs.getString(KEY_ROLE, "user") ?: "user"

        return User(
            id = id,
            email = email,
            displayName = displayName,
            bio = bio,
            avatarUrl = avatarUrl,
            themeAccent = ThemeAccent.fromKey(accentKey),
            chatBackgroundUrl = chatBackgroundUrl,
            role = role
        )
    }

    /**
     * Persists an authenticated user session to SharedPreferences.
     */
    fun saveSession(user: User) {
        prefs.edit()
            .putBoolean(KEY_IS_AUTHENTICATED, true)
            .putString(KEY_USER_ID, user.id)
            .putString(KEY_EMAIL, user.email)
            .putString(KEY_DISPLAY_NAME, user.displayName)
            .putString(KEY_BIO, user.bio)
            .putString(KEY_AVATAR_URL, user.avatarUrl)
            .putString(KEY_THEME_ACCENT, user.themeAccent.key)
            .putString(KEY_CHAT_BACKGROUND_URL, user.chatBackgroundUrl)
            .putString(KEY_ROLE, user.role)
            .commit()
    }

    /**
     * Clears the current user session, effectively signing the user out.
     */
    fun clearSession() {
        prefs.edit().clear().apply()
    }
}
