import type { Event, SubEvent, EventLifecycleStatus } from '../types/models';

/**
 * Authoritative Event & Sub-Event Lifecycle & Registration Gate Resolver (Shared/Client).
 * Strictly mirrors PostgreSQL dynamic resolver functions in migration 074.
 *
 * Backend lifecycle and registration decisions are derived exclusively from PostgreSQL server time (NOW()).
 * The frontend may maintain its own `now` ticker solely to refresh displayed status in real time.
 */

/**
 * Checks if the Main Event registration gate is open.
 * Registration is open continuously from UPCOMING through ONGOING.
 * Closes only when manual REGISTRATIONS CLOSED / COMPLETED is set, or at/after end_date.
 */
export function isMainEventRegistrationGateOpen(
  event: Partial<Event> | null | undefined,
  currentTimestamp?: number | Date
): boolean {
  if (!event) return false;
  if (event.status !== 'ACTIVE') return false;

  if (event.status_mode === 'MANUAL') {
    return ['UPCOMING', 'REGISTRATIONS OPEN', 'ONGOING'].includes(event.manual_status || '');
  }

  // AUTOMATIC Mode: Open from upcoming through ongoing until end_date
  const now = currentTimestamp instanceof Date 
    ? currentTimestamp.getTime() 
    : (currentTimestamp !== undefined ? currentTimestamp : Date.now());

  const endDate = event.end_date ? new Date(event.end_date).getTime() : null;
  if (endDate !== null && !isNaN(endDate) && now >= endDate) {
    return false;
  }

  return true;
}

/**
 * Authoritative Main Event Lifecycle Status Resolver.
 * Automatic mode follows the strict 4-stage progression:
 * UPCOMING -> REGISTRATIONS OPEN -> ONGOING -> COMPLETED
 */
export function resolveEffectiveEventStatus(
  event: Partial<Event> | null | undefined,
  currentTimestamp?: number | Date
): EventLifecycleStatus {
  if (!event) return 'UPCOMING';

  // Priority 1: Manual override
  if (event.status_mode === 'MANUAL' && event.manual_status) {
    return event.manual_status;
  }

  // Priority 2: Automatic Lifecycle (Strict 4-stage progression)
  const now = currentTimestamp instanceof Date 
    ? currentTimestamp.getTime() 
    : (currentTimestamp !== undefined ? currentTimestamp : Date.now());

  const startDate = event.start_date ? new Date(event.start_date).getTime() : null;
  const endDate = event.end_date ? new Date(event.end_date).getTime() : null;

  // A. COMPLETED: NOW >= end_date
  if (endDate !== null && !isNaN(endDate) && now >= endDate) {
    return 'COMPLETED';
  }

  // B. ONGOING: NOW >= start_date AND NOW < end_date
  // Important: Event has started, registrations are locked, status is ONGOING (never REGISTRATIONS CLOSED)
  if (startDate !== null && !isNaN(startDate) && now >= startDate) {
    return 'ONGOING';
  }

  // C. REGISTRATIONS OPEN: 10 days before start_date up until start_date
  if (startDate !== null && !isNaN(startDate)) {
    const tenDaysBefore = startDate - (10 * 24 * 60 * 60 * 1000);
    if (now >= tenDaysBefore && now < startDate) {
      return 'REGISTRATIONS OPEN';
    }
  }

  // D. UPCOMING: More than 10 days before start_date
  return 'UPCOMING';
}

/**
 * Registration Gate Precedence Pipeline for Sub-events.
 * Checks whether a student can register into this Sub-event.
 */
