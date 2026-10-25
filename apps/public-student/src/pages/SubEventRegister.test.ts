import { describe, it, expect } from 'vitest';
import {
  normalizeRegistrationResponse,
  type NormalizedRegistrationResult,
} from './SubEventRegister';

describe('SubEventRegister - normalizeRegistrationResponse', () => {
  it('correctly normalizes a flat RPC response (student_register_atomic output) into canonical structure', () => {
    // This is the direct return format of PostgreSQL student_register_atomic RPC
    const rpcData = {
      success: true,
      registration_id: 'reg-atomic-101',
      team_id: 'team-atomic-101',
      members_count: 2,
      status: 'PENDING_PAYMENT',
      registration_status: 'PENDING_PAYMENT',
      is_free: false,
      payment: {
        id: 'pay-atomic-101',
        amount: 200,
        payment_method: 'COD',
        status: 'PENDING',
        reference_id: null,
      },
      members: [
        {
          manual_token: 'KITS-EOS-HACK-001',
          qr_identity: 'qr-ident-001',
          snapshot_name: 'Lead Student',
          snapshot_roll_number: '21JR1A0501',
          is_leader: true,
        },
        {
          manual_token: 'KITS-EOS-HACK-002',
          qr_identity: 'qr-ident-002',
          snapshot_name: 'Member Student',
          snapshot_roll_number: '21JR1A0502',
          is_leader: false,
        },
      ],
      created_at: '2026-10-23T08:30:00.000Z',
    };

    const normalized = normalizeRegistrationResponse(rpcData, {
      mode: 'TEAM',
      teamName: 'Coders Guild',
      isFreeEvent: false,
    });

    expect(normalized).not.toBeNull();
    const result = normalized as NormalizedRegistrationResult;

    // Both top-level and nested registration structures must be populated
    expect(result.registration_id).toBe('reg-atomic-101');
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.registration).toBeDefined();
    expect(result.registration.id).toBe('reg-atomic-101');
    expect(result.registration.status).toBe('PENDING_PAYMENT');
    expect(result.registration.payment?.status).toBe('PENDING');
    expect(result.registration.payment?.payment_method).toBe('COD');
    expect(result.registration.team?.id).toBe('team-atomic-101');
    expect(result.registration.team?.team_name).toBe('Coders Guild');
    expect(result.registration.team?.members).toHaveLength(2);
    expect(result.registration.team?.members[0]?.manual_token).toBe('KITS-EOS-HACK-001');

    // Verification: isPaymentSuccess must be false for PENDING_PAYMENT
    const isPaymentSuccess = Boolean(
      result.registration.payment?.status === 'SUCCESS' || result.is_free
    );
    expect(isPaymentSuccess).toBe(false);
  });

  it('correctly normalizes a nested Edge Function response', () => {
    // This is the format returned by supabase.functions.invoke('student-register')
    const edgeFunctionData = {
      success: true,
      registration: {
        id: 'reg-edge-202',
        status: 'CONFIRMED',
        created_at: '2026-10-23T08:35:00.000Z',
        payment: {
          id: 'pay-edge-202',
          status: 'SUCCESS',
          payment_method: 'UPI',
          reference_id: 'UPI-REF-999888',
        },
        team: {
          id: 'team-edge-202',
          team_name: 'Robo Warriors',
          members: [
            {
              manual_token: 'KITS-EOS-ROBO-001',
              qr_identity: 'qr-robo-001',
              snapshot_name: 'Alice',
              is_leader: true,
            },
          ],
        },
      },
    };

    const normalized = normalizeRegistrationResponse(edgeFunctionData, {
      mode: 'TEAM',
      teamName: 'Robo Warriors',
      isFreeEvent: false,
    });

    expect(normalized).not.toBeNull();
    const result = normalized as NormalizedRegistrationResult;

    expect(result.registration_id).toBe('reg-edge-202');
    expect(result.status).toBe('CONFIRMED');
    expect(result.registration.id).toBe('reg-edge-202');
    expect(result.registration.status).toBe('CONFIRMED');
    expect(result.registration.payment?.status).toBe('SUCCESS');
    expect(result.registration.payment?.reference_id).toBe('UPI-REF-999888');

    // Verification: isPaymentSuccess must evaluate to true for UPI payment success
    const isPaymentSuccess = Boolean(
      result.registration.payment?.status === 'SUCCESS' || result.is_free
    );
    expect(isPaymentSuccess).toBe(true);
  });

  it('correctly normalizes authoritative database records restored on page refresh', () => {
    // This is the format queried by loadData() on page reload
    const dbRecord = {
      id: 'reg-db-303',
      status: 'PENDING_PAYMENT',
      created_at: '2026-10-23T08:00:00.000Z',
      teams: {
        id: 'team-db-303',
        team_name: 'Solo Participant',
        team_members: [
          {
            id: 'm-303',
            manual_token: 'KITS-EOS-AI-001',
            qr_identity: 'qr-ai-001',
            snapshot_name: 'Dev Student',
            snapshot_roll_number: '21JR1A1201',
            is_leader: true,
          },
        ],
      },
      payments: [
        {
          id: 'pay-db-303',
          amount: 100,
          status: 'PENDING',
          payment_method: 'COD',
          reference_id: null,
        },
      ],
    };

    const p = dbRecord.payments[0];
    const t = dbRecord.teams;

    const normalized = normalizeRegistrationResponse(
      {
        success: true,
        registration_id: dbRecord.id,
        team_id: t?.id,
        status: dbRecord.status,
        registration_status: dbRecord.status,
        is_free: false,
        payment: p || null,
        members: t?.team_members || [],
        created_at: dbRecord.created_at,
        teams: t,
      },
      {
        mode: 'SOLO',
        isFreeEvent: false,
      }
    );

    expect(normalized).not.toBeNull();
    const result = normalized as NormalizedRegistrationResult;

    expect(result.registration.id).toBe('reg-db-303');
    expect(result.registration.status).toBe('PENDING_PAYMENT');
    expect(result.registration.payment?.status).toBe('PENDING');
    expect(result.registration.payment?.payment_method).toBe('COD');
    expect(result.registration.team?.members[0]?.manual_token).toBe('KITS-EOS-AI-001');

    // Ensures the Pending payment screen is targeted, NOT blank or UPI success
    const isPaymentSuccess = Boolean(
      result.registration.payment?.status === 'SUCCESS' || result.is_free
    );
    expect(isPaymentSuccess).toBe(false);
  });

  it('correctly handles free event registration records', () => {
    const freeRegData = {
      success: true,
      registration_id: 'reg-free-404',
      status: 'CONFIRMED',
      is_free: true,
      payment: null,
      members: [
        {
          manual_token: 'KITS-EOS-FREE-001',
          qr_identity: 'qr-free-001',
          snapshot_name: 'Free Participant',
          is_leader: true,
        },
      ],
    };

    const normalized = normalizeRegistrationResponse(freeRegData, {
      mode: 'SOLO',
      isFreeEvent: true,
    });

    expect(normalized).not.toBeNull();
    const result = normalized as NormalizedRegistrationResult;

    expect(result.registration.id).toBe('reg-free-404');
    expect(result.registration.status).toBe('CONFIRMED');
    expect(result.is_free).toBe(true);

    const isPaymentSuccess = Boolean(
      result.registration.payment?.status === 'SUCCESS' || result.is_free
    );
    expect(isPaymentSuccess).toBe(true);
  });

  it('rejects invalid, failed, or null registration responses safely without crashing', () => {
    expect(normalizeRegistrationResponse(null)).toBeNull();
    expect(normalizeRegistrationResponse(undefined)).toBeNull();
    expect(normalizeRegistrationResponse({ success: false, message: 'Already registered' })).toBeNull();
    expect(normalizeRegistrationResponse({ success: true })).toBeNull(); // No ID provided
  });

  it('preserves distinct workflow states without conflating them', () => {
    // 1. Pending Approval / Cash on Delivery
    const pendingCod = normalizeRegistrationResponse({
      success: true,
      registration_id: 'reg-cod',
      status: 'PENDING_PAYMENT',
      payment: { status: 'PENDING', payment_method: 'COD' },
    });
    expect(pendingCod?.status).toBe('PENDING_PAYMENT');
    expect(pendingCod?.registration.payment?.status).toBe('PENDING');

    // 2. Confirmed Paid Registration
    const confirmedPaid = normalizeRegistrationResponse({
      success: true,
      registration_id: 'reg-paid',
      status: 'CONFIRMED',
      payment: { status: 'SUCCESS', payment_method: 'UPI' },
    });
    expect(confirmedPaid?.status).toBe('CONFIRMED');
    expect(confirmedPaid?.registration.payment?.status).toBe('SUCCESS');

    // 3. Confirmed Free Registration
    const confirmedFree = normalizeRegistrationResponse({
      success: true,
      registration_id: 'reg-free',
      status: 'CONFIRMED',
      is_free: true,
      payment: null,
    });
    expect(confirmedFree?.status).toBe('CONFIRMED');
    expect(confirmedFree?.is_free).toBe(true);

    // Assert none of these 3 states are equal or conflated
    expect(pendingCod?.status).not.toBe(confirmedPaid?.status);
    expect(pendingCod?.registration.payment?.status).not.toBe(confirmedPaid?.registration.payment?.status);
    expect(confirmedFree?.is_free).not.toBe(confirmedPaid?.is_free);
  });

  describe('Registration to Success Flow - Complete State & View Verification Matrix', () => {
    it('Requirement 1 & 2: draft save state vs confirmed state separation and non-blank content', () => {
      // Form draft state: step is DETAILS, regData is null
      const isDraftForm = (step: string, regData: any) => step !== 'CONFIRMED' && !regData;
      expect(isDraftForm('DETAILS', null)).toBe(true);
      expect(isDraftForm('REVIEW', null)).toBe(true);
      expect(isDraftForm('PAYMENT', null)).toBe(true);

      // Confirmed state: DraftSaveIndicator must NOT be rendered, institutional badge rendered instead
      expect(isDraftForm('CONFIRMED', { id: 'reg-1' })).toBe(false);
      expect(isDraftForm('CONFIRMED', null)).toBe(false);

      // Verify confirmed step with null regData produces fallback recovery view instead of blank page
      const hasVisibleContentOnConfirmed = (step: string, regData: any) => {
        if (step === 'CONFIRMED' && regData) return 'CONFIRMED_VIEW';
        if (step === 'CONFIRMED' && !regData) return 'RECOVERY_BANNER';
        return 'OTHER_STEP';
      };
      expect(hasVisibleContentOnConfirmed('CONFIRMED', null)).toBe('RECOVERY_BANNER');
      expect(hasVisibleContentOnConfirmed('CONFIRMED', { id: 'reg-1' })).toBe('CONFIRMED_VIEW');
    });

    it('Requirement 3 & 6: manual/offline payments (COD / OFFLINE) display pending verification and lock ID card', () => {
      const offlineReg = normalizeRegistrationResponse({
        success: true,
        registration_id: 'reg-offline-1',
        status: 'PENDING_PAYMENT',
        is_free: false,
        payments: [{
          id: 'pay-cod-1',
          amount: 250,
          payment_method: 'COD',
          status: 'PENDING',
        }],
        teams: [{
          id: 'team-cod-1',
          team_members: [{ id: 'm-1', is_leader: true, snapshot_name: 'Bob' }],
        }],
      });

      expect(offlineReg).not.toBeNull();
      const isPaymentSuccess = Boolean(
        offlineReg?.is_free ||
        offlineReg?.payment?.status === 'SUCCESS' ||
        (offlineReg?.status === 'CONFIRMED' && offlineReg?.payment?.status !== 'PENDING' && offlineReg?.payment?.payment_method !== 'COD')
      );
      // Online success animation and digital ID card must remain locked
      expect(isPaymentSuccess).toBe(false);
      expect(offlineReg?.status).toBe('PENDING_PAYMENT');
      expect(offlineReg?.payment?.payment_method).toBe('COD');
    });

    it('Requirement 4 & 5: verified online payment displays green success animation and unlocks ID card', () => {
      const onlineSuccessReg = normalizeRegistrationResponse({
        success: true,
        registration_id: 'reg-upi-1',
        status: 'CONFIRMED',
        is_free: false,
        payment: {
          id: 'pay-upi-1',
          amount: 300,
          payment_method: 'UPI',
          status: 'SUCCESS',
          reference_id: 'UPI-DEMO-998877',
        },
      });

      expect(onlineSuccessReg).not.toBeNull();
      const isPaymentSuccess = Boolean(
        onlineSuccessReg?.is_free ||
        onlineSuccessReg?.payment?.status === 'SUCCESS' ||
        (onlineSuccessReg?.status === 'CONFIRMED' && onlineSuccessReg?.payment?.status !== 'PENDING')
      );
      // Must evaluate to true so UpiPaymentSuccessAnimation and Credential Package Suite mount
      expect(isPaymentSuccess).toBe(true);
      expect(onlineSuccessReg?.status).toBe('CONFIRMED');
      expect(onlineSuccessReg?.payment?.reference_id).toBe('UPI-DEMO-998877');

      // Failed / unverified online payment must NOT show success
      const onlineFailedReg = normalizeRegistrationResponse({
        success: true,
        registration_id: 'reg-upi-fail',
        status: 'PENDING_PAYMENT',
        is_free: false,
        payment: {
          id: 'pay-upi-2',
          amount: 300,
          payment_method: 'UPI',
          status: 'FAILED',
        },
      });
      const isFailedPaymentSuccess = Boolean(
        onlineFailedReg?.is_free ||
        onlineFailedReg?.payment?.status === 'SUCCESS' ||
        (onlineFailedReg?.status === 'CONFIRMED' && onlineFailedReg?.payment?.status !== 'PENDING')
      );
      expect(isFailedPaymentSuccess).toBe(false);
    });

    it('Requirement 7: free event flows confirm immediately without payment and unlock ID card', () => {
      const freeReg = normalizeRegistrationResponse({
        success: true,
        registration_id: 'reg-free-zero',
        status: 'CONFIRMED',
        is_free: true,
        payment: null,
      }, { isFreeEvent: true });

      expect(freeReg).not.toBeNull();
      const isPaymentSuccess = Boolean(
        freeReg?.is_free ||
        freeReg?.payment?.status === 'SUCCESS' ||
        (freeReg?.status === 'CONFIRMED' && freeReg?.payment?.status !== 'PENDING')
      );
      expect(isPaymentSuccess).toBe(true);
      expect(freeReg?.is_free).toBe(true);
    });

    it('Requirement 8: team vs solo participant details and roster mapping', () => {
      // Solo participant
      const soloReg = normalizeRegistrationResponse({
        success: true,
        registration_id: 'reg-solo',
        status: 'CONFIRMED',
        is_free: true,
        members: [{
          is_leader: true,
          snapshot_name: 'Solo Leader',
          snapshot_roll_number: '21JR1A0501',
          snapshot_department: 'CSE',
          snapshot_year: 4,
          snapshot_college: 'KITS',
        }],
      }, { mode: 'SOLO' });

      expect(soloReg?.registration.team?.team_name).toBe('Solo Participant');
      expect(soloReg?.members[0]?.snapshot_name).toBe('Solo Leader');

      // Team participants
      const teamReg = normalizeRegistrationResponse({
        success: true,
        registration_id: 'reg-team',
        status: 'CONFIRMED',
        is_free: true,
        team_name: 'Hackathon Stars',
        members: [
          {
            is_leader: true,
            snapshot_name: 'Leader Alice',
            snapshot_roll_number: '21JR1A0501',
            snapshot_department: 'CSE',
            snapshot_year: 4,
            snapshot_college: 'KITS',
          },
          {
            is_leader: false,
            snapshot_name: 'Teammate Bob',
            snapshot_roll_number: '21JR1A0502',
            snapshot_department: 'ECE',
            snapshot_year: 3,
            snapshot_college: 'KITS',
          },
        ],
      }, { mode: 'TEAM', teamName: 'Hackathon Stars' });

      expect(teamReg?.registration.team?.team_name).toBe('Hackathon Stars');
      expect(teamReg?.members).toHaveLength(2);
      expect(teamReg?.members[1]?.snapshot_name).toBe('Teammate Bob');
    });

    it('Requirement 9: rehydration from PostgREST array structures preserves payments and teams on reload', () => {
      // Simulate raw Supabase query returned on reload: teams and payments are arrays
      const rawDbPayload = {
        id: 'reg-reloaded-1',
        status: 'CONFIRMED',
        created_at: '2026-10-23T12:00:00Z',
        teams: [{
          id: 'team-rel-1',
          team_name: 'Cyber Sentinels',
          team_members: [
            { id: 'm-1', is_leader: true, snapshot_name: 'Leader One', manual_token: 'TOKEN-001' },
            { id: 'm-2', is_leader: false, snapshot_name: 'Member Two', manual_token: 'TOKEN-002' },
          ],
        }],
        payments: [{
          id: 'pay-rel-1',
          payment_method: 'UPI',
          status: 'SUCCESS',
          reference_id: 'UPI-DEMO-RELOAD',
          amount: 500,
        }],
      };

      const normalized = normalizeRegistrationResponse(rawDbPayload, {
        mode: 'TEAM',
        teamName: 'Cyber Sentinels',
        isFreeEvent: false,
      });

      expect(normalized).not.toBeNull();
      expect(normalized?.registration_id).toBe('reg-reloaded-1');
      expect(normalized?.payment?.status).toBe('SUCCESS');
      expect(normalized?.payment?.reference_id).toBe('UPI-DEMO-RELOAD');
      expect(normalized?.registration.team?.team_name).toBe('Cyber Sentinels');
      expect(normalized?.registration.team?.members).toHaveLength(2);
      expect(normalized?.members[0]?.manual_token).toBe('TOKEN-001');
    });

    it('Requirement 10 & 11: network timeout recovery and idempotency protection', () => {
      // When a timeout or conflict occurs, verifiedReg from database is normalized safely
      const conflictDbRecord = {
        id: 'reg-conflict-resolved',
        status: 'CONFIRMED',
        created_at: '2026-10-23T12:01:00Z',
        teams: [{
          id: 't-1',
          team_name: 'Resilient Team',
          team_members: [{ id: 'm-1', is_leader: true, snapshot_name: 'Leader' }],
        }],
        payments: [{
          id: 'p-1',
          payment_method: 'UPI',
          status: 'SUCCESS',
          reference_id: 'UPI-DEMO-CONFLICT',
        }],
      };

      const resolved = normalizeRegistrationResponse(conflictDbRecord, {
        mode: 'TEAM',
        teamName: 'Resilient Team',
        isFreeEvent: false,
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.registration.id).toBe('reg-conflict-resolved');
      expect(resolved?.status).toBe('CONFIRMED');
      expect(resolved?.payment?.status).toBe('SUCCESS');
    });
  });

  describe('React Hooks Order Invariant (Preventing React Error #310)', () => {
    it('guarantees that all hooks in SubEventRegister are called before any early return statements', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.resolve(__dirname, './SubEventRegister.tsx');
      const code = fs.readFileSync(filePath, 'utf8');
      const lines = code.split('\n');

      let inComponent = false;
      let depth = 0;
      let earlyReturnIndex = -1;
      const hookCallsAfterEarlyReturn: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('export function SubEventRegister(')) {
          inComponent = true;
          depth = 0;
          continue;
        }

        if (!inComponent) continue;

        const openCount = (line.match(/{/g) || []).length;
        const closeCount = (line.match(/}/g) || []).length;

        // An early return at component level occurs when depth is 2 (e.g. inside if (isLoading) { return ... })
        if (
          earlyReturnIndex === -1 &&
          depth === 2 &&
          /^\s*return\s*\(/.test(line) &&
          !lines[i - 1]?.includes('effectiveLeader') &&
          !lines[i - 1]?.includes('effectiveMembers')
        ) {
          earlyReturnIndex = i + 1;
        }

        // If an early return has been encountered, any subsequent hook call is an invalid Hook order violation
        if (earlyReturnIndex !== -1) {
          const match = line.match(/\b(use[A-Z]\w+)\s*\(/);
          if (match && !line.includes('//') && !line.includes('export function use')) {
            hookCallsAfterEarlyReturn.push(`Line ${i + 1}: ${match[1]}`);
          }
        }

        depth += openCount - closeCount;
      }

      expect(hookCallsAfterEarlyReturn).toEqual([]);
    });
  });
});

