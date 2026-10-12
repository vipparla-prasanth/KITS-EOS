import { supabase } from '@kits-eos/shared/src/api/client';

export interface DashboardData {
  registrations: any[];
  attendanceCount: number;
  resultsCount: number;
  certificatesCount: number;
  openComplaintsCount: number;
  unreadNotificationsCount: number;
}

interface CachedDashboard {
  userId: string;
  data: DashboardData;
  timestamp: number;
}

let dashboardCache: CachedDashboard | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds fresh cache

export function getCachedDashboardData(userId: string): DashboardData | null {
  if (dashboardCache && dashboardCache.userId === userId) {
    if (Date.now() - dashboardCache.timestamp < CACHE_TTL_MS) {
      return dashboardCache.data;
    }
  }
  return null;
}

export function setCachedDashboardData(userId: string, data: DashboardData): void {
  dashboardCache = {
    userId,
    data,
    timestamp: Date.now(),
  };
}

export function clearCachedDashboardData(): void {
  dashboardCache = null;
}

export async function fetchStudentDashboardData(userId: string): Promise<DashboardData | null> {
  if (!userId) return null;

  try {
    const [regResult, compResult, notifResult] = await Promise.allSettled([
      supabase
        .from('registrations')
        .select(`
          id,
          status,
          created_at,
          sub_events (
            id,
            name,
            start_time,
            end_time,
            venue,
            results_locked,
            results_published,
            events (
              id,
              name
            ),
            categories (
              id,
              name,
              events (
                id,
                name
              )
            )
          ),
          teams (
            id,
            team_name,
            team_members (
              id,
              user_id,
              manual_token,
              qr_identity,
              is_leader
            )
          )
        `)
        .eq('leader_id', userId)
        .neq('status', 'CANCELLED')
        .order('created_at', { ascending: false }),
      supabase
        .from('complaints')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'OPEN'),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)
    ]);

    let regs: any[] = [];
    let attendCount = 0;
    let certsCount = 0;
    let resCount = 0;

    if (regResult.status === 'fulfilled' && !regResult.value.error) {
      regs = regResult.value.data || [];
      const myMemberIds: string[] = [];
      regs.forEach((r: any) => {
        const team = Array.isArray(r.teams) ? r.teams[0] : r.teams;
        const members = team?.team_members || [];
        const myMember = members.find((m: any) => m.user_id === userId) || members.find((m: any) => m.is_leader) || members[0];
        if (myMember?.id) {
          myMemberIds.push(myMember.id);
        }
      });

      if (myMemberIds.length > 0) {
        const [attendRes, certsRes] = await Promise.allSettled([
          supabase
            .from('attendance_records')
            .select('scanned_member_id')
            .in('scanned_member_id', myMemberIds),
          supabase
            .from('certificates')
            .select('id, type, status')
            .in('team_member_id', myMemberIds)
            .eq('status', 'UNLOCKED')
        ]);

        if (attendRes.status === 'fulfilled' && !attendRes.value.error) {
          attendCount = attendRes.value.data?.length || 0;
        }
        if (certsRes.status === 'fulfilled' && !certsRes.value.error) {
          certsCount = certsRes.value.data?.length || 0;
        }
      }

      const lockedSubEventIds = regs
        .map((r: any) => (Array.isArray(r.sub_events) ? r.sub_events[0] : r.sub_events))
        .filter((sub: any) => sub?.results_published || sub?.results_locked)
        .map((sub: any) => sub?.id);
      resCount = lockedSubEventIds.length;
    }

    let openComplaints = 0;
    if (compResult.status === 'fulfilled' && !compResult.value.error) {
      openComplaints = compResult.value.data?.length || 0;
    }

    let unreadNotifs = 0;
    if (notifResult.status === 'fulfilled' && !notifResult.value.error) {
      unreadNotifs = notifResult.value.count || 0;
    }

    const data: DashboardData = {
      registrations: regs,
      attendanceCount: attendCount,
      resultsCount: resCount,
      certificatesCount: certsCount,
      openComplaintsCount: openComplaints,
      unreadNotificationsCount: unreadNotifs,
    };

    setCachedDashboardData(userId, data);
    return data;
  } catch (err) {
    console.warn('fetchStudentDashboardData notice:', err);
    return null;
  }
}
