import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useFormDraft, DraftSaveIndicator, ResumeDraftModal } from '@kits-eos/shared';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { DateTimePicker } from '../../components/ui/DateTimePicker';
import { ArrowLeft, Save, Sparkles, AlertTriangle } from 'lucide-react';

export function EditEvent() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [staleDraftNotice, setStaleDraftNotice] = useState<string | null>(null);

  // Persistent Draft Management
  const isFirstRenderRef = useRef(true);
  const {
    draft,
    hasExistingDraft,
    saveStatus,
    saveErrorMessage,
    lastSavedAt,
    triggerAutosave,
    resumeDraft,
    startNew,
    discardDraft,
  } = useFormDraft({
    draftType: 'ADMIN_EVENT_EDIT',
    entityId: eventId || null,
    title: name ? `Edit: ${name}` : 'Edit Event Draft',
    enabled: Boolean(eventId && !isLoading && !fetchError),
  });

  const handleResumeDraft = () => {
    const loaded = resumeDraft();
    if (!loaded?.payload) return;

    if (status === 'ARCHIVED') {
      setStaleDraftNotice('This event is currently ARCHIVED. Applying old draft changes is restricted. You may delete this stale draft.');
      return;
    }

    const p = loaded.payload;
    if (p.name !== undefined) setName(p.name);
    if (p.description !== undefined) setDescription(p.description);
    if (p.bannerPath !== undefined) setBannerPath(p.bannerPath);
    if (p.startDate !== undefined) setStartDate(p.startDate);
    if (p.endDate !== undefined) setEndDate(p.endDate);
    if (p.status !== undefined) setStatus(p.status);
  };

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (isLoading || fetchError) return;

    triggerAutosave({
      name,
      description,
      bannerPath,
      startDate,
      endDate,
      status,
    }, 1);
  }, [name, description, bannerPath, startDate, endDate, status, isLoading, fetchError, triggerAutosave]);

  useEffect(() => {
    async function fetchEvent() {
      if (!eventId) return;
      try {
        setIsLoading(true);
        setFetchError(null);
        
        const { data, error: err } = await supabase
          .from('events')
          .select('id, name, description, banner_path, start_date, end_date, status')
          .eq('id', eventId)
          .single();

        if (err) {
          if (err.code === 'PGRST116') {
            setFetchError('Event not found.');
          } else {
            throw err;
          }
        } else if (data) {
          setName(data.name);
          setDescription(data.description || '');
          setBannerPath(data.banner_path || null);
          
          setStartDate(data.start_date);
          setEndDate(data.end_date);
          setStatus(data.status as 'ACTIVE' | 'ARCHIVED');
        }
      } catch (err) {
        console.error('Failed to fetch event:', err);
        setFetchError('An unexpected error occurred while loading the event.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchEvent();
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setSubmitError('Event name is required.');
      return;
    }

    if (!startDate) {
      setSubmitError('Start date is required.');
      return;
    }

    if (!endDate) {
      setSubmitError('End date is required.');
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      setSubmitError('End date must be strictly after the start date.');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const { data, error: functionError } = await supabase.functions.invoke('admin-update-event', {
        body: {
          event_id: eventId,
          name: name.trim().toUpperCase(), 
          description: description.trim() || null,
          banner_path: bannerPath || null,
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
          status 
        }
      });

      if (functionError) {
        throw functionError;
      }

      if (!data?.success) {
        throw new Error(data?.error?.message || 'Failed to update event');
      }

      await discardDraft();
      navigate(`/admin/events/${eventId}`);
    } catch (err: any) {
      console.error('Event update failed:', err);
      let message = 'An unexpected error occurred while updating the event.';
      if (err instanceof Error) {
        message = err.message;
      }
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading event details..." />;
  }

  if (fetchError) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          <Link to="/admin/events" className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Events
          </Link>
        </div>
        <ErrorState message={fetchError} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="mb-4 flex items-center justify-between">
        <Link to={`/admin/events/${eventId}`} className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Event Details
        </Link>
      </div>

      <PageHeader
        title="Edit Main Event"
        description="Update event schedule, description, or official banner assets."
      />

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-t-xl px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-bold tracking-wide uppercase">Edit Event Configuration</h3>
          </div>
          <div className="flex items-center gap-3">
            <DraftSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} errorMessage={saveErrorMessage} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-white/10 text-gray-300">
              Event ID: {eventId?.substring(0, 8)}...
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {staleDraftNotice && (
            <div className="rounded-lg bg-amber-50 p-4 border border-amber-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 space-y-2">
                <p className="font-semibold">{staleDraftNotice}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await discardDraft();
                    setStaleDraftNotice(null);
                  }}
                  className="px-3 py-1 bg-amber-600 text-white rounded-md font-bold text-xs hover:bg-amber-700 transition"
                >
                  Delete Stale Draft
                </button>
              </div>
            </div>
          )}
          {submitError && (
            <div className="rounded-lg bg-red-50 p-4 border border-red-200">
              <ErrorState message={submitError} />
            </div>
          )}

          {/* Basic Info */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue mb-4 border-b border-gray-100 pb-2">
              1. Event Details
            </h4>
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Main Event Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                />
              </div>

              <div className="pt-2">
                <ImageUpload
                  value={bannerPath}
                  onChange={setBannerPath}
                  folder="events/banners"
                  label="Event Banner"
                  helperText="Upload updated event poster or banner."
                />
              </div>
            </div>
          </div>

          {/* Schedule & Status */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue mb-4 border-b border-gray-100 pb-2">
              2. Schedule & Visibility
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <DateTimePicker
                  id="start_date"
                  label="Start Date & Time"
                  required
                  value={startDate}
                  onChange={(iso) => setStartDate(iso)}
                  placeholder="DD-MM-YYYY  hh:mm AM/PM"
                />
              </div>

              <div>
                <DateTimePicker
                  id="end_date"
                  label="End Date & Time"
                  required
                  value={endDate}
                  onChange={(iso) => setEndDate(iso)}
                  placeholder="DD-MM-YYYY  hh:mm AM/PM"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="status" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Publication Status
                </label>
                <select
                  id="status"
                  name="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'ARCHIVED')}
                  className="block w-full md:w-64 rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="border-t border-gray-200 pt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 w-full">
            <Link
              to={`/admin/events/${eventId}`}
              className="btn-secondary w-full sm:w-auto px-4 py-2.5 text-sm font-semibold text-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-liquid btn-primary-red w-full sm:w-auto px-5 py-2.5 text-sm font-bold shadow-sm text-center"
            >
              <span className="btn-content">
                <Save className="h-4 w-4" />
                <span>{isSubmitting ? 'Saving...' : 'Save Changes'}</span>
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Resume Draft Modal */}
      <ResumeDraftModal
        isOpen={hasExistingDraft}
        title={draft?.title || 'Edit Event Draft'}
        subtitle={`Existing Event: ${name || eventId}`}
        lastSavedAt={lastSavedAt || draft?.updated_at}
        onResume={handleResumeDraft}
        onStartNew={startNew}
        onDelete={discardDraft}
      />
    </div>
  );
}
