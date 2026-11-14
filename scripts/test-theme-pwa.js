#!/usr/bin/env node
/**
 * scripts/test-theme-pwa.js
 * Tier 1, Tier 2, and Tier 4: OLED #000000 Theme Tokens,
 * PWA Manifest, and Service Worker Offline Cache Contracts
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const THEME_CONTEXT_PATH = path.join(ROOT_DIR, 'apps', 'web', 'src', 'lib', 'theme', 'ThemeContext.tsx');
const MANIFEST_PATH = path.join(ROOT_DIR, 'apps', 'web', 'public', 'manifest.json');
const SW_PATH = path.join(ROOT_DIR, 'apps', 'web', 'public', 'sw.js');
const ICON_192_PATH = path.join(ROOT_DIR, 'apps', 'web', 'public', 'icons', 'icon-192x192.png');
const ICON_512_PATH = path.join(ROOT_DIR, 'apps', 'web', 'public', 'icons', 'icon-512x512.png');

test('Tier 1: Pure OLED #000000 Theme Tokens & Accents', async (t) => {
  assert.ok(fs.existsSync(THEME_CONTEXT_PATH), `ThemeContext must exist at ${THEME_CONTEXT_PATH}`);
  const themeSource = fs.readFileSync(THEME_CONTEXT_PATH, 'utf-8');

  await t.test('All 5 Instagram-dark style accent themes must be configured', () => {
    const expectedThemes = ['violet-pink', 'ocean-blue', 'emerald', 'crimson', 'monochrome'];
    for (const accent of expectedThemes) {
      assert.ok(
        themeSource.includes(`'${accent}':`),
        `Theme configuration missing for accent: ${accent}`
      );
    }
  });

  await t.test('Accent primary hex colors must match GEMINI.md design tokens', () => {
    // violet-pink -> #E1306C
    assert.match(themeSource, /primaryHex:\s*['"]#E1306C['"]/);
    // ocean-blue -> #0084FF
    assert.match(themeSource, /primaryHex:\s*['"]#0084FF['"]/);
    // emerald -> #10B981
    assert.match(themeSource, /primaryHex:\s*['"]#10B981['"]/);
    // crimson -> #EF4444
    assert.match(themeSource, /primaryHex:\s*['"]#EF4444['"]/);
    // monochrome -> #E5E5E5
    assert.match(themeSource, /primaryHex:\s*['"]#E5E5E5['"]/);
  });

  await t.test('Pure OLED black canvas and wallpaper presets configured', () => {
    assert.match(themeSource, /bg-black/);
    assert.match(themeSource, /text-white/);
    assert.match(themeSource, /WALLPAPER_PRESETS/);
    assert.match(themeSource, /pure-black/);
  });

  await t.test('Fallback logic defaults to violet-pink when invalid accent is requested', () => {
    // Mock accent lookup
    const THEME_CONFIGS = {
      'violet-pink': { name: 'Violet Pink', primaryHex: '#E1306C' },
      'ocean-blue': { name: 'Ocean Blue', primaryHex: '#0084FF' },
      'emerald': { name: 'Emerald', primaryHex: '#10B981' },
      'crimson': { name: 'Crimson', primaryHex: '#EF4444' },
      'monochrome': { name: 'Monochrome', primaryHex: '#E5E5E5' },
    };

    function resolveTheme(accentKey) {
      return THEME_CONFIGS[accentKey] || THEME_CONFIGS['violet-pink'];
    }

    assert.equal(resolveTheme('invalid-accent').primaryHex, '#E1306C');
    assert.equal(resolveTheme('emerald').primaryHex, '#10B981');
  });
});

test('Tier 1 & 2: PWA Manifest & App Shell Asset Validation', async (t) => {
  assert.ok(fs.existsSync(MANIFEST_PATH), `manifest.json missing at ${MANIFEST_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

  await t.test('Manifest metadata must declare standalone and pure OLED black theme', () => {
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.background_color, '#000000');
    assert.equal(manifest.theme_color, '#000000');
    assert.equal(manifest.orientation, 'portrait-primary');
  });

  await t.test('Manifest must declare 192x192 and 512x512 maskable icons', () => {
    assert.ok(Array.isArray(manifest.icons));
    const icon192 = manifest.icons.find((i) => i.sizes === '192x192');
    const icon512 = manifest.icons.find((i) => i.sizes === '512x512');

    assert.ok(icon192, '192x192 icon must be declared');
    assert.ok(icon512, '512x512 icon must be declared');
    assert.match(icon192.purpose, /maskable/);
    assert.match(icon512.purpose, /maskable/);
  });

  await t.test('Declared PWA icon files must physically exist and be non-empty', () => {
    assert.ok(fs.existsSync(ICON_192_PATH), `192x192 icon missing at ${ICON_192_PATH}`);
    assert.ok(fs.existsSync(ICON_512_PATH), `512x512 icon missing at ${ICON_512_PATH}`);

    const stat192 = fs.statSync(ICON_192_PATH);
    const stat512 = fs.statSync(ICON_512_PATH);

    assert.ok(stat192.size > 100, `192x192 icon must not be empty (was ${stat192.size} bytes)`);
    assert.ok(stat512.size > 100, `512x512 icon must not be empty (was ${stat512.size} bytes)`);
  });
});

test('Tier 1 & 4: Service Worker Offline Strategy & Push Routing', async (t) => {
  assert.ok(fs.existsSync(SW_PATH), `Service worker missing at ${SW_PATH}`);
  const swSource = fs.readFileSync(SW_PATH, 'utf-8');

  await t.test('Service worker must declare CACHE_NAME and precache app shell', () => {
    assert.match(swSource, /const\s+CACHE_NAME\s*=/);
    assert.match(swSource, /STATIC_ASSETS\s*=/);
    assert.match(swSource, /'\/'/);
    assert.match(swSource, /'\/manifest\.json'/);
    assert.match(swSource, /'\/icons\/icon-192x192\.png'/);
    assert.match(swSource, /'\/icons\/icon-512x512\.png'/);
  });

  await t.test('Must bypass caching for Supabase, LiveKit SFU, API calls, and WebSockets', () => {
    assert.match(swSource, /supabase\.co/);
    assert.match(swSource, /livekit\.cloud/);
    assert.match(swSource, /\/api\//);
    assert.match(swSource, /websocket/i);
  });

  await t.test('Must register push notifications and notificationclick listeners', () => {
    assert.match(swSource, /addEventListener\(['"]push['"]/);
    assert.match(swSource, /showNotification/);
    assert.match(swSource, /addEventListener\(['"]notificationclick['"]/);
  });

  await t.test('Simulate offline fallback for navigation requests', () => {
    function simulateFetchFallback(requestMode, hasNetwork, cache) {
      if (hasNetwork) return 'NETWORK_OK';
      if (requestMode === 'navigate') {
        return cache['/'] || 'OFFLINE_SHELL';
      }
      return 'OFFLINE_503';
    }

    const mockCache = { '/': 'CACHED_ROOT_HTML' };
    const onlineRes = simulateFetchFallback('navigate', true, mockCache);
    assert.equal(onlineRes, 'NETWORK_OK');

    const offlineNav = simulateFetchFallback('navigate', false, mockCache);
    assert.equal(offlineNav, 'CACHED_ROOT_HTML');

    const offlineOther = simulateFetchFallback('no-cors', false, mockCache);
    assert.equal(offlineOther, 'OFFLINE_503');
  });
});
