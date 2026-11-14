# Project: Messenger Monorepo Release & Bug Fixes

## Architecture
A unified $0-cost private messenger monorepo serving two frontends through shared contracts:
1. **Native Android App (`apps/android`)**:
   - Primary target: Kotlin 2.0.20 + Jetpack Compose (Material 3), minSdk 26, targetSdk 35.
   - Google Sign-In access gate (`AuthScreen.kt`, `AuthSessionManager.kt`) blocking chats and message interactions until authenticated.
   - User profile view rendering name, bio/description, avatar image without block user buttons or unrequested administrative controls.
   - View-Once media persistence (`ViewOnceStorage.kt`) ensuring viewed text, photos, and videos permanently transition to "Opened" and never reappear on restart or chat reload.
   - In-app update notification system (`UpdatePolicy.kt`, `UpdateManager.kt`) checking remote release metadata and displaying update banner/button on production builds while strictly suppressing on debug/test builds (`BuildConfig.DEBUG`).
2. **Web PWA (`apps/web`)**:
   - Secondary target: Next.js 15, React 19, TypeScript 5.8, Tailwind CSS, installable PWA.
   - Google Sign-In access gate (`GoogleSignInGate.tsx`) blocking chat screens and composer until authenticated.
   - User profile view rendering name, bio/description, avatar image without block user buttons or admin shield badges.
   - View-Once media persistence across reloads/reopens via Supabase `viewed_at` update and `localStorage` fallback; text view-once support in composer and modal.
3. **Shared Backend & Presentation**:
   - Supabase PostgreSQL schema, RLS policies, LiveKit SFU token generation, WebRTC 1 GB P2P streaming.
   - GitHub presentation with badges, architecture overview, UI screenshots/mockups, setup guide, and automated release pipeline.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Web Google Sign-In Gate | OLED-styled GoogleSignInGate component with Google OAuth & demo session simulation | M1 | Survey (R1) |
| 2 | Web Auth Route Protection | Prevent unauthenticated visitors from accessing chats list, chat interface, or composer | M1 | Survey (R1) |
| 3 | Web Profile View Compliance | Render name, bio, avatar; remove admin shield badge and unrequested admin checks; add sign out | M1 | Survey (R2) |
| 4 | Web View-Once Text in Composer | Enable is_view_once flag for text messages in MessageComposer | M1 | Survey (R3) |
| 5 | Web View-Once Text in Modal | Render view-once text messages cleanly in ViewOnceModal | M1 | Survey (R3) |
| 6 | Web View-Once Persistence | Persist viewed_at to Supabase & localStorage; lock opened media permanently across reopens | M1 | Survey (R3) |
| 7 | Web Typecheck & Build Validation | Pass npm run --prefix apps/web typecheck and clean build without ENOSPC errors | M1 | Survey (Build) |
| 8 | Android Google Sign-In Gate | CurrentScreen.AUTH and AuthScreen in Jetpack Compose blocking unauthenticated access | M2 | Survey (R1) |
| 9 | Android Auth Session Storage | AuthSessionManager with SharedPreferences persisting authenticated Google user session | M2 | Survey (R1) |
| 10 | Android Profile View Compliance | Render name, bio, avatar with Coil/fallback; no block button; add sign out action | M2 | Survey (R2) |
| 11 | Android Contact Profile View | Render contact public profile card (name, bio, avatar) from chat header click | M2 | Survey (R2) |
| 12 | Android View-Once Persistence | ViewOnceStorage persisting viewed message IDs; lock opened media permanently across restarts | M2 | Survey (R3) |
| 13 | Android View-Once Text Dialog | Support view-once text in ViewOnceMediaDialog and MessageBubble | M2 | Survey (R3) |
| 14 | Android BuildConfig Generation | Enable buildFeatures { buildConfig = true } in app/build.gradle.kts | M2 | Survey (R4) |
| 15 | Android Update Policy & Manager | Pure UpdatePolicy logic & UpdateManager querying GitHub Releases / Supabase | M2 | Survey (R4) |
| 16 | Android In-App Update UI | Update card/button displayed in prod APK and strictly suppressed in debug/test builds | M2 | Survey (R4) |
| 17 | Android UpdatePolicy Unit Tests | Unit tests validating debug suppression and version comparison logic | M2 | Survey (R4) |
| 18 | Android Test & APK Build | Pass testDebugUnitTest and assembleDebug using C: drive Gradle caches | M2 | Survey (Build) |
| 19 | GitHub README & Documentation | Badges, architecture overview, feature list, setup/build guide, release assets info | M3 | Survey (R5) |
| 20 | Architecture Diagram | Mermaid diagram illustrating client-to-backend and P2P communication | M3 | Survey (R5) |
| 21 | UI Screenshot Mockups | Visual asset mockups for core screens, View-Once modal, and in-app update banner | M3 | Survey (R5) |
| 22 | GitHub Actions Release Workflow | .github/workflows/release.yml automating Android APK build on release tag | M3 | Survey (R5) |
| 23 | Git Tagging & Release Readiness | Git commit on master and v1.0.0 release tag | M3 | Survey (R5) |
| 24 | Full Monorepo E2E Validation | Pass npm test (75/75), web typecheck & build, android testDebugUnitTest & assembleDebug | M3 | Acceptance |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Web PWA Core Fixes & Build Validation | `apps/web/` (R1, R2, R3, Typecheck, Build) | None | DONE |
| 2 | Android Native App Core Fixes & Update System | `apps/android/` (R1, R2, R3, R4, Tests, APK) | None | DONE |
| 3 | GitHub Presentation, Assets & Release Deployment | Root, `README.md`, `docs/`, `.github/`, Git tags (R5, Full E2E) | M1, M2 | IN_PROGRESS |

