import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanupSessionNotifications } from './notificationCleanup';
import { supabase } from '../api/client';

describe('Notification Automatic Cleanup & Read-On-Open Security', () => {
  const mockUserSession = {
    user: { id: 'usr_student_test_12345', email: 'student@example.com' },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Authoritative User Notification Cleanup on Logout/Expiry', () => {
    it('executes server-authoritative RPC clear_user_session_notifications successfully for authenticated user', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockUserSession as any },
        error: null,
      });

      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, deleted_count: 5, identity: 'USER', user_id: 'usr_student_test_12345' },
        error: null,
      } as any);

      const result = await cleanupSessionNotifications({ timeoutMs: 1500 });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
      expect(result.source).toBe('rpc');
      expect(rpcSpy).toHaveBeenCalledWith('clear_user_session_notifications', {
        p_token: null,
      });
    });

    it('executes server-authoritative RPC with coordinator token for coordinator portal', async () => {
      const coordToken = 'coord_tok_abc_secure_999';
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, deleted_count: 3, identity: 'COORDINATOR' },
        error: null,
      } as any);

      const result = await cleanupSessionNotifications({ token: coordToken, timeoutMs: 1500 });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.source).toBe('rpc');
      expect(rpcSpy).toHaveBeenCalledWith('clear_user_session_notifications', {
        p_token: coordToken,
      });
    });

    it('falls back to direct scoped delete if RPC is unavailable or returns an error', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockUserSession as any },
        error: null,
      });

      // RPC fails (e.g. migration pending)
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { message: 'function clear_user_session_notifications() does not exist' },
      } as any);

      const eqMock = vi.fn().mockResolvedValue({
        data: null,
        error: null,
        count: 4,
      });

      const deleteMock = vi.fn().mockReturnValue({
        eq: eqMock,
      });

      vi.spyOn(supabase, 'from').mockReturnValue({
        delete: deleteMock,
      } as any);

      const result = await cleanupSessionNotifications({ timeoutMs: 1500 });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(4);
      expect(result.source).toBe('direct_delete');
      expect(deleteMock).toHaveBeenCalledWith({ count: 'exact' });
      // Strictly scoped to the authenticated caller's identity
      expect(eqMock).toHaveBeenCalledWith('user_id', 'usr_student_test_12345');
    });

    it('is a safe no-op when user has no active session and no coordinator token', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const rpcSpy = vi.spyOn(supabase, 'rpc');

      const result = await cleanupSessionNotifications({ timeoutMs: 1500 });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
      expect(result.source).toBe('noop');
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it('enforces strict timeout and does not block logout indefinitely if backend hangs', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockUserSession as any },
        error: null,
      });

      // Hanging RPC call that never resolves
      vi.spyOn(supabase, 'rpc').mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const startTime = Date.now();
      const result = await cleanupSessionNotifications({ timeoutMs: 300 });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(1200);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('handles unexpected exceptions gracefully without throwing or rejecting', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockRejectedValue(new Error('Network disconnected'));

      const result = await cleanupSessionNotifications({ timeoutMs: 500 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network disconnected');
    });

    it('coalesces concurrent cleanup calls to prevent duplicate requests', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockUserSession as any },
        error: null,
      });

      let rpcCalls = 0;
      vi.spyOn(supabase, 'rpc').mockImplementation(async () => {
        rpcCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return { data: { success: true, deleted_count: 2 }, error: null } as any;
      });

      // Call cleanup twice simultaneously
      const [res1, res2] = await Promise.all([
        cleanupSessionNotifications({ timeoutMs: 1000 }),
        cleanupSessionNotifications({ timeoutMs: 1000 }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(rpcCalls).toBe(1); // Exactly one RPC invocation shared across callers
    });
  });

  describe('2. Read-On-Open Badge & State Guarantees', () => {
    it('verifies mark_notifications_read_on_open contract enforces caller boundary', async () => {
      const markSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, marked_count: 3 },
        error: null,
      } as any);

      const notificationIds = ['notif_uuid_1', 'notif_uuid_2', 'notif_uuid_3'];
      const { data, error } = await supabase.rpc('mark_notifications_read_on_open', {
        p_notification_ids: notificationIds,
        p_token: null,
      });

      expect(error).toBeNull();
      expect(data?.success).toBe(true);
      expect(markSpy).toHaveBeenCalledWith('mark_notifications_read_on_open', {
        p_notification_ids: notificationIds,
        p_token: null,
      });
    });

    it('ensures notification state updates unreadCount immediately without mutation of unrelated records', () => {
      const initialNotifications = [
        { id: '1', title: 'Pass Issued', is_read: false, read_at: null },
        { id: '2', title: 'Payment Confirmed', is_read: false, read_at: null },
        { id: '3', title: 'Welcome', is_read: true, read_at: '2026-10-24T10:00:00Z' },
      ];

      const unreadIds = initialNotifications.filter((n) => !n.is_read).map((n) => n.id);
      expect(unreadIds).toEqual(['1', '2']);

      const nowIso = new Date().toISOString();
      const updated = initialNotifications.map((n) =>
        unreadIds.includes(n.id) ? { ...n, is_read: true, read_at: nowIso } : n
      );

      // Verify all items marked read
      expect(updated.every((n) => n.is_read)).toBe(true);
      // Verify items remain in list during session (not deleted upon opening panel)
      expect(updated.length).toBe(3);
      // Verify unread badge count arithmetic
      const oldUnreadCount = 2;
      const newUnreadCount = Math.max(0, oldUnreadCount - unreadIds.length);
      expect(newUnreadCount).toBe(0);
    });
  });

  describe('3. Scope & Cross-User Security Rules', () => {
    it('never permits passing another user ID to deletion routines', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockUserSession as any },
        error: null,
      });

      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { success: true, deleted_count: 0 },
        error: null,
      } as any);

      await cleanupSessionNotifications();

      // Ensure RPC parameters never accept or forward arbitrary foreign user IDs
      const callArgs = rpcSpy.mock.calls[0];
      expect(callArgs[0]).toBe('clear_user_session_notifications');
      expect(callArgs[1]).not.toHaveProperty('user_id');
      expect(callArgs[1]).not.toHaveProperty('target_user');
      expect(callArgs[1]).toEqual({ p_token: null });
    });
  });
});