export function isSubEventRegistrationAvailable(
  subEvent: Partial<SubEvent> | null | undefined,
  parentEvent?: Partial<Event> | null | undefined,
  currentTimestamp?: number | Date
): boolean {
  if (!subEvent) return false;
  if (subEvent.status !== 'ACTIVE') return false;

  const now = currentTimestamp instanceof Date 
    ? currentTimestamp.getTime() 
    : (currentTimestamp !== undefined ? currentTimestamp : Date.now());

  const endTime = subEvent.end_time ? new Date(subEvent.end_time).getTime() : null;
  // 1. Physical schedule: If ended, registration is locked (start_time does NOT lock registration)
  if (endTime !== null && !isNaN(endTime) && now >= endTime) return false;

  // 2. Capacity check
  if (
    subEvent.max_capacity !== null &&
    subEvent.max_capacity !== undefined &&
    subEvent.max_capacity > 0 &&
    (subEvent.registered_count || 0) >= subEvent.max_capacity
  ) {
    return false;
  }

  // 3. Main Event Registration Gate check
  if (parentEvent) {
    if (!isMainEventRegistrationGateOpen(parentEvent, now)) {
      return false;
    }
  }

  // 4. Sub-event manual block
  if (subEvent.status_mode === 'MANUAL' && subEvent.manual_status) {
    if (['REGISTRATIONS CLOSED', 'COMPLETED'].includes(subEvent.manual_status)) {
      return false;
    }
  }

  return true;
}

/**
 * Authoritative Sub-Event Lifecycle Status Resolver (for display badges).
 * Physical schedule takes precedence over manual overrides once start_time is reached.
 */
export function resolveEffectiveSubEventStatus(
  subEvent: Partial<SubEvent> | null | undefined,
  parentEventOrTimestamp?: Partial<Event> | number | Date | null,
  currentTimestamp?: number | Date
): EventLifecycleStatus {
  if (!subEvent) return 'UPCOMING';

  let parentEvent: Partial<Event> | null = null;
  let timestamp: number | Date | undefined = currentTimestamp;

  if (parentEventOrTimestamp !== undefined && parentEventOrTimestamp !== null) {
    if (typeof parentEventOrTimestamp === 'number' || parentEventOrTimestamp instanceof Date) {
      timestamp = parentEventOrTimestamp;
    } else {
      parentEvent = parentEventOrTimestamp as Partial<Event>;
    }
  }

  const now = timestamp instanceof Date 
    ? timestamp.getTime() 
    : (timestamp !== undefined ? timestamp : Date.now());

  // Priority 0: Authoritative Main Event Status Precedence
  // The Admin-controlled Main Event is the single source of truth.
  // If Main Event status is COMPLETED, all sub-events inside are strictly COMPLETED.
  if (parentEvent) {
    const parentEffective = resolveEffectiveEventStatus(parentEvent, now);
    if (
      parentEffective === 'COMPLETED' ||
      parentEvent.manual_status === 'COMPLETED' ||
      (parentEvent.status as any) === 'COMPLETED'
    ) {
      return 'COMPLETED';
    }
  }

  const startTime = subEvent.start_time ? new Date(subEvent.start_time).getTime() : null;
  const endTime = subEvent.end_time ? new Date(subEvent.end_time).getTime() : null;

  // Priority 1: Physical Schedule Precedence
  // A. COMPLETED: NOW >= end_time
  if (endTime !== null && !isNaN(endTime) && now >= endTime) {
    return 'COMPLETED';
  }

  // B. ONGOING: NOW >= start_time AND NOW < end_time
  if (startTime !== null && !isNaN(startTime) && now >= startTime) {
    return 'ONGOING';
  }

  // Priority 2: Sub-event Manual Override (before start_time)
  if (subEvent.status_mode === 'MANUAL' && subEvent.manual_status) {
    return subEvent.manual_status;
  }

  // Priority 3: Sub-event capacity check
  if (
    subEvent.max_capacity !== null &&
    subEvent.max_capacity !== undefined &&
    subEvent.max_capacity > 0 &&
    (subEvent.registered_count || 0) >= subEvent.max_capacity
  ) {
    return 'REGISTRATIONS CLOSED';
  }

  // Priority 4: Parent Main Event Registration Gate & Lifecycle
  if (parentEvent) {
    if (parentEvent.status !== 'ACTIVE') {
      return 'REGISTRATIONS CLOSED';
    }

    if (isMainEventRegistrationGateOpen(parentEvent, now)) {
      return 'REGISTRATIONS OPEN';
    }

    const parentStatus = resolveEffectiveEventStatus(parentEvent, now);
    if (parentStatus === 'UPCOMING') return 'UPCOMING';
    if (parentStatus === 'COMPLETED') return 'COMPLETED';
    if (parentStatus === 'ONGOING') return 'ONGOING';
    return 'REGISTRATIONS CLOSED';
  }

  return 'UPCOMING';
}