---

## Interface Contracts

### Auth Access Gate Contract (Web & Android)
- **Session State**: `{ isAuthenticated: boolean, currentUser: User | null }`
- **Gate Rule**: If `!isAuthenticated`, route unconditionally to `GoogleSignInGate` (Web) or `AuthScreen` (Android).
- **Block Rule**: Block rendering of `ChatsListScreen` / `ChatsList` and `ChatDetailScreen` / `ChatInterface`. Disallow message dispatch.
- **Sign Out**: `signOut()` clears session from persistent storage (`localStorage` on Web, `SharedPreferences` on Android) and resets state to unauthenticated.

### Profile View Contract (Web & Android)
- **Render Fields**: `displayName: string`, `bio: string`, `avatarUrl: string`, `themeAccent: string`.
- **Prohibitions**: MUST NOT render "Block User", report user, or unrequested administrative controls/badges (remove admin shield badge).
- **Actions Allowed**: Edit display name/bio, change avatar, select theme accent, Sign Out.

### View-Once Media State Persistence Contract (Web & Android)
- **Message Fields**: `is_view_once: boolean`, `viewed_at: string | null`, `media_type: 'text' | 'image' | 'video' | ...`.
- **View Action**:
  1. Set component state to "Opened".
  2. Persist message ID to local storage (`localStorage['viewed_view_once_ids']` on Web, `ViewOnceStorage` on Android).
  3. Send Supabase update: `supabase.from('messages').update({ viewed_at: new Date().toISOString() }).eq('id', messageId)`.
- **Load/Render Rule**: If `is_view_once === true` AND (`viewed_at !== null` OR `isLocallyMarkedViewed(id)`):
  - Render strictly the non-clickable "Opened" badge/pill.
  - Media content (text, image, video) is permanently hidden and cannot be opened or replayed.

### Android In-App Update Policy Contract
- **Function**: `UpdatePolicy.shouldShowUpdate(currentVersionCode: Int, currentVersionName: String, isDebugBuild: Boolean, remoteRelease: ReleaseInfo?): Boolean`
- **Rules**:
  - If `isDebugBuild == true`: return `false` (STRICT SUPPRESSION on debug/test builds).
  - If `remoteRelease == null`: return `false`.
  - If `remoteRelease.versionCode > currentVersionCode`: return `true`.
  - Otherwise: return `false`.

### Android Platform Specialization Contracts
- **Telecom API & CallStyle**: Native incoming call notification on lock screen using Telecom API and CallStyle notifications with active call foreground service (`FOREGROUND_SERVICE_PHONE_CALL`).
- **Picture-in-Picture (PiP)**: Seamless transition to Picture-in-Picture (PiP) mode during active video calls.
- **FLAG_SECURE Protection**: Window security protection using `FLAG_SECURE` to block screenshots and screen recordings while viewing View Once media.
- **Share Sheet Integration**: Android share sheet integration handling `ACTION_SEND` and `ACTION_SEND_MULTIPLE` intents for single or multiple media attachments.

---

## Code Layout
- `apps/web/src/components/GoogleSignInGate.tsx`: Google Sign-In gate component.
- `apps/web/src/app/page.tsx`: Web root auth gate integration & Realtime listener.
- `apps/web/src/components/ProfilePage.tsx`: Profile page compliance (remove admin badge, add sign out).
- `apps/web/src/components/MessageComposer.tsx`: Fix view-once text flag.
- `apps/web/src/components/ViewOnceModal.tsx`: Render view-once text.
- `apps/web/src/components/ChatInterface.tsx`: View-once persistence to Supabase and localStorage.
- `apps/android/app/src/main/java/com/privatemessenger/app/ui/screens/AuthScreen.kt`: Android Google Sign-In gate.
- `apps/android/app/src/main/java/com/privatemessenger/app/data/auth/AuthSessionManager.kt`: Android auth session storage.
- `apps/android/app/src/main/java/com/privatemessenger/app/ui/screens/ProfileScreen.kt`: Android profile compliance & sign out.
- `apps/android/app/src/main/java/com/privatemessenger/app/data/storage/ViewOnceStorage.kt`: Android view-once persistence.
- `apps/android/app/src/main/java/com/privatemessenger/app/ui/components/ViewOnceMediaDialog.kt`: Android view-once text support.
- `apps/android/app/src/main/java/com/privatemessenger/app/data/update/UpdatePolicy.kt`: Android update policy logic.
- `apps/android/app/src/main/java/com/privatemessenger/app/data/update/UpdateManager.kt`: Android update check manager.
- `apps/android/app/src/test/java/com/privatemessenger/app/UpdatePolicyTest.kt`: Android update unit tests.
- `README.md`: Monorepo documentation & GitHub presentation.
- `docs/screenshots/`: Visual UI mockups and assets.
- `.github/workflows/release.yml`: Automated GitHub release pipeline.
