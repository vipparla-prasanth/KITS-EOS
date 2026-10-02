import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@kits-eos/shared';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { 
  Store, 
  Plus, 
  Search, 
  Eye, 
  Edit2, 
  CheckCircle2, 
  XCircle, 
  Trash2, 
  Users, 
  Phone, 
  MapPin, 
  AlertTriangle, 
  X, 
  Clock,
  ChevronDown,
  Archive,
  RotateCcw
} from 'lucide-react';

interface EventOption {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
}

interface StallOwner {
  id: string;
  stall_id?: string;
  owner_name: string;
  display_order: number;
}

interface StallContact {
  id: string;
  stall_id?: string;
  contact_value: string;
  display_order: number;
}

interface StallRecord {
  id: string;
  event_id: string;
  name: string;
  venue: string;
  description: string;
  banner_path: string | null;
  status: 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED' | 'ARCHIVED';
  created_by_type: 'ADMIN' | 'STUDENT';
  created_by_student_id: string | null;
  created_by_admin_id: string | null;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  stall_owners: StallOwner[];
  stall_contacts: StallContact[];
  events?: {
    id: string;
    name: string;
  } | {
    id: string;
    name: string;
  }[] | null;
  student_profile?: {
    full_name: string;
    roll_number: string;
  } | null;
}

type TabFilter = 'ALL' | 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED' | 'ARCHIVED';