export const EVENT_LIFECYCLE_CONFIGS: Record<EventLifecycleStatus, { badgeClass: string; label: string }> = {
  'UPCOMING': {
    badgeClass: 'bg-blue-50 text-kits-blue border-blue-200',
    label: 'UPCOMING',
  },
  'REGISTRATIONS OPEN': {
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    label: 'REGISTRATIONS OPEN',
  },
  'REGISTRATIONS CLOSED': {
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    label: 'REGISTRATIONS CLOSED',
  },
  'ONGOING': {
    badgeClass: 'bg-red-50 text-kits-red border-red-300',
    label: 'ONGOING',
  },
  'COMPLETED': {
    badgeClass: 'bg-gray-100 text-gray-600 border-gray-300',
    label: 'COMPLETED',
  },
};

export interface LifecycleBadgeTheme {
  bg: string;
  text: string;
  border: string;
  label: string;
  indicatorDot?: string;
}

export function getLifecycleBadgeTheme(status: EventLifecycleStatus): LifecycleBadgeTheme {
  switch (status) {
    case 'UPCOMING':
      return {
        bg: 'bg-blue-50',
        text: 'text-kits-blue',
        border: 'border-blue-200',
        label: 'UPCOMING',
      };
    case 'REGISTRATIONS OPEN':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-300',
        label: 'REGISTRATIONS OPEN',
      };
    case 'REGISTRATIONS CLOSED':
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-200',
        label: 'REGISTRATIONS CLOSED',
      };
    case 'ONGOING':
      return {
        bg: 'bg-red-50',
        text: 'text-kits-red',
        border: 'border-red-300',
        label: 'ONGOING',
        indicatorDot: 'bg-kits-red animate-pulse',
      };
    case 'COMPLETED':
      return {
        bg: 'bg-gray-100',
        text: 'text-gray-600',
        border: 'border-gray-300',
        label: 'COMPLETED',
      };
    default:
      return {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        border: 'border-gray-200',
        label: status,
      };
  }
}

/**
 * Generates button CTA state strictly separating lifecycle appearance from registration enablement.
 */
export function getRegistrationCtaConfig(
  status: EventLifecycleStatus,
  isRegAvailableOrRegistered?: boolean,
  isRegistered?: boolean
): { label: string; enabled: boolean; variant: 'primary' | 'muted' | 'success' | 'live' } {
  // If 3 arguments provided: (status, isRegAvailable, isRegistered)
  if (isRegistered !== undefined) {
    const isRegAvailable = Boolean(isRegAvailableOrRegistered);
    if (isRegistered) {
      return { label: 'You are registered', enabled: false, variant: 'success' };
    }
    if (status === 'COMPLETED') {
      return { label: 'Event Concluded', enabled: false, variant: 'muted' };
    }
    if (isRegAvailable) {
      return { label: 'Register Now', enabled: true, variant: 'primary' };
    }
    if (status === 'ONGOING') {
      return { label: 'Registrations Closed', enabled: false, variant: 'live' };
    }
    if (status === 'REGISTRATIONS CLOSED') {
      return { label: 'Registrations Closed', enabled: false, variant: 'muted' };
    }
    return { label: 'Registrations Closed', enabled: false, variant: 'muted' };
  }

  // If 2 arguments provided: (status, isRegistered)
  const registered = Boolean(isRegAvailableOrRegistered);
  if (registered) {
    return { label: 'You are registered', enabled: false, variant: 'success' };
  }

  switch (status) {
    case 'UPCOMING':
    case 'REGISTRATIONS OPEN':
    case 'ONGOING':
      return { label: 'Register Now', enabled: true, variant: 'primary' };
    case 'REGISTRATIONS CLOSED':
      return { label: 'Registrations Closed', enabled: false, variant: 'muted' };
    case 'COMPLETED':
      return { label: 'Event Concluded', enabled: false, variant: 'muted' };
    default:
      return { label: 'View Details', enabled: false, variant: 'muted' };
  }
}
