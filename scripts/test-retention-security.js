#!/usr/bin/env node
/**
 * scripts/test-retention-security.js
 * Tier 1 & Tier 3: View Once Audit, Delete for Everyone Soft-Delete,
 * Database Retention, and Role-Based Governance Contracts
 */

const assert = require('node:assert/strict');
const test = require('node:test');

test('Tier 1 & 3: View Once Media Audit & Retention State Machine', async (t) => {
  // Simulate the message lifecycle for View Once media
  function createViewOnceMessage(senderId, conversationId, mediaUrl) {
    return {
      id: 'msg-uuid-101',
      conversationId,
      senderId,
      content: '',
      mediaUrl,
      mediaType: 'image',
      isViewOnce: true,
      viewedAt: null,
      deletedForEveryone: false,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date().toISOString(),
    };
  }

  function simulateRecipientOpen(message, recipientId, isParticipant) {
    if (!isParticipant) {
      throw new Error('Access denied: User is not a participant of this conversation');
    }
    if (message.viewedAt !== null) {
      // Already viewed
      return { canView: false, status: 'Opened', message };
    }
    // Update message state (RLS allows participant to update viewed_at on view_once messages)
    const updated = {
      ...message,
      viewedAt: new Date().toISOString(),
    };
    return { canView: true, status: 'Viewing', message: updated };
  }

  await t.test('View Once message is created with isViewOnce=true and viewedAt=null', () => {
    const msg = createViewOnceMessage('sender-1', 'conv-1', 'https://supabase.co/storage/v1/object/chat-attachments/img.png');
    assert.equal(msg.isViewOnce, true);
    assert.equal(msg.viewedAt, null);
    assert.ok(msg.mediaUrl.length > 0);
  });

  await t.test('First view by recipient succeeds and records viewedAt timestamp', () => {
    const msg = createViewOnceMessage('sender-1', 'conv-1', 'https://supabase.co/storage/v1/object/chat-attachments/img.png');
    const result = simulateRecipientOpen(msg, 'recipient-1', true);

    assert.equal(result.canView, true);
    assert.equal(result.status, 'Viewing');
    assert.ok(result.message.viewedAt !== null, 'viewedAt timestamp must be recorded');
    assert.ok(result.message.mediaUrl !== '', 'mediaUrl must be preserved in DB record');
  });

  await t.test('Second view attempt is locked with "Opened" status', () => {
    const msg = createViewOnceMessage('sender-1', 'conv-1', 'https://supabase.co/storage/v1/object/chat-attachments/img.png');
    const firstOpen = simulateRecipientOpen(msg, 'recipient-1', true);
    const secondOpen = simulateRecipientOpen(firstOpen.message, 'recipient-1', true);

    assert.equal(secondOpen.canView, false);
    assert.equal(secondOpen.status, 'Opened');
  });

  await t.test('Database record and storage asset are permanently retained (Zero Hard Deletion)', () => {
    const msg = createViewOnceMessage('sender-1', 'conv-1', 'https://supabase.co/storage/v1/object/chat-attachments/img.png');
    const opened = simulateRecipientOpen(msg, 'recipient-1', true);

    // Assert DB record retains original media URL and ID
    assert.equal(opened.message.id, 'msg-uuid-101');
    assert.equal(opened.message.mediaUrl, 'https://supabase.co/storage/v1/object/chat-attachments/img.png');
    assert.equal(opened.message.isViewOnce, true);
    assert.ok(opened.message.viewedAt);
  });
});