export function ManageStalls() {
  // Event Selection State
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [isLoadingEvents, setIsLoadingEvents] = useState<boolean>(true);

  // Stalls Data State
  const [stalls, setStalls] = useState<StallRecord[]>([]);
  const [isLoadingStalls, setIsLoadingStalls] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [tabFilter, setTabFilter] = useState<TabFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState<boolean>(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState<boolean>(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState<boolean>(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState<boolean>(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState<boolean>(false);
  const [isPermanentDeleteModalOpen, setIsPermanentDeleteModalOpen] = useState<boolean>(false);

  // Active Stall for Modal Operations
  const [activeStall, setActiveStall] = useState<StallRecord | null>(null);

  // Form State (Create & Edit)
  const [formName, setFormName] = useState<string>('');
  const [formVenue, setFormVenue] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formBannerPath, setFormBannerPath] = useState<string | null>(null);
  const [formOwners, setFormOwners] = useState<string[]>(['']);
  const [formContacts, setFormContacts] = useState<string[]>(['']);
  const [formDisplayOrder, setFormDisplayOrder] = useState<number>(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Rejection Modal State
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [rejectionError, setRejectionError] = useState<string | null>(null);

  // 1. Fetch available non-deleted events
  const loadEvents = useCallback(async () => {
    try {
      setIsLoadingEvents(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('events')
        .select('id, name, status, start_date, end_date')
        .neq('status', 'PERMANENTLY_DELETED')
        .order('created_at', { ascending: false });

      if (err) throw err;
      const list = (data as EventOption[]) || [];
      setEvents(list);

      // Auto-select first event if none selected
      setSelectedEventId(prev => (prev || (list.length > 0 ? list[0].id : '')));
    } catch (err: any) {
      console.error('Failed to load events:', err);
      setError(err.message || 'Failed to load events.');
    } finally {
      setIsLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // 2. Fetch stalls for selected event
  const loadStalls = useCallback(async () => {
    if (!selectedEventId) {
      setStalls([]);
      return;
    }

    try {
      setIsLoadingStalls(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('stalls')
        .select(`
          id,
          event_id,
          name,
          venue,
          description,
          banner_path,
          status,
          created_by_type,
          created_by_student_id,
          created_by_admin_id,
          rejection_reason,
          approved_by,
          approved_at,
          display_order,
          created_at,
          updated_at,
          archived_at,
          stall_owners (
            id,
            stall_id,
            owner_name,
            display_order
          ),
          stall_contacts (
            id,
            stall_id,
            contact_value,
            display_order
          ),
          events (
            id,
            name
          )
        `)
        .eq('event_id', selectedEventId)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (err) throw err;

      // Hydrate student profiles if created by student (safe batch fetch with existing columns)
      const rawList = (data as unknown as StallRecord[]) || [];
      const studentIds = Array.from(
        new Set(rawList.filter(s => s.created_by_student_id).map(s => s.created_by_student_id as string))
      );

      let profileMap: Record<string, { full_name: string; roll_number: string }> = {};

      if (studentIds.length > 0) {
        try {
          const { data: profiles, error: profErr } = await supabase
            .from('student_profiles')
            .select('user_id, full_name, roll_number')
            .in('user_id', studentIds);

          if (!profErr && profiles) {
            profiles.forEach(p => {
              profileMap[p.user_id] = {
                full_name: p.full_name,
                roll_number: p.roll_number,
              };
            });
          }
        } catch {
          // Non-critical hydration failure should never abort stall display
        }
      }

      const enriched = rawList.map(s => ({
        ...s,
        student_profile: s.created_by_student_id ? profileMap[s.created_by_student_id] : null,
      }));

      setStalls(enriched);
    } catch (err: any) {
      console.error('Failed to load stalls:', err);
      setError(err.message || 'Failed to load stalls.');
      setStalls([]);
    } finally {
      setIsLoadingStalls(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadStalls();
  }, [loadStalls]);

  const loadStallsRef = useRef(loadStalls);
  loadStallsRef.current = loadStalls;

  // 3. Realtime live synchronization for stalls, owners, and contacts
  useEffect(() => {
    if (!selectedEventId) return;

    let channel: any = null;
    try {
      const topic = `admin-stalls-${selectedEventId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'stalls',
            filter: `event_id=eq.${selectedEventId}`
          },
          () => {
            loadStallsRef.current();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'stall_owners'
          },
          () => {
            loadStallsRef.current();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'stall_contacts'
          },
          () => {
            loadStallsRef.current();
          }
        );

      channel.subscribe((status: string, err?: Error) => {
        if (err) {
          console.warn('[ManageStalls] Realtime subscription status:', status, err);
        }
      });
    } catch (err) {
      console.warn('[ManageStalls] Realtime subscription error:', err);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, [selectedEventId]);

  const selectedEvent = useMemo(() => {
    return events.find(e => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  // KPI Calculations (Authoritatively derived strictly from returned live dataset)
  const stats = useMemo(() => {
    const active = stalls.filter(s => s.status !== 'ARCHIVED');
    const total = active.length;
    const approved = stalls.filter(s => s.status === 'APPROVED').length;
    const pending = stalls.filter(s => s.status === 'PENDING_APPROVAL').length;
    const rejected = stalls.filter(s => s.status === 'REJECTED').length;
    const archived = stalls.filter(s => s.status === 'ARCHIVED').length;
    return { total, approved, pending, rejected, archived };
  }, [stalls]);

  // Filtered and Searched Stalls
  const filteredStalls = useMemo(() => {
    return stalls.filter(stall => {
      // Tab filter
      if (tabFilter === 'ALL') {
        if (stall.status === 'ARCHIVED') return false;
      } else if (stall.status !== tabFilter) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const nameMatch = stall.name?.toLowerCase().includes(query);
        const venueMatch = stall.venue?.toLowerCase().includes(query);
        const descMatch = stall.description?.toLowerCase().includes(query);
        const ownerMatch = stall.stall_owners?.some(o => o.owner_name?.toLowerCase().includes(query));
        const contactMatch = stall.stall_contacts?.some(c => c.contact_value?.toLowerCase().includes(query));
        return nameMatch || venueMatch || descMatch || ownerMatch || contactMatch;
      }

      return true;
    });
  }, [stalls, tabFilter, searchQuery]);

  // Form Handlers
  const handleOpenCreateModal = () => {
    setFormName('');
    setFormVenue('');
    setFormDescription('');
    setFormBannerPath(null);
    setFormOwners(['']);
    setFormContacts(['']);
    setFormDisplayOrder(0);
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEditModal = (stall: StallRecord) => {
    setActiveStall(stall);
    setFormName(stall.name);
    setFormVenue(stall.venue);
    setFormDescription(stall.description);
    setFormBannerPath(stall.banner_path);
    setFormOwners(
      stall.stall_owners && stall.stall_owners.length > 0
        ? stall.stall_owners.map(o => o.owner_name)
        : ['']
    );
    setFormContacts(
      stall.stall_contacts && stall.stall_contacts.length > 0
        ? stall.stall_contacts.map(c => c.contact_value)
        : ['']
    );
    setFormDisplayOrder(stall.display_order || 0);
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const handleOwnerChange = (index: number, value: string) => {
    const updated = [...formOwners];
    updated[index] = value;
    setFormOwners(updated);
  };

  const handleAddOwner = () => {
    setFormOwners([...formOwners, '']);
  };

  const handleRemoveOwner = (index: number) => {
    if (formOwners.length <= 1) return;
    setFormOwners(formOwners.filter((_, i) => i !== index));
  };

  const handleContactChange = (index: number, value: string) => {
    const updated = [...formContacts];
    updated[index] = value;
    setFormContacts(updated);
  };

  const handleAddContact = () => {
    setFormContacts([...formContacts, '']);
  };

  const handleRemoveContact = (index: number) => {
    if (formContacts.length <= 1) return;
    setFormContacts(formContacts.filter((_, i) => i !== index));
  };

  const validateForm = (): boolean => {
    const cleanName = formName.trim();
    const cleanVenue = formVenue.trim();
    const cleanDesc = formDescription.trim();
    const validOwners = formOwners.map(o => o.trim()).filter(Boolean);
    const validContacts = formContacts.map(c => c.trim()).filter(Boolean);

    if (cleanName.length < 2) {
      setFormError('Stall name must be at least 2 characters.');
      return false;
    }
    if (cleanVenue.length < 2) {
      setFormError('Stall venue must be specified.');
      return false;
    }
    if (validOwners.length === 0) {
      setFormError('At least one stall owner name is required.');
      return false;
    }
    if (validContacts.length === 0) {
      setFormError('At least one stall contact number is required.');
      return false;
    }
    for (const contact of validContacts) {
      const stripped = contact.replace(/[\s\-\+\(\)]/g, '');
      if (stripped.length < 7 || stripped.length > 15) {
        setFormError(`Invalid contact number format: "${contact}". Provide a valid phone number.`);
        return false;
      }
    }
    if (cleanDesc.length < 5) {
      setFormError('Stall description must be at least 5 characters.');
      return false;
    }

    setFormError(null);
    return true;
  };

  // Submit Create Stall (Admin Created = Immediately APPROVED)
  const handleCreateStall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || !selectedEventId) return;

    try {
      setIsSubmitting(true);
      setFormError(null);

      const validOwners = formOwners.map(o => o.trim()).filter(Boolean);
      const validContacts = formContacts.map(c => c.trim()).filter(Boolean);

      const { error: rpcErr } = await supabase.rpc('admin_create_stall', {
        p_event_id: selectedEventId,
        p_name: formName.trim().toUpperCase(),
        p_venue: formVenue.trim(),
        p_description: formDescription.trim(),
        p_banner_path: formBannerPath || null,
        p_owners: validOwners,
        p_contacts: validContacts,
        p_display_order: Number(formDisplayOrder) || 0,
      });

      if (rpcErr) throw rpcErr;

      setIsCreateModalOpen(false);
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to create stall:', err);
      setFormError(err.message || 'Failed to create stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Edit Stall
  const handleEditStall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || !activeStall) return;

    try {
      setIsSubmitting(true);
      setFormError(null);

      const validOwners = formOwners.map(o => o.trim()).filter(Boolean);
      const validContacts = formContacts.map(c => c.trim()).filter(Boolean);

      const { error: rpcErr } = await supabase.rpc('admin_update_stall', {
        p_stall_id: activeStall.id,
        p_name: formName.trim().toUpperCase(),
        p_venue: formVenue.trim(),
        p_description: formDescription.trim(),
        p_banner_path: formBannerPath || null,
        p_owners: validOwners,
        p_contacts: validContacts,
        p_display_order: Number(formDisplayOrder) || 0,
      });

      if (rpcErr) throw rpcErr;

      setIsEditModalOpen(false);
      setActiveStall(null);
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to update stall:', err);
      setFormError(err.message || 'Failed to update stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Approve Stall
  const handleApproveStall = async () => {
    if (!activeStall) return;

    try {
      setIsSubmitting(true);
      const { error: rpcErr } = await supabase.rpc('admin_approve_stall', {
        p_stall_id: activeStall.id,
      });

      if (rpcErr) throw rpcErr;

      setIsApproveModalOpen(false);
      setActiveStall(null);
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to approve stall:', err);
      alert(err.message || 'Failed to approve stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Reject Stall
  const handleRejectStall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStall) return;

    const cleanReason = rejectionReason.trim();
    if (cleanReason.length < 3) {
      setRejectionError('Please provide a specific rejection reason (at least 3 characters).');
      return;
    }

    try {
      setIsSubmitting(true);
      setRejectionError(null);

      const { error: rpcErr } = await supabase.rpc('admin_reject_stall', {
        p_stall_id: activeStall.id,
        p_reason: cleanReason,
      });

      if (rpcErr) throw rpcErr;

      setIsRejectModalOpen(false);
      setActiveStall(null);
      setRejectionReason('');
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to reject stall:', err);
      setRejectionError(err.message || 'Failed to reject stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Archive Stall
  const handleArchiveStall = async () => {
    if (!activeStall) return;

    try {
      setIsSubmitting(true);
      const { error: rpcErr } = await supabase.rpc('admin_delete_stall', {
        p_stall_id: activeStall.id,
      });

      if (rpcErr) throw rpcErr;

      setIsArchiveModalOpen(false);
      setActiveStall(null);
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to archive stall:', err);
      alert(err.message || 'Failed to archive stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Restore Stall
  const handleRestoreStall = async () => {
    if (!activeStall) return;

    try {
      setIsSubmitting(true);
      const { error: rpcErr } = await supabase.rpc('admin_restore_stall', {
        p_stall_id: activeStall.id,
      });

      if (rpcErr) throw rpcErr;

      setIsRestoreModalOpen(false);
      setActiveStall(null);
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to restore stall:', err);
      alert(err.message || 'Failed to restore stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Permanent Delete Stall
  const handlePermanentDeleteStall = async () => {
    if (!activeStall) return;

    try {
      setIsSubmitting(true);
      const { error: rpcErr } = await supabase.rpc('admin_permanent_delete_stall', {
        p_stall_id: activeStall.id,
      });

      if (rpcErr) throw rpcErr;

      setIsPermanentDeleteModalOpen(false);
      setActiveStall(null);
      await loadStalls();
    } catch (err: any) {
      console.error('Failed to permanently delete stall:', err);
      alert(err.message || 'Failed to permanently delete stall.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="MANAGE STALLS"
        description="Comprehensive stall administration, student proposal review, and live catalog publishing."
      />

      {/* Main Event Selector Card */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <label htmlFor="event-selector" className="text-xs font-black text-gray-500 uppercase tracking-wider block">
              SELECT MAIN EVENT
            </label>
            <div className="relative">
              <select
                id="event-selector"
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
                disabled={isLoadingEvents}
                className="w-full sm:w-80 appearance-none bg-gray-50 border border-gray-300 hover:border-gray-400 text-gray-900 font-bold rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] transition disabled:opacity-50"
              >
                {events.length === 0 ? (
                  <option value="">No active events found</option>
                ) : (
                  events.map(ev => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} ({ev.status})
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="absolute right-3 top-3.5 h-4 w-4 text-gray-500 pointer-events-none" />
            </div>
          </div>

          {selectedEvent && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleOpenCreateModal}
                className="inline-flex items-center gap-2 bg-[#C8102E] hover:bg-[#A00D24] text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-xs transition cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>+ ADD STALL</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* When no event is selected */}
      {!selectedEventId && (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-xs">
          <Store className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-900">Select a Main Event</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Choose an event from the selector above to manage its exhibition stalls, review pending student proposals, and publish listings.
          </p>
        </div>
      )}

      {/* Main Content (Loaded only after selecting an event) */}
      {selectedEventId && (
        <>
          {/* KPI Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">TOTAL STALLS</div>
              <div className="text-2xl font-black text-gray-900 mt-1">{stats.total}</div>
              <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                <Store className="h-3 w-3 text-gray-400" />
                <span>Across all statuses</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">APPROVED</div>
              <div className="text-2xl font-black text-emerald-600 mt-1">{stats.approved}</div>
              <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span>Live in student directory</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">PENDING APPROVAL</div>
              <div className="text-2xl font-black text-amber-600 mt-1">{stats.pending}</div>
              <div className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3 text-amber-500" />
                <span>Awaiting admin review</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">REJECTED</div>
              <div className="text-2xl font-black text-red-600 mt-1">{stats.rejected}</div>
              <div className="text-[11px] text-red-700 mt-1 flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-500" />
                <span>Proposals declined</span>
              </div>
            </div>
          </div>

          {/* Action & Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              <button
                type="button"
                onClick={() => setTabFilter('ALL')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  tabFilter === 'ALL'
                    ? 'bg-[#003366] text-white shadow-2xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All Stalls ({stats.total})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('APPROVED')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  tabFilter === 'APPROVED'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                Approved ({stats.approved})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('PENDING_APPROVAL')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer relative ${
                  tabFilter === 'PENDING_APPROVAL'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
              >
                Pending Review ({stats.pending})
                {stats.pending > 0 && (
                  <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('REJECTED')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  tabFilter === 'REJECTED'
                    ? 'bg-red-600 text-white shadow-2xs'
                    : 'bg-red-50 text-red-800 hover:bg-red-100'
                }`}
              >
                Rejected ({stats.rejected})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('ARCHIVED')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  tabFilter === 'ARCHIVED'
                    ? 'bg-slate-700 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Archived ({stats.archived})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search stalls, venues, owners..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-9 pr-4 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Stalls List / Cards */}
          {isLoadingStalls ? (
            <LoadingState message="Loading event stalls..." />
          ) : error ? (
            <ErrorState message={error} onRetry={loadStalls} />
          ) : filteredStalls.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-xs">
              <Store className="h-10 w-10 text-gray-300 mx-auto mb-2" />
              <h4 className="text-sm font-bold text-gray-900">No stalls found</h4>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? `No stalls matched "${searchQuery}". Try adjusting your search query.`
                  : tabFilter !== 'ALL'
                  ? `No stalls currently in ${tabFilter} state for this event.`
                  : 'No stalls have been created or submitted for this event yet.'}
              </p>
              {tabFilter === 'ALL' && !searchQuery && (
                <button
                  type="button"
                  onClick={handleOpenCreateModal}
                  className="mt-4 inline-flex items-center gap-1.5 bg-[#C8102E] text-white px-3.5 py-2 rounded-xl text-xs font-bold hover:bg-[#A00D24] transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create First Stall</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredStalls.map(stall => {
                const ownersList = stall.stall_owners?.map(o => o.owner_name) || [];
                const contactsList = stall.stall_contacts?.map(c => c.contact_value) || [];

                return (
                  <div
                    key={stall.id}
                    className="bg-white rounded-2xl border border-gray-200/90 shadow-xs hover:shadow-md transition-shadow overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      {/* Banner Image */}
                      <div className="relative h-44 w-full bg-slate-100 overflow-hidden border-b border-gray-100">
                        {stall.banner_path ? (
                          <img
                            src={stall.banner_path}
                            alt={stall.name}
                            className="w-full h-full object-cover"
                            onError={e => {
                              // Fallback on broken image
                              (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23CBD5E1" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                            <Store className="h-12 w-12" />
                            <span className="text-[11px] font-semibold text-slate-400 mt-1">No Banner Provided</span>
                          </div>
                        )}

                        {/* Status Badge */}
                        <div className="absolute top-3 right-3">
                          {stall.status === 'APPROVED' && (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/95 text-white text-[11px] font-black shadow-xs tracking-wide">
                              APPROVED
                            </span>
                          )}
                          {stall.status === 'PENDING_APPROVAL' && (
                            <span className="px-2.5 py-1 rounded-full bg-amber-500/95 text-white text-[11px] font-black shadow-xs tracking-wide">
                              PENDING APPROVAL
                            </span>
                          )}
                          {stall.status === 'REJECTED' && (
                            <span className="px-2.5 py-1 rounded-full bg-red-500/95 text-white text-[11px] font-black shadow-xs tracking-wide">
                              REJECTED
                            </span>
                          )}
                          {stall.status === 'ARCHIVED' && (
                            <span className="px-2.5 py-1 rounded-full bg-gray-500/95 text-white text-[11px] font-black shadow-xs tracking-wide">
                              ARCHIVED
                            </span>
                          )}
                        </div>

                        {/* Creator Badge */}
                        <div className="absolute bottom-3 left-3">
                          <span className="px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold">
                            {stall.created_by_type === 'ADMIN' ? '👑 Admin Created' : '🎓 Student Proposal'}
                          </span>
                        </div>
                      </div>

                      {/* Content Body */}
                      <div className="p-4 space-y-3">
                        <div>
                          <h3 className="text-base font-black text-gray-900 tracking-tight leading-snug">
                            {stall.name}
                          </h3>
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 font-semibold mt-1">
                            <MapPin className="h-3.5 w-3.5 text-[#C8102E] shrink-0" />
                            <span className="truncate">{stall.venue}</span>
                          </div>
                        </div>

                        {/* Owners & Contacts */}
                        <div className="bg-gray-50 rounded-xl p-2.5 space-y-1.5 border border-gray-100 text-xs">
                          <div className="flex items-start gap-1.5">
                            <Users className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-gray-700">Owners: </span>
                              <span className="text-gray-600">
                                {ownersList.length > 0 ? ownersList.join(', ') : 'None listed'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-start gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-gray-700">Contact: </span>
                              <span className="text-gray-600">
                                {contactsList.length > 0 ? contactsList.join(', ') : 'None listed'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Description Preview */}
                        <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                          {stall.description}
                        </p>

                        {/* Student Submitter Info (if any) */}
                        {stall.student_profile && (
                          <div className="text-[11px] text-gray-500 pt-1 border-t border-gray-100 flex items-center justify-between">
                            <span>
                              By: <strong className="text-gray-800">{stall.student_profile.full_name}</strong> ({stall.student_profile.roll_number})
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {formatDateTime12h(stall.created_at)}
                            </span>
                          </div>
                        )}

                        {/* Rejection Note if Rejected */}
                        {stall.status === 'REJECTED' && stall.rejection_reason && (
                          <div className="p-2.5 rounded-xl bg-red-50/80 border border-red-200 text-xs text-red-800 space-y-1">
                            <div className="font-bold flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                              <span>Rejection Reason:</span>
                            </div>
                            <p className="text-[11px] leading-snug">{stall.rejection_reason}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions Footer */}
                    <div className="p-3 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between gap-2">
                      {stall.status === 'ARCHIVED' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveStall(stall);
                              setIsRestoreModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition cursor-pointer flex items-center gap-1"
                            title="Restore to Approved"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Restore</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveStall(stall);
                              setIsPermanentDeleteModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-700 bg-red-100 hover:bg-red-200 transition cursor-pointer flex items-center gap-1"
                            title="Delete Permanently from Database"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete Permanently</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveStall(stall);
                              setIsViewModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-200/80 transition cursor-pointer"
                            title="View Stall Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(stall)}
                            className="p-1.5 rounded-lg text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                            title="Edit Stall"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveStall(stall);
                              setIsArchiveModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-gray-600 hover:text-amber-700 hover:bg-amber-50 transition cursor-pointer"
                            title="Archive Stall"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        </div>
                      )}

                      {/* Status Action Buttons for Active Stalls */}
                      {stall.status !== 'ARCHIVED' && (
                        <div className="flex items-center gap-2">
                          {stall.status === 'PENDING_APPROVAL' && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveStall(stall);
                                  setRejectionReason('');
                                  setRejectionError(null);
                                  setIsRejectModalOpen(true);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-700 bg-red-100 hover:bg-red-200 transition cursor-pointer"
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveStall(stall);
                                  setIsApproveModalOpen(true);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition cursor-pointer"
                              >
                                Approve
                              </button>
                            </>
                          )}
                          {stall.status === 'REJECTED' && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveStall(stall);
                                setIsApproveModalOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 transition cursor-pointer"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* =========================================================================
          MODAL: CREATE STALL (ADMIN)
          ========================================================================= */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">+ ADD STALL</h3>
                <p className="text-xs text-gray-500">
                  Create and immediately publish an official stall under{' '}
                  <strong className="text-gray-800">{selectedEvent?.name}</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateStall} className="flex-1 overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Main Event (read-only) */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  MAIN EVENT <span className="text-gray-400 font-normal">(locked)</span>
                </label>
                <input
                  type="text"
                  value={selectedEvent?.name || ''}
                  disabled
                  className="w-full bg-gray-100 border border-gray-300 rounded-xl px-3.5 py-2 text-xs font-bold text-gray-600 cursor-not-allowed"
                />
              </div>

              {/* Stall Name */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  STALL NAME <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. SCIENCE & TECH PAVILION"
                  value={formName}
                  onChange={e => setFormName(e.target.value.toUpperCase())}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs font-bold uppercase text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  Automatically converted to uppercase per KITS naming standards.
                </span>
              </div>

              {/* Venue */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  STALL VENUE <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Innovation Block — Ground Floor"
                  value={formVenue}
                  onChange={e => setFormVenue(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Stall Owners (Multiple) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-700">
                    STALL OWNER(S) <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddOwner}
                    className="text-xs font-bold text-[#003366] hover:underline"
                  >
                    + Add Owner
                  </button>
                </div>
                <div className="space-y-2">
                  {formOwners.map((owner, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Owner ${idx + 1} Name`}
                        value={owner}
                        onChange={e => handleOwnerChange(idx, e.target.value)}
                        required
                        className="flex-1 bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                      />
                      {formOwners.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOwner(idx)}
                          className="text-gray-400 hover:text-red-600 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Stall Contacts (Multiple) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-700">
                    STALL CONTACT(S) <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddContact}
                    className="text-xs font-bold text-[#003366] hover:underline"
                  >
                    + Add Contact
                  </button>
                </div>
                <div className="space-y-2">
                  {formContacts.map((contact, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="tel"
                        placeholder={`e.g. +91 98765 43210`}
                        value={contact}
                        onChange={e => handleContactChange(idx, e.target.value)}
                        required
                        className="flex-1 bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                      />
                      {formContacts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveContact(idx)}
                          className="text-gray-400 hover:text-red-600 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  STALL DESCRIPTION <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  placeholder="Describe the products, exhibits, or interactive solutions available at this stall..."
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Banner Image Upload */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 block">
                  STALL BANNER
                </label>
                <ImageUpload
                  value={formBannerPath}
                  onChange={setFormBannerPath}
                  bucket="stall-banners"
                  folder="banners"
                  label="Stall Banner Image"
                  helperText="JPEG, PNG, WebP up to 5MB. Recommended ratio: 16:9"
                />
              </div>

              {/* Display Order */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  DISPLAY ORDER <span className="text-gray-400 font-normal">(numeric priority, default: 0)</span>
                </label>
                <input
                  type="number"
                  value={formDisplayOrder}
                  onChange={e => setFormDisplayOrder(Number(e.target.value) || 0)}
                  className="w-32 bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-[#C8102E] hover:bg-[#A00D24] shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create & Publish Stall</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: EDIT STALL (ADMIN)
          ========================================================================= */}
      {isEditModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">EDIT STALL</h3>
                <p className="text-xs text-gray-500">
                  Update stall parameters for <strong className="text-gray-800">{activeStall.name}</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setActiveStall(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleEditStall} className="flex-1 overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Stall Name */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  STALL NAME <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value.toUpperCase())}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs font-bold uppercase text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Venue */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  STALL VENUE <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formVenue}
                  onChange={e => setFormVenue(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Stall Owners (Multiple) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-700">
                    STALL OWNER(S) <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddOwner}
                    className="text-xs font-bold text-[#003366] hover:underline"
                  >
                    + Add Owner
                  </button>
                </div>
                <div className="space-y-2">
                  {formOwners.map((owner, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={owner}
                        onChange={e => handleOwnerChange(idx, e.target.value)}
                        required
                        className="flex-1 bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                      />
                      {formOwners.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOwner(idx)}
                          className="text-gray-400 hover:text-red-600 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Stall Contacts (Multiple) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-700">
                    STALL CONTACT(S) <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddContact}
                    className="text-xs font-bold text-[#003366] hover:underline"
                  >
                    + Add Contact
                  </button>
                </div>
                <div className="space-y-2">
                  {formContacts.map((contact, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="tel"
                        value={contact}
                        onChange={e => handleContactChange(idx, e.target.value)}
                        required
                        className="flex-1 bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                      />
                      {formContacts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveContact(idx)}
                          className="text-gray-400 hover:text-red-600 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  STALL DESCRIPTION <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Banner Image Upload */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 block">
                  STALL BANNER
                </label>
                <ImageUpload
                  value={formBannerPath}
                  onChange={setFormBannerPath}
                  bucket="stall-banners"
                  folder="banners"
                  label="Stall Banner Image"
                  helperText="JPEG, PNG, WebP up to 5MB. Recommended ratio: 16:9"
                />
              </div>

              {/* Display Order */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  DISPLAY ORDER <span className="text-gray-400 font-normal">(numeric priority)</span>
                </label>
                <input
                  type="number"
                  value={formDisplayOrder}
                  onChange={e => setFormDisplayOrder(Number(e.target.value) || 0)}
                  className="w-32 bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setActiveStall(null);
                  }}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-[#003366] hover:bg-[#002244] shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: VIEW DETAILS
          ========================================================================= */}
      {isViewModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header Banner */}
            <div className="relative h-56 bg-slate-900 overflow-hidden">
              {activeStall.banner_path ? (
                <img
                  src={activeStall.banner_path}
                  alt={activeStall.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-500">
                  <Store className="h-16 w-16" />
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsViewModalOpen(false);
                  setActiveStall(null);
                }}
                className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide uppercase bg-blue-100 text-kits-blue">
                    {selectedEvent?.name}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide uppercase ${
                    activeStall.status === 'APPROVED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : activeStall.status === 'PENDING_APPROVAL'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {activeStall.status}
                  </span>
                </div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                  {activeStall.name}
                </h3>
                <div className="flex items-center gap-1.5 text-xs text-gray-600 font-semibold mt-1">
                  <MapPin className="h-3.5 w-3.5 text-[#C8102E]" />
                  <span>{activeStall.venue}</span>
                </div>
              </div>

              {/* Owners & Contacts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                <div>
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Users className="h-3 w-3 text-gray-500" />
                    <span>STALL OWNERS</span>
                  </div>
                  <ul className="text-xs text-gray-800 font-medium space-y-0.5">
                    {activeStall.stall_owners?.map(o => (
                      <li key={o.id}>• {o.owner_name}</li>
                    )) || <li>None</li>}
                  </ul>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Phone className="h-3 w-3 text-gray-500" />
                    <span>CONTACT NUMBERS</span>
                  </div>
                  <ul className="text-xs text-gray-800 font-medium space-y-0.5">
                    {activeStall.stall_contacts?.map(c => (
                      <li key={c.id}>• {c.contact_value}</li>
                    )) || <li>None</li>}
                  </ul>
                </div>
              </div>

              {/* Description */}
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  ABOUT THIS STALL
                </h4>
                <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {activeStall.description}
                </p>
              </div>

              {/* Submitter & Metadata */}
              <div className="text-[11px] text-gray-500 pt-3 border-t border-gray-100 space-y-1">
                <div>
                  <strong>Created:</strong> {formatDateTime12h(activeStall.created_at)} ({activeStall.created_by_type})
                </div>
                {activeStall.student_profile && (
                  <div>
                    <strong>Submitted by Student:</strong> {activeStall.student_profile.full_name} ({activeStall.student_profile.roll_number})
                  </div>
                )}
                {activeStall.approved_at && (
                  <div>
                    <strong>Approved:</strong> {formatDateTime12h(activeStall.approved_at)}
                  </div>
                )}
                {activeStall.rejection_reason && (
                  <div className="text-red-600 font-medium">
                    <strong>Rejection Reason:</strong> {activeStall.rejection_reason}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsViewModalOpen(false);
                  setActiveStall(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-200 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: APPROVE CONFIRMATION
          ========================================================================= */}
      {isApproveModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">Approve Stall?</h3>
                <p className="text-xs text-gray-500">
                  This will make the stall visible to all students in the public Stall Directory.
                </p>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl text-xs text-emerald-900 space-y-1">
              <div>
                Stall: <strong className="font-bold text-emerald-950">{activeStall.name}</strong>
              </div>
              <div>
                Event: <strong className="font-bold text-emerald-950">{selectedEvent?.name}</strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsApproveModalOpen(false);
                  setActiveStall(null);
                }}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveStall}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Approving...' : 'Approve Stall'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: REJECT CONFIRMATION
          ========================================================================= */}
      {isRejectModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <XCircle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">Reject Stall Submission</h3>
                <p className="text-xs text-gray-500">
                  Provide a mandatory rejection reason to inform the student.
                </p>
              </div>
            </div>

            {rejectionError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
                {rejectionError}
              </div>
            )}

            <form onSubmit={handleRejectStall} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  REJECTION REASON <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Duplicate proposal / Insufficient contact details / Venue unavailable..."
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRejectModalOpen(false);
                    setActiveStall(null);
                    setRejectionReason('');
                  }}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Rejecting...' : 'Reject Submission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: ARCHIVE CONFIRMATION
          ========================================================================= */}
      {isArchiveModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                <Archive className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">Archive Stall?</h3>
                <p className="text-xs text-gray-500">
                  This will archive <strong className="text-gray-800">{activeStall.name}</strong> and remove it from active visibility in the student directory.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsArchiveModalOpen(false);
                  setActiveStall(null);
                }}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveStall}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: RESTORE CONFIRMATION
          ========================================================================= */}
      {isRestoreModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">Restore Stall?</h3>
                <p className="text-xs text-gray-500">
                  This will restore <strong className="text-gray-800">{activeStall.name}</strong> back to Approved status and make it visible in the student directory.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsRestoreModalOpen(false);
                  setActiveStall(null);
                }}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestoreStall}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: PERMANENT DELETE CONFIRMATION
          ========================================================================= */}
      {isPermanentDeleteModalOpen && activeStall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">Permanently Delete Stall?</h3>
                <p className="text-xs text-gray-500">
                  This action <strong className="text-red-600">CANNOT be undone</strong>. This will permanently delete <strong className="text-gray-800">{activeStall.name}</strong> and all its contact and owner records from the database.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsPermanentDeleteModalOpen(false);
                  setActiveStall(null);
                }}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePermanentDeleteStall}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
