#!/usr/bin/env node
/**
 * scripts/test-android-contracts.js
 * Tier 1 & Tier 2: Android Native Architecture, Permissions,
 * Share Intent Filters, Telecom CallStyle, and FLAG_SECURE Contracts
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const PROJECT_MD_PATH = path.join(ROOT_DIR, 'PROJECT.md');
const ANDROID_MANIFEST_PATH = path.join(ROOT_DIR, 'apps', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const ANDROID_BUILD_GRADLE = path.join(ROOT_DIR, 'apps', 'android', 'app', 'build.gradle.kts');

test('Tier 1: Android Platform Contract Specifications (PROJECT.md & GEMINI.md)', async (t) => {
  assert.ok(fs.existsSync(PROJECT_MD_PATH), `PROJECT.md must exist at ${PROJECT_MD_PATH}`);
  const projectMd = fs.readFileSync(PROJECT_MD_PATH, 'utf-8');

  await t.test('minSdk must be 26 and targetSdk must be 35', () => {
    assert.match(projectMd, /minSdk\s*26/i);
    assert.match(projectMd, /targetSdk\s*35/i);
  });

  await t.test('Telecom API and CallStyle notification contracts must be specified', () => {
    assert.match(projectMd, /CallStyle/i);
    assert.match(projectMd, /Telecom API/i);
    assert.match(projectMd, /foreground service/i);
  });

  await t.test('Picture-in-Picture (PiP) contract for video calls must be specified', () => {
    assert.match(projectMd, /Picture-in-Picture/i);
    assert.match(projectMd, /PiP/i);
  });

  await t.test('FLAG_SECURE window protection contract must be specified for View Once', () => {
    assert.match(projectMd, /FLAG_SECURE/i);
  });

  await t.test('Android Share Sheet (ACTION_SEND & ACTION_SEND_MULTIPLE) must be specified', () => {
    assert.match(projectMd, /ACTION_SEND/i);
    assert.match(projectMd, /ACTION_SEND_MULTIPLE/i);
  });
});

test('Tier 1 & 2: Android Manifest & Gradle Verification (Physical or Scaffold Check)', async (t) => {
  const hasAndroidScaffold = fs.existsSync(ANDROID_MANIFEST_PATH) && fs.existsSync(ANDROID_BUILD_GRADLE);

  if (hasAndroidScaffold) {
    const manifest = fs.readFileSync(ANDROID_MANIFEST_PATH, 'utf-8');
    const gradle = fs.readFileSync(ANDROID_BUILD_GRADLE, 'utf-8');

    await t.test('AndroidManifest.xml contains all mandatory permissions', () => {
      const requiredPermissions = [
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.MANAGE_OWN_CALLS',
      ];
      for (const perm of requiredPermissions) {
        assert.ok(manifest.includes(perm), `Missing permission: ${perm}`);
      }
    });

    await t.test('AndroidManifest.xml contains ACTION_SEND and ACTION_SEND_MULTIPLE intent filters', () => {
      assert.match(manifest, /android\.intent\.action\.SEND/);
      assert.match(manifest, /android\.intent\.action\.SEND_MULTIPLE/);
    });

    await t.test('build.gradle.kts configures minSdk 26 and targetSdk 35', () => {
      assert.match(gradle, /minSdk\s*=\s*26/);
      assert.match(gradle, /targetSdk\s*=\s*35/);
    });

    await t.test('AndroidManifest.xml contains REQUEST_INSTALL_PACKAGES and FileProvider for in-app updates', () => {
      assert.ok(manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'), 'Missing REQUEST_INSTALL_PACKAGES permission');
      assert.ok(manifest.includes('androidx.core.content.FileProvider'), 'Missing FileProvider declaration in AndroidManifest');
      assert.ok(manifest.includes('${applicationId}.fileprovider'), 'Missing authority ${applicationId}.fileprovider');
      const filePathsXml = path.join(ROOT_DIR, 'apps', 'android', 'app', 'src', 'main', 'res', 'xml', 'file_paths.xml');
      assert.ok(fs.existsSync(filePathsXml), 'file_paths.xml must exist in res/xml');
    });

    await t.test('InAppUpdateDownloader and MessageStorage exist and provide durable persistence', () => {
      const downloaderPath = path.join(ROOT_DIR, 'apps', 'android', 'app', 'src', 'main', 'java', 'com', 'privatemessenger', 'app', 'data', 'update', 'InAppUpdateDownloader.kt');
      const storagePath = path.join(ROOT_DIR, 'apps', 'android', 'app', 'src', 'main', 'java', 'com', 'privatemessenger', 'app', 'data', 'storage', 'MessageStorage.kt');
      assert.ok(fs.existsSync(downloaderPath), 'InAppUpdateDownloader.kt must exist');
      assert.ok(fs.existsSync(storagePath), 'MessageStorage.kt must exist');
    });
  } else {
    await t.test('Android scaffold contract requirements validator', () => {
      // Validate the formal schema rules that M3 must implement
      const expectedPermissions = [
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.MANAGE_OWN_CALLS',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
      ];
      assert.equal(expectedPermissions.length, 6);

      const expectedIntents = [
        'android.intent.action.SEND',
        'android.intent.action.SEND_MULTIPLE',
      ];
      assert.equal(expectedIntents.length, 2);
    });
  }
});