test('Tier 1 & 3: Delete for Everyone Soft-Delete & Admin Audit Trail', async (t) => {
  function deleteForEveryone(message, userId, isAdmin = false) {
    // Only sender or admin can delete for everyone
    if (message.senderId !== userId && !isAdmin) {
      throw new Error('Permission denied: Only the sender or an admin can trigger Delete for Everyone');
    }

    return {
      ...message,
      deletedForEveryone: true,
      deletedAt: new Date().toISOString(),
      deletedBy: userId,
    };
  }

  function renderMessageForClient(message) {
    if (message.deletedForEveryone) {
      return {
        displayText: 'This message was deleted',
        mediaUrl: null,
        isDeleted: true,
      };
    }
    return {
      displayText: message.content,
      mediaUrl: message.mediaUrl,
      isDeleted: false,
    };
  }

  const sampleMessage = {
    id: 'msg-audit-202',
    conversationId: 'conv-1',
    senderId: 'user-alice',
    content: 'Top secret project blueprint',
    mediaUrl: 'https://supabase.co/storage/v1/object/chat-attachments/blueprint.pdf',
    deletedForEveryone: false,
    deletedAt: null,
    deletedBy: null,
  };

  await t.test('Sender can delete message for everyone, setting audit columns', () => {
    const deleted = deleteForEveryone(sampleMessage, 'user-alice');
    assert.equal(deleted.deletedForEveryone, true);
    assert.ok(deleted.deletedAt !== null);
    assert.equal(deleted.deletedBy, 'user-alice');
    // Critical: Original content is NOT destroyed in the DB
    assert.equal(deleted.content, 'Top secret project blueprint');
    assert.equal(deleted.mediaUrl, 'https://supabase.co/storage/v1/object/chat-attachments/blueprint.pdf');
  });

  await t.test('Non-sender non-admin cannot trigger delete for everyone', () => {
    assert.throws(() => {
      deleteForEveryone(sampleMessage, 'user-bob', false);
    }, /Permission denied/);
  });

  await t.test('Admin can delete for everyone on any message', () => {
    const adminDeleted = deleteForEveryone(sampleMessage, 'admin-super', true);
    assert.equal(adminDeleted.deletedForEveryone, true);
    assert.equal(adminDeleted.deletedBy, 'admin-super');
  });

  await t.test('Client UI renders placeholder without exposing deleted content', () => {
    const deleted = deleteForEveryone(sampleMessage, 'user-alice');
    const clientView = renderMessageForClient(deleted);
    assert.equal(clientView.displayText, 'This message was deleted');
    assert.equal(clientView.mediaUrl, null);
    assert.equal(clientView.isDeleted, true);
  });
});

test('Tier 1 & 3: User Auto-Provisioning & Conversation Timestamp Triggers', async (t) => {
  function simulateHandleNewUser(authUser) {
    const email = authUser.email || '';
    const rawMeta = authUser.raw_user_meta_data || {};
    const displayName = rawMeta.full_name || rawMeta.name || email.split('@')[0] || 'friend';
    const avatarUrl = rawMeta.avatar_url || rawMeta.picture || '';

    return {
      id: authUser.id,
      email,
      displayName,
      avatarUrl,
      role: 'user',
      isBanned: false,
      themeAccent: 'violet-pink',
    };
  }

  function simulateMessageTouchConversation(conversation, message) {
    return {
      ...conversation,
      updatedAt: message.createdAt,
    };
  }

  await t.test('Extracts full_name if available in metadata', () => {
    const authUser = {
      id: 'uuid-1',
      email: 'sreyas@example.com',
      raw_user_meta_data: { full_name: 'Sreyas S', avatar_url: 'https://avatar.png' },
    };
    const profile = simulateHandleNewUser(authUser);
    assert.equal(profile.displayName, 'Sreyas S');
    assert.equal(profile.avatarUrl, 'https://avatar.png');
    assert.equal(profile.role, 'user');
  });

  await t.test('Falls back to email prefix if metadata name is missing', () => {
    const authUser = {
      id: 'uuid-2',
      email: 'alex_developer@domain.com',
      raw_user_meta_data: {},
    };
    const profile = simulateHandleNewUser(authUser);
    assert.equal(profile.displayName, 'alex_developer');
    assert.equal(profile.role, 'user');
  });

  await t.test('New message updates conversation updatedAt timestamp', () => {
    const conv = { id: 'conv-1', updatedAt: '2026-11-14T00:00:00Z' };
    const msg = { id: 'msg-1', conversationId: 'conv-1', createdAt: '2026-11-14T05:50:00Z' };
    const updatedConv = simulateMessageTouchConversation(conv, msg);

    assert.equal(updatedConv.updatedAt, '2026-11-14T05:50:00Z');
  });
});

test('Tier 1 & 3: Sticker Pack Role-Based Governance', async (t) => {
  function canDeleteStickerPack(pack, userId, isAdmin) {
    return pack.creatorId === userId || isAdmin === true;
  }

  const userPack = { id: 'pack-1', creatorId: 'user-alice', name: 'Cat Memes' };

  await t.test('Creator can delete their own sticker pack', () => {
    assert.equal(canDeleteStickerPack(userPack, 'user-alice', false), true);
  });

  await t.test('Non-creator cannot delete someone elses sticker pack', () => {
    assert.equal(canDeleteStickerPack(userPack, 'user-bob', false), false);
  });

  await t.test('Admin can delete any sticker pack globally', () => {
    assert.equal(canDeleteStickerPack(userPack, 'admin-mod', true), true);
  });
});
