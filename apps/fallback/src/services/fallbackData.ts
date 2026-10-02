import { supabase } from './supabaseClient';
import type { EventItem, CategoryItem, SubEventItem, ParticipantRecord, TeamMemberRecord } from '../types';

/**
 * Fetches all active flagship events.
 */
export async function fetchActiveEvents(): Promise<EventItem[]> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, name, banner_path, status, created_at')
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching events from Supabase:', error.message);
      return [];
    }

    return (data || []) as EventItem[];
  } catch (err) {
    console.error('Unexpected error fetching events:', err);
    return [];
  }
}

/**
 * Fetches active categories for a specific event.
 */
export async function fetchCategoriesForEvent(eventId: string): Promise<CategoryItem[]> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, event_id, name, status, created_at')
      .eq('event_id', eventId)
      .eq('status', 'ACTIVE')
      .order('name', { ascending: true });

    if (error) {
      console.warn('Error fetching categories:', error.message);
      return [];
    }

    return (data || []) as CategoryItem[];
  } catch (err) {
    console.error('Unexpected error fetching categories:', err);
    return [];
  }
}

/**
 * Fetches active sub-events for a specific category.
 */
export async function fetchSubEventsForCategory(categoryId: string): Promise<SubEventItem[]> {
  try {
    const { data, error } = await supabase
      .from('sub_events')
      .select(`
        id,
        category_id,
        name,
        description,
        rules,
        banner_path,
        start_time,
        end_time,
        venue,
        participation_type,
        max_team_size,
        fee_amount_solo,
        fee_amount_team,
        payment_instructions,
        status,
        created_at
      `)
      .eq('category_id', categoryId)
      .eq('status', 'ACTIVE')
      .order('name', { ascending: true });

    if (error) {
      console.warn('Error fetching sub-events:', error.message);
      return [];
    }

    return (data || []) as SubEventItem[];
  } catch (err) {
    console.error('Unexpected error fetching sub-events:', err);
    return [];
  }
}

/**
 * Fetches all sub-events under an event by joining categories.
 */
export async function fetchAllSubEventsForEvent(eventId: string): Promise<{ category: CategoryItem; subEvents: SubEventItem[] }[]> {
  const categories = await fetchCategoriesForEvent(eventId);
  const result: { category: CategoryItem; subEvents: SubEventItem[] }[] = [];

  for (const cat of categories) {
    const subEvents = await fetchSubEventsForCategory(cat.id);
    result.push({
      category: cat,
      subEvents,
    });
  }

  return result;
}

/**
 * Fetches participants/registrations for a specific sub-event.
 * Safely aggregates solo and team registration records.
 */
export async function fetchSubEventParticipants(subEventId: string): Promise<ParticipantRecord[]> {
  try {
    // 1. Direct registrations query
    const { data, error } = await supabase
      .from('registrations')
      .select(`
        id,
        sub_event_id,
        status,
        created_at,
        leader_id,
        teams (
          id,
          team_name,
          team_members (
            id,
            is_leader,
            snapshot_name,
            snapshot_roll_number,
            snapshot_college,
            snapshot_department,
            snapshot_year
          )
        )
      `)
      .eq('sub_event_id', subEventId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Notice querying registrations:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Map rows into normalized ParticipantRecord[]
    const participants: ParticipantRecord[] = [];

    for (const reg of data as any[]) {
      const team = Array.isArray(reg.teams) ? reg.teams[0] : reg.teams;
      const teamMembers: TeamMemberRecord[] = [];

      if (team && Array.isArray(team.team_members)) {
        for (const tm of team.team_members) {
          teamMembers.push({
            id: tm.id,
            team_id: team.id,
            is_leader: Boolean(tm.is_leader),
            student_name: tm.snapshot_name || 'Team Member',
            roll_number: tm.snapshot_roll_number || 'N/A',
            college: tm.snapshot_college || 'KITS Akshar Institute of Technology',
            department: tm.snapshot_department || 'N/A',
            year_of_study: tm.snapshot_year || 1,
          });
        }
      }

      // Determine leader or main registrant info
      const leaderMember = teamMembers.find((m) => m.is_leader) || teamMembers[0];
      const isTeam = Boolean(team?.team_name) || teamMembers.length > 1;

      participants.push({
        id: reg.id,
        sub_event_id: reg.sub_event_id,
        registration_type: isTeam ? 'TEAM' : 'SOLO',
        status: reg.status || 'CONFIRMED',
        created_at: reg.created_at || new Date().toISOString(),
        student_name: leaderMember?.student_name || 'Registered Participant',
        roll_number: leaderMember?.roll_number || 'N/A',
        college: leaderMember?.college || 'KITS Akshar Institute of Technology',
        department: leaderMember?.department || 'N/A',
        year_of_study: leaderMember?.year_of_study || 1,
        team_name: team?.team_name || (isTeam ? 'Team' : null),
        is_leader: true,
        team_members: teamMembers,
      });
    }

    return participants;
  } catch (err) {
    console.error('Unexpected error loading participant roster:', err);
    return [];
  }
}
