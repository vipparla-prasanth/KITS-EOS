import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { useAuth } from '../../context/AuthContext';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { playRegistrationSuccessSound } from '../../utils/registrationSound';
import { 
  Store, 
  Search, 
  MapPin, 
  Users, 
  Phone, 
  Plus, 
  X, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  UploadCloud, 
  Eye, 
  Edit2, 
  Info,
  ChevronDown,
  ArrowLeft
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
  stall_id: string;
  owner_name: string;
  display_order: number;
}

interface StallContact {
  id: string;
  stall_id: string;
  contact_value: string;
  display_order: number;
}

interface Stall {
  id: string;
  event_id: string;
  name: string;
  venue: string;
  description: string;
  banner_path: string | null;
  status: 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED' | 'ARCHIVED';
  created_by_type: 'ADMIN' | 'STUDENT';
  created_by_student_id: string | null;
  rejection_reason: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  events?: {
    id: string;
    name: string;
    status: string;
  } | null;
  stall_owners: StallOwner[];
  stall_contacts: StallContact[];
}

type SortOption = 'DISPLAY_ORDER' | 'NAME_ASC' | 'NAME_DESC' | 'NEWEST';

export function StallsDirectory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventIdParam = searchParams.get('eventId');

  // Data State
  const [events, setEvents] = useState<EventOption[]>([]);
  const [approvedStalls, setApprovedStalls] = useState<Stall[]>([]);
  const [mySubmissions, setMySubmissions] = useState<Stall[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Controls
  const [activeTab, setActiveTab] = useState<'DIRECTORY' | 'MY_SUBMISSIONS'>('DIRECTORY');
  const [selectedEventId, setSelectedEventId] = useState<string>(eventIdParam || 'ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedVenue, setSelectedVenue] = useState<string>('ALL');
  const [sortOption, setSortOption] = useState<SortOption>('DISPLAY_ORDER');

  useEffect(() => {
    if (eventIdParam) {
      setSelectedEventId(eventIdParam);
    }
  }, [eventIdParam]);

  const scopedEvent = useMemo(() => {
    if (!eventIdParam) return null;
    return events.find(e => e.id === eventIdParam) || null;
  }, [events, eventIdParam]);

  // Modals
  const [selectedStallForDetails, setSelectedStallForDetails] = useState<Stall | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState<boolean>(false);
  const [editingSubmission, setEditingSubmission] = useState<Stall | null>(null);

  // Submission Form State
  const [formEventId, setFormEventId] = useState<string>('');
  const [formName, setFormName] = useState<string>('');
  const [formVenue, setFormVenue] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formBannerUrl, setFormBannerUrl] = useState<string | null>(null);
  const [formOwners, setFormOwners] = useState<string[]>(['']);
  const [formContacts, setFormContacts] = useState<string[]>(['']);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState<boolean>(false);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  // 1. Load active events
  const loadEvents = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('events')
        .select('id, name, status, start_date, end_date')
        .neq('status', 'PERMANENTLY_DELETED')
        .neq('status', 'ARCHIVED')
        .order('start_date', { ascending: true });

      if (err) throw err;
      setEvents((data as EventOption[]) || []);
    } catch (err: any) {
      console.error('Failed to load events for stall directory:', err);
    }
  }, []);

  // 2. Load approved stalls
  const loadApprovedStalls = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Query stalls with status = APPROVED
      const { data, error: err } = await supabase
        .from('stalls')
        .select(`
          *,
          events!stalls_event_id_fkey (id, name, status),
          stall_owners (*),
          stall_contacts (*)
        `)
        .eq('status', 'APPROVED')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (err) throw err;
      setApprovedStalls((data as Stall[]) || []);
    } catch (err: any) {
      console.error('Failed to load approved stalls:', err);
      setError(err.message || 'Unable to load stalls directory. Please check your network connection.');
      setApprovedStalls([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 3. Load authenticated student's own submissions
  const loadMySubmissions = useCallback(async () => {
    if (!user) {
      setMySubmissions([]);
      return;
    }

    try {
      const { data, error: err } = await supabase
        .from('stalls')
        .select(`
          *,
          events!stalls_event_id_fkey (id, name, status),
          stall_owners (*),
          stall_contacts (*)
        `)
        .eq('created_by_student_id', user.id)
        .order('created_at', { ascending: false });

      if (err) throw err;
      setMySubmissions((data as Stall[]) || []);
    } catch (err: any) {
      console.error('Failed to load student stall submissions:', err);
      setMySubmissions([]);
    }
  }, [user]);

  useEffect(() => {
    loadEvents();
    loadApprovedStalls();
  }, [loadEvents, loadApprovedStalls]);

  useEffect(() => {
    if (user) {
      loadMySubmissions();
    }
  }, [user, loadMySubmissions]);

  const loadApprovedStallsRef = useRef(loadApprovedStalls);
  loadApprovedStallsRef.current = loadApprovedStalls;

  const loadMySubmissionsRef = useRef(loadMySubmissions);
  loadMySubmissionsRef.current = loadMySubmissions;

  const userRef = useRef(user);
  userRef.current = user;

  // 4. Realtime subscription for live directory and student submissions updates
  useEffect(() => {
    let channel: any = null;
    try {
      const topic = `student-stalls-dir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'stalls' },
          () => {
            loadApprovedStallsRef.current();
            if (userRef.current) {
              loadMySubmissionsRef.current();
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'stall_owners' },
          () => {
            loadApprovedStallsRef.current();
            if (userRef.current) {
              loadMySubmissionsRef.current();
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'stall_contacts' },
          () => {
            loadApprovedStallsRef.current();
            if (userRef.current) {
              loadMySubmissionsRef.current();
            }
          }
        );

      channel.subscribe((status: string, err?: Error) => {
        if (err) {
          console.warn('[StallsDirectory] Realtime warning:', status, err);
        }
      });
    } catch (err) {
      console.warn('[StallsDirectory] Realtime subscription error:', err);
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
  }, []);

  // Unique venues list for filter
  const availableVenues = useMemo(() => {
    const set = new Set<string>();
    approvedStalls.forEach(s => {
      if (s.venue && s.venue.trim()) {
        set.add(s.venue.trim());
      }
    });
    return Array.from(set).sort();
  }, [approvedStalls]);

  // Filter & Search Stalls
  const filteredStalls = useMemo(() => {
    // Only approved stalls belonging to active (non-deleted, non-archived) events
    let result = approvedStalls.filter(
      s => s.events && s.events.status !== 'PERMANENTLY_DELETED' && s.events.status !== 'ARCHIVED'
    );

    // Event filter: strictly scope if eventIdParam is in the URL
    if (eventIdParam) {
      result = result.filter(s => s.event_id === eventIdParam);
    } else if (selectedEventId !== 'ALL') {
      result = result.filter(s => s.event_id === selectedEventId);
    }

    // Venue filter
    if (selectedVenue !== 'ALL') {
      result = result.filter(s => s.venue?.trim().toLowerCase() === selectedVenue.trim().toLowerCase());
    }

    // Search filter (Case-insensitive across Name, Venue, Owner, Event, Description)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(s => {
        const nameMatch = s.name?.toLowerCase().includes(q);
        const venueMatch = s.venue?.toLowerCase().includes(q);
        const descMatch = s.description?.toLowerCase().includes(q);
        const eventMatch = s.events?.name?.toLowerCase().includes(q);
        const ownerMatch = s.stall_owners?.some(o => o.owner_name?.toLowerCase().includes(q));
        return nameMatch || venueMatch || descMatch || eventMatch || ownerMatch;
      });
    }

    // Sort
    result.sort((a, b) => {
      if (sortOption === 'NAME_ASC') {
        return a.name.localeCompare(b.name);
      }
      if (sortOption === 'NAME_DESC') {
        return b.name.localeCompare(a.name);
      }
      if (sortOption === 'NEWEST') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      // Default: DISPLAY_ORDER ascending, then created_at descending
      const orderA = a.display_order ?? 0;
      const orderB = b.display_order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [approvedStalls, selectedEventId, eventIdParam, selectedVenue, searchQuery, sortOption]);

  // Submission Form Handlers
  const handleOpenSubmitModal = (existingStall?: Stall) => {
    if (!user) {
      const redirectUrl = eventIdParam ? `/stalls?eventId=${eventIdParam}` : '/stalls';
      navigate(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    if (existingStall) {
      setEditingSubmission(existingStall);
      setFormEventId(existingStall.event_id);
      setFormName(existingStall.name);
      setFormVenue(existingStall.venue);
      setFormDescription(existingStall.description);
      setFormBannerUrl(existingStall.banner_path);
      setFormOwners(
        existingStall.stall_owners && existingStall.stall_owners.length > 0
          ? existingStall.stall_owners.map(o => o.owner_name)
          : ['']
      );
      setFormContacts(
        existingStall.stall_contacts && existingStall.stall_contacts.length > 0
          ? existingStall.stall_contacts.map(c => c.contact_value)
          : ['']
      );
    } else {
      setEditingSubmission(null);
      setFormEventId(eventIdParam || (selectedEventId !== 'ALL' ? selectedEventId : (events[0]?.id || '')));
      setFormName('');
      setFormVenue('');
      setFormDescription('');
      setFormBannerUrl(null);
      setFormOwners(['']);
      setFormContacts(['']);
    }
    setFormError(null);
    setIsSubmitModalOpen(true);
  };

  const handleOwnerChange = (index: number, val: string) => {
    const updated = [...formOwners];
    updated[index] = val;
    setFormOwners(updated);
  };

  const handleAddOwner = () => setFormOwners([...formOwners, '']);
  const handleRemoveOwner = (index: number) => {
    if (formOwners.length > 1) {
      setFormOwners(formOwners.filter((_, i) => i !== index));
    }
  };

  const handleContactChange = (index: number, val: string) => {
    const updated = [...formContacts];
    updated[index] = val;
    setFormContacts(updated);
  };

  const handleAddContact = () => setFormContacts([...formContacts, '']);
  const handleRemoveContact = (index: number) => {
    if (formContacts.length > 1) {
      setFormContacts(formContacts.filter((_, i) => i !== index));
    }
  };

  // Banner Upload Handler
  const handleBannerFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Only JPEG, PNG, and WebP images are allowed.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFormError('Image size must be less than 5MB.');
      return;
    }

    try {
      setIsUploadingBanner(true);
      setFormError(null);

      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `student_banners/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('stall-banners')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const { data: publicData } = supabase.storage
        .from('stall-banners')
        .getPublicUrl(fileName);

      setFormBannerUrl(publicData.publicUrl);
    } catch (err: any) {
      console.error('Failed to upload stall banner:', err);
      setFormError(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setIsUploadingBanner(false);
    }
  };

  // Form Validation
  const validateSubmission = (): boolean => {
    if (!formEventId) {
      setFormError('Please select a Main Event.');
      return false;
    }
    if (formName.trim().length < 2) {
      setFormError('Stall name must be at least 2 characters.');
      return false;
    }
    if (formVenue.trim().length < 2) {
      setFormError('Stall venue must be specified.');
      return false;
    }
    const validOwners = formOwners.map(o => o.trim()).filter(Boolean);
    if (validOwners.length === 0) {
      setFormError('At least one stall owner name is required.');
      return false;
    }
    const validContacts = formContacts.map(c => c.trim()).filter(Boolean);
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
    if (formDescription.trim().length < 5) {
      setFormError('Stall description must be at least 5 characters.');
      return false;
    }

    setFormError(null);
    return true;
  };

  // Submit Stall Proposal (RPC student_submit_stall or student_update_pending_stall)
  const handleSubmitStallProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateSubmission()) return;

    try {
      setIsSubmitting(true);
      setFormError(null);

      const validOwners = formOwners.map(o => o.trim()).filter(Boolean);
      const validContacts = formContacts.map(c => c.trim()).filter(Boolean);

      if (editingSubmission) {
        // Edit existing pending submission
        const { error: rpcErr } = await supabase.rpc('student_update_pending_stall', {
          p_stall_id: editingSubmission.id,
          p_name: formName.trim().toUpperCase(),
          p_venue: formVenue.trim(),
          p_description: formDescription.trim(),
          p_banner_path: formBannerUrl || null,
          p_owners: validOwners,
          p_contacts: validContacts,
        });

        if (rpcErr) throw rpcErr;
        playRegistrationSuccessSound({ dedupeKey: `stall-update-${editingSubmission.id}` });
      } else {
        // Create new proposal
        const { error: rpcErr } = await supabase.rpc('student_submit_stall', {
          p_event_id: formEventId,
          p_name: formName.trim().toUpperCase(),
          p_venue: formVenue.trim(),
          p_description: formDescription.trim(),
          p_banner_path: formBannerUrl || null,
          p_owners: validOwners,
          p_contacts: validContacts,
        });

        if (rpcErr) throw rpcErr;
        playRegistrationSuccessSound({ dedupeKey: `stall-submit-${formEventId}-${formName.trim().toUpperCase()}` });
      }

      setIsSubmitModalOpen(false);
      setEditingSubmission(null);
      await loadMySubmissions();
      setActiveTab('MY_SUBMISSIONS');
    } catch (err: any) {
      console.error('Failed to submit stall proposal:', err);
      setFormError(err.message || 'Failed to submit proposal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
      {/* =========================================================================
          HERO & HEADER BANNER
          ========================================================================= */}
      <div className="bg-gradient-to-b from-white via-white to-slate-50 border-b border-gray-200/80 pt-8 pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              {eventIdParam ? (
                <>
                  <Link
                    to={`/events/${eventIdParam}`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-kits-blue hover:text-blue-800 transition mb-2.5 group"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
                    <span>Back to {scopedEvent?.name || 'Event Details'}</span>
                  </Link>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-kits-blue text-xs font-black tracking-wide uppercase shadow-2xs">
                      <Store className="h-3.5 w-3.5" />
                      <span>EVENT-SCOPED STALLS</span>
                    </span>
                  </div>
                  <h1 className="text-2xl sm:text-4xl font-black text-gray-900 tracking-tight">
                    STALLS — <span className="text-kits-blue">{scopedEvent?.name || 'THIS EVENT'}</span>
                  </h1>
                  <p className="text-sm text-gray-600 mt-1 max-w-2xl leading-relaxed">
                    These are stalls belonging to this event. Explore student-driven innovations, project showcases, product kiosks, and creative exhibits officially registered for this event.
                  </p>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-200/60 text-[#C8102E] text-xs font-black tracking-wide uppercase shadow-2xs mb-2">
                    <Store className="h-3.5 w-3.5" />
                    <span>EXHIBITIONS & HUBS</span>
                  </div>
                  <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">
                    STALLS
                  </h1>
                  <p className="text-sm text-gray-600 mt-1 max-w-2xl leading-relaxed">
                    Discover stalls available at upcoming and active events. Explore student-driven innovations, project showcases, product kiosks, and creative exhibits across the KITS campus.
                  </p>
                </>
              )}
            </div>

            {/* Submit Stall Action Button */}
            <div className="shrink-0 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleOpenSubmitModal()}
                className="inline-flex items-center gap-2 bg-[#C8102E] hover:bg-[#A00D24] text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-xs transition cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>+ SUBMIT A STALL</span>
              </button>
            </div>
          </div>

          {/* Navigation Sub-Tabs (Directory vs My Submissions) */}
          {user && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setActiveTab('DIRECTORY')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'DIRECTORY'
                    ? 'bg-[#003366] text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200/80'
                }`}
              >
                {eventIdParam ? 'Event Approved Stalls' : 'All Approved Stalls'} ({approvedStalls.filter(s => !eventIdParam || s.event_id === eventIdParam).length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('MY_SUBMISSIONS')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer relative ${
                  activeTab === 'MY_SUBMISSIONS'
                    ? 'bg-[#003366] text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200/80'
                }`}
              >
                My Stall Submissions ({mySubmissions.length})
                {mySubmissions.some(s => s.status === 'PENDING_APPROVAL') && (
                  <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-amber-400" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* =========================================================================
            TAB 1: DIRECTORY VIEW (READ-ONLY)
            ========================================================================= */}
        {activeTab === 'DIRECTORY' && (
          <div className="space-y-6">
            {/* Filter Controls Bar */}
            <div className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={eventIdParam ? `Search stalls in ${scopedEvent?.name || 'this event'}...` : "Search stalls by name, venue, owner, or event..."}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-50/70 border border-gray-300/80 rounded-xl pl-10 pr-8 py-2.5 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Select Main Event Filter */}
              <div className="relative w-full lg:w-64">
                {eventIdParam ? (
                  <div className="w-full bg-blue-50/70 border border-blue-200 text-kits-blue text-xs font-bold rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                    <span className="truncate">{scopedEvent?.name || 'Current Event'}</span>
                    <span className="text-[10px] font-mono text-kits-blue/80 shrink-0 ml-1.5 uppercase bg-blue-100/90 px-1.5 py-0.5 rounded font-extrabold">SCOPED</span>
                  </div>
                ) : (
                  <>
                    <select
                      value={selectedEventId}
                      onChange={e => setSelectedEventId(e.target.value)}
                      className="w-full appearance-none bg-gray-50/70 border border-gray-300/80 text-gray-800 text-xs font-bold rounded-xl px-3.5 py-2.5 pr-8 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] transition"
                    >
                      <option value="ALL">All Events (Filter)</option>
                      {events.map(ev => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-3.5 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
                  </>
                )}
              </div>

              {/* Venue Filter */}
              {availableVenues.length > 0 && (
                <div className="relative w-full lg:w-48">
                  <select
                    value={selectedVenue}
                    onChange={e => setSelectedVenue(e.target.value)}
                    className="w-full appearance-none bg-gray-50/70 border border-gray-300/80 text-gray-800 text-xs font-bold rounded-xl px-3.5 py-2.5 pr-8 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] transition"
                  >
                    <option value="ALL">All Venues</option>
                    {availableVenues.map(v => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-3.5 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
                </div>
              )}

              {/* Sort Filter */}
              <div className="relative w-full lg:w-44">
                <select
                  value={sortOption}
                  onChange={e => setSortOption(e.target.value as SortOption)}
                  className="w-full appearance-none bg-gray-50/70 border border-gray-300/80 text-gray-800 text-xs font-bold rounded-xl px-3.5 py-2.5 pr-8 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] transition"
                >
                  <option value="DISPLAY_ORDER">Default Order</option>
                  <option value="NAME_ASC">Name (A-Z)</option>
                  <option value="NAME_DESC">Name (Z-A)</option>
                  <option value="NEWEST">Newest First</option>
                </select>
                <ChevronDown className="absolute right-3 top-3.5 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
              </div>
            </div>

            {/* Stalls Cards Grid */}
            {isLoading ? (
              <LoadingState message="Loading approved stalls..." />
            ) : error ? (
              <ErrorState message={error} onRetry={loadApprovedStalls} />
            ) : filteredStalls.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-gray-200/90 shadow-xs">
                <Store className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-gray-900">No stalls found</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                  {eventIdParam
                    ? searchQuery || selectedVenue !== 'ALL'
                      ? `No stalls match your filters in ${scopedEvent?.name || 'this event'}.`
                      : `No approved stalls are currently registered for ${scopedEvent?.name || 'this event'}.`
                    : searchQuery || selectedEventId !== 'ALL' || selectedVenue !== 'ALL'
                    ? 'No stalls match your selected filter criteria. Try resetting filters to see more results.'
                    : 'No approved stalls are currently published. Check back soon or submit a stall proposal!'}
                </p>
                {(searchQuery || (!eventIdParam && selectedEventId !== 'ALL') || selectedVenue !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      if (!eventIdParam) setSelectedEventId('ALL');
                      setSelectedVenue('ALL');
                    }}
                    className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-gray-700 transition cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredStalls.map(stall => {
                  const ownersList = stall.stall_owners?.map(o => o.owner_name) || [];
                  const contactsList = stall.stall_contacts?.map(c => c.contact_value) || [];

                  return (
                    <div
                      key={stall.id}
                      className="bg-white rounded-2xl border border-gray-200/80 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col justify-between group"
                    >
                      <div>
                        {/* Stall Banner Image */}
                        <div className="relative h-48 w-full bg-slate-100 overflow-hidden">
                          {stall.banner_path ? (
                            <img
                              src={stall.banner_path}
                              alt={stall.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={e => {
                                (e.target as HTMLImageElement).src =
                                  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23CBD5E1" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                              <Store className="h-12 w-12" />
                              <span className="text-[11px] font-semibold text-slate-400 mt-1">Exhibition Stall</span>
                            </div>
                          )}

                          {/* Event Name Tag */}
                          {stall.events?.name && (
                            <div className="absolute top-3 left-3">
                              <span className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-xs text-white text-[10px] font-black tracking-wide uppercase shadow-xs">
                                {stall.events.name}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Stall Details Body */}
                        <div className="p-5 space-y-3">
                          <h3 className="text-base font-black text-gray-900 tracking-tight leading-snug group-hover:text-[#C8102E] transition-colors">
                            {stall.name}
                          </h3>

                          {/* Venue */}
                          <div className="flex items-start gap-1.5 text-xs text-gray-600 font-medium">
                            <MapPin className="h-3.5 w-3.5 text-[#C8102E] shrink-0 mt-0.5" />
                            <span className="line-clamp-1">{stall.venue}</span>
                          </div>

                          {/* Owner & Contact Pill */}
                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1.5">
                            <div className="flex items-start gap-1.5">
                              <Users className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <span className="font-bold text-gray-700">Owner: </span>
                                <span className="text-gray-600 truncate">
                                  {ownersList.length > 0 ? ownersList.join(', ') : 'Not specified'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-start gap-1.5">
                              <Phone className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <span className="font-bold text-gray-700">Contact: </span>
                                <span className="text-gray-600 font-mono text-[11px]">
                                  {contactsList.length > 0 ? contactsList[0] : 'Not specified'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Description Snippet */}
                          <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                            {stall.description}
                          </p>
                        </div>
                      </div>

                      {/* Card Action (Strictly READ-ONLY View Details) */}
                      <div className="p-4 bg-gray-50/70 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => setSelectedStallForDetails(stall)}
                          className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold text-[#003366] bg-blue-50/80 hover:bg-[#003366] hover:text-white transition-colors cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>VIEW DETAILS</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 2: MY SUBMISSIONS (STUDENT OWN SUBMISSIONS ONLY)
            ========================================================================= */}
        {activeTab === 'MY_SUBMISSIONS' && user && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-gray-200/90 shadow-xs flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-gray-900">MY STALL SUBMISSIONS</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Track the status of your stall proposals submitted for admin review.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleOpenSubmitModal()}
                className="inline-flex items-center gap-1.5 bg-[#C8102E] text-white px-3.5 py-2 rounded-xl text-xs font-bold hover:bg-[#A00D24] transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Submit Another Stall</span>
              </button>
            </div>

            {mySubmissions.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-gray-200/90 shadow-xs">
                <Store className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-gray-900">No stall submissions yet</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Have a project, startup idea, or exhibition you want to host at an upcoming event? Submit a stall proposal for administrator review.
                </p>
                <button
                  type="button"
                  onClick={() => handleOpenSubmitModal()}
                  className="mt-4 px-4 py-2 bg-[#C8102E] hover:bg-[#A00D24] rounded-xl text-xs font-bold text-white transition cursor-pointer"
                >
                  Submit a Stall
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {mySubmissions.map(sub => {
                  return (
                    <div
                      key={sub.id}
                      className="bg-white rounded-2xl border border-gray-200/90 shadow-xs p-5 space-y-4 flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-kits-blue text-[10px] font-black uppercase tracking-wide">
                              {sub.events?.name || 'Main Event'}
                            </span>
                            <h3 className="text-base font-black text-gray-900 mt-1">{sub.name}</h3>
                            <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5 font-medium">
                              <MapPin className="h-3 w-3 text-[#C8102E]" />
                              <span>{sub.venue}</span>
                            </div>
                          </div>

                          {/* Status Badge */}
                          <div>
                            {sub.status === 'PENDING_APPROVAL' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                <Clock className="h-3 w-3 text-amber-600" />
                                <span>PENDING ADMIN APPROVAL</span>
                              </span>
                            )}
                            {sub.status === 'APPROVED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                <span>APPROVED & PUBLISHED</span>
                              </span>
                            )}
                            {sub.status === 'REJECTED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-800 border border-red-200">
                                <AlertTriangle className="h-3 w-3 text-red-600" />
                                <span>REJECTED</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                          {sub.description}
                        </p>

                        {/* Rejection Details if rejected */}
                        {sub.status === 'REJECTED' && sub.rejection_reason && (
                          <div className="p-3 rounded-xl bg-red-50/80 border border-red-200 text-xs text-red-900 space-y-1">
                            <div className="font-bold flex items-center gap-1 text-red-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>Feedback from Administrator:</span>
                            </div>
                            <p className="text-[11px] leading-relaxed">{sub.rejection_reason}</p>
                            <div className="text-[10px] text-red-500 pt-1">
                              You may revise your proposal and submit a new stall.
                            </div>
                          </div>
                        )}

                        <div className="text-[11px] text-gray-400">
                          Submitted: {formatDateTime12h(sub.created_at)}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setSelectedStallForDetails(sub)}
                          className="text-xs font-bold text-gray-600 hover:text-gray-900"
                        >
                          View Details
                        </button>

                        {/* If pending, student can edit */}
                        {sub.status === 'PENDING_APPROVAL' && (
                          <button
                            type="button"
                            onClick={() => handleOpenSubmitModal(sub)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 transition cursor-pointer"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span>Edit Proposal</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          MODAL: VIEW DETAILS (READ-ONLY)
          ========================================================================= */}
      {selectedStallForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header Banner */}
            <div className="relative h-56 bg-slate-900 overflow-hidden">
              {selectedStallForDetails.banner_path ? (
                <img
                  src={selectedStallForDetails.banner_path}
                  alt={selectedStallForDetails.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                  <Store className="h-16 w-16" />
                  <span className="text-xs text-slate-400 mt-1">Exhibition Stall</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setSelectedStallForDetails(null)}
                className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Details Content */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-blue-100 text-kits-blue">
                    {selectedStallForDetails.events?.name || 'Main Event'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800">
                    APPROVED
                  </span>
                </div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                  {selectedStallForDetails.name}
                </h3>
                <div className="flex items-center gap-1.5 text-xs text-gray-600 font-semibold mt-1">
                  <MapPin className="h-3.5 w-3.5 text-[#C8102E]" />
                  <span>{selectedStallForDetails.venue}</span>
                </div>
              </div>

              {/* Owners & Contacts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-gray-500" />
                    <span>STALL OWNERS</span>
                  </div>
                  <ul className="text-xs text-gray-800 font-medium space-y-1">
                    {selectedStallForDetails.stall_owners?.map(o => (
                      <li key={o.id}>• {o.owner_name}</li>
                    )) || <li>None listed</li>}
                  </ul>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5 text-gray-500" />
                    <span>CONTACT NUMBERS</span>
                  </div>
                  <ul className="text-xs text-gray-800 font-medium space-y-1 font-mono text-[11px]">
                    {selectedStallForDetails.stall_contacts?.map(c => (
                      <li key={c.id}>• {c.contact_value}</li>
                    )) || <li>None listed</li>}
                  </ul>
                </div>
              </div>

              {/* Description */}
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  ABOUT THIS STALL
                </h4>
                <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {selectedStallForDetails.description}
                </p>
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-[11px] text-amber-900 leading-snug flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  This stall is informational and read-only. Visit the venue in-person during event hours to explore exhibits and interact with stall owners.
                </span>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedStallForDetails(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-200 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: SUBMIT / EDIT STALL PROPOSAL (STUDENT)
          ========================================================================= */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">
                  {editingSubmission ? 'EDIT STALL PROPOSAL' : 'SUBMIT A STALL PROPOSAL'}
                </h3>
                <p className="text-xs text-gray-500">
                  Submit your stall idea for administrative approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitStallProposal} className="flex-1 overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Main Event Selection */}
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  MAIN EVENT <span className="text-red-500">*</span>
                </label>
                <select
                  value={formEventId}
                  onChange={e => setFormEventId(e.target.value)}
                  disabled={Boolean(editingSubmission)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs font-bold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">Select an Event</option>
                  {events.map(ev => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
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

              {/* Stall Owners */}
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
                        placeholder={`Owner ${idx + 1} Full Name`}
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

              {/* Stall Contacts */}
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
                  placeholder="Detail the solutions, project items, or services your stall will exhibit..."
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3.5 py-2 text-xs text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E]"
                />
              </div>

              {/* Banner Upload */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 block">
                  STALL BANNER <span className="text-gray-400 font-normal">(optional, recommended)</span>
                </label>
                <input
                  type="file"
                  ref={bannerFileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleBannerFileSelect}
                  className="hidden"
                />

                {formBannerUrl ? (
                  <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 h-32 flex items-center justify-center">
                    <img
                      src={formBannerUrl}
                      alt="Banner Preview"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setFormBannerUrl(null)}
                      className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded-full shadow-xs hover:bg-red-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => bannerFileInputRef.current?.click()}
                    disabled={isUploadingBanner}
                    className="w-full border-2 border-dashed border-gray-300 hover:border-gray-400 rounded-xl p-4 flex flex-col items-center justify-center gap-1 bg-gray-50/50 hover:bg-gray-50 transition cursor-pointer text-center"
                  >
                    {isUploadingBanner ? (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <div className="w-4 h-4 border-2 border-[#C8102E] border-t-transparent rounded-full animate-spin" />
                        <span>Uploading banner...</span>
                      </div>
                    ) : (
                      <>
                        <UploadCloud className="h-6 w-6 text-gray-400" />
                        <span className="text-xs font-bold text-gray-700">Click to upload stall banner</span>
                        <span className="text-[10px] text-gray-400">JPEG, PNG, WebP up to 5MB</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Submission Notice */}
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-[11px] text-[#003366] leading-snug">
                <strong>Review Process:</strong> Your stall proposal will be submitted with status{' '}
                <span className="font-bold underline">PENDING ADMIN APPROVAL</span>. Once reviewed and approved by an administrator, it will be published to the public stall directory.
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSubmitModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isUploadingBanner}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-[#C8102E] hover:bg-[#A00D24] shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>{editingSubmission ? 'Update Proposal' : 'Submit Proposal'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
