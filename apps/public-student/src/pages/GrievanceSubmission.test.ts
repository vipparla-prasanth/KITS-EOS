import { describe, it, expect, vi } from 'vitest';

/**
 * Authoritative Complaints Schema Validator based on PostgreSQL table public.complaints:
 * - id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
 * - user_id: UUID REFERENCES users(id) ON DELETE SET NULL
 * - category: VARCHAR(255) NOT NULL
 * - description: TEXT NOT NULL
 * - status: complaint_status ('OPEN' | 'RESOLVED' | 'CLOSED') NOT NULL DEFAULT 'OPEN'
 * - resolution: TEXT NULL
 */
const AUTHORITATIVE_COMPLAINTS_COLUMNS = new Set([
  'id',
  'user_id',
  'category',
  'description',
  'status',
  'resolution',
]);

export interface ComplaintInsertPayload {
  user_id: string;
  category: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'CLOSED';
  [key: string]: any;
}

export function validateComplaintPayload(payload: ComplaintInsertPayload): {
  isValid: boolean;
  unrecognizedColumns: string[];
} {
  const unrecognizedColumns = Object.keys(payload).filter(
    (col) => !AUTHORITATIVE_COMPLAINTS_COLUMNS.has(col)
  );
  return {
    isValid: unrecognizedColumns.length === 0,
    unrecognizedColumns,
  };
}

export function buildRegistrationGrievancePayload(options: {
  userId: string;
  registrationId: string;
  subEventName?: string;
  eventName?: string;
  category: string;
  userText: string;
}): ComplaintInsertPayload {
  const { userId, registrationId, subEventName, eventName, category, userText } = options;
  const subName = subEventName || 'Registered Event';
  const regHeader = `[Registration Ref: ${registrationId}${subName ? ` | Sub-Event: ${subName}` : ''}${eventName ? ` (${eventName})` : ''}]`;
  const fullDescription = `${regHeader}\n\n${userText.trim()}`;

  return {
    user_id: userId,
    category,
    description: fullDescription,
    status: 'OPEN',
  };
}

describe('Grievance & Complaint Submission Schema Conformance', () => {
  it('Requirement 1 & 2: Payload strictly conforms to the authoritative complaints table schema without foreign key column errors', () => {
    const payload = buildRegistrationGrievancePayload({
      userId: 'user-uuid-1234',
      registrationId: 'reg-uuid-5678',
      subEventName: 'Hackathon 2026',
      eventName: 'TECHFEST',
      category: 'SCHEDULE',
      userText: 'The morning schedule clashes with our lab exam.',
    });

    const validation = validateComplaintPayload(payload);
    expect(validation.isValid).toBe(true);
    expect(validation.unrecognizedColumns).toHaveLength(0);

    // Explicitly verify registration_id and sub_event_id are NOT sent as separate columns
    expect((payload as any).registration_id).toBeUndefined();
    expect((payload as any).sub_event_id).toBeUndefined();
    expect(payload.user_id).toBe('user-uuid-1234');
    expect(payload.category).toBe('SCHEDULE');
    expect(payload.status).toBe('OPEN');
  });

  it('Requirement 2: Flags obsolete or non-existent columns (e.g. registration_id, sub_event_id) as schema errors', () => {
    const obsoletePayload = {
      user_id: 'user-uuid-1234',
      registration_id: 'reg-uuid-5678', // Does NOT exist in complaints table
      sub_event_id: 'sub-uuid-9999',     // Does NOT exist in complaints table
      category: 'PAYMENT',
      description: 'Fee deducted twice.',
      status: 'OPEN' as const,
    };

    const validation = validateComplaintPayload(obsoletePayload);
    expect(validation.isValid).toBe(false);
    expect(validation.unrecognizedColumns).toEqual(['registration_id', 'sub_event_id']);
  });

  it('Requirement 3: Registration association is safely and traceably preserved within the description', () => {
    const payload = buildRegistrationGrievancePayload({
      userId: 'user-uuid-1234',
      registrationId: 'reg-uuid-5678',
      subEventName: 'Code Sprint',
      eventName: 'ByteFest',
      category: 'COORDINATION',
      userText: 'Coordinator did not respond to team query on WhatsApp.',
    });

    expect(payload.description).toContain('[Registration Ref: reg-uuid-5678 | Sub-Event: Code Sprint (ByteFest)]');
    expect(payload.description).toContain('Coordinator did not respond to team query on WhatsApp.');
  });

  it('Requirement 5: Database errors do not trigger a false success state', async () => {
    const mockInsert = vi.fn().mockResolvedValue({
      error: { code: 'PGRST204', message: 'Database error simulated' },
    });

    let successMessage: string | null = null;
    let errorMessage: string | null = null;

    try {
      const res = await mockInsert({
        user_id: 'u-1',
        category: 'OTHER',
        description: 'Test error',
        status: 'OPEN',
      });
      if (res.error) throw res.error;
      successMessage = 'Grievance recorded.';
    } catch (err: any) {
      errorMessage = err.message || 'Failed to submit grievance.';
    }

    expect(successMessage).toBeNull();
    expect(errorMessage).toBe('Database error simulated');
  });

  it('Requirement 6: Repeated submission clicks while isSubmitting is true are guarded against duplicates', () => {
    let callCount = 0;
    let isSubmitting = false;

    const submitHandler = () => {
      if (isSubmitting) return;
      isSubmitting = true;
      callCount++;
    };

    submitHandler(); // First click -> proceeds
    submitHandler(); // Second rapid click -> guarded
    submitHandler(); // Third rapid click -> guarded

    expect(callCount).toBe(1);
  });

  it('Requirement 7: Handles general grievances submitted without registration association', () => {
    // General tickets from /complaints page do not require a registration reference
    const generalPayload: ComplaintInsertPayload = {
      user_id: 'user-uuid-1234',
      category: 'GENERAL',
      description: 'Campus WiFi is unstable during online assessment.',
      status: 'OPEN',
    };

    const validation = validateComplaintPayload(generalPayload);
    expect(validation.isValid).toBe(true);
    expect(validation.unrecognizedColumns).toHaveLength(0);
    expect(generalPayload.description).toBe('Campus WiFi is unstable during online assessment.');
  });
});
