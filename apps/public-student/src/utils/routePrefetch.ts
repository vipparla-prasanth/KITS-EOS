/**
 * Conservative route-level prefetching utilities for KITS-EOS Student Portal.
 * Ensures chunk loads are non-blocking, fail-safe, and triggered only on explicit user intent or idle CPU.
 */

export function prefetchEventsList(): void {
  try {
    import('../pages/EventsList').catch(() => {});
  } catch {}
}

export function prefetchLogin(): void {
  try {
    import('../pages/Login').catch(() => {});
  } catch {}
}

export function prefetchAssessments(): void {
  try {
    import('../pages/Assessments/AssessmentsDirectory').catch(() => {});
  } catch {}
}

export function prefetchEventDetails(): void {
  try {
    import('../pages/EventDetails').catch(() => {});
  } catch {}
}

export function prefetchDashboard(): void {
  try {
    import('../pages/StudentDashboard').catch(() => {});
  } catch {}
}

export function prefetchMyRegistrations(): void {
  try {
    import('../pages/MyRegistrations').catch(() => {});
  } catch {}
}
