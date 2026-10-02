import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useFormDraft, DraftSaveIndicator, ResumeDraftModal } from '@kits-eos/shared';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { DateTimePicker } from '../../components/ui/DateTimePicker';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';

export function CreateEvent() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    draftType: 'ADMIN_EVENT_CREATE',
    entityId: null,
    title: name ? `Event: ${name}` : 'Main Event Draft',
    enabled: true,
  });

  const handleResumeDraft = () => {
    const loaded = resumeDraft();
    if (!loaded?.payload) return;
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
    triggerAutosave({
      name,
      description,
      bannerPath,
      startDate,
      endDate,
      status,
    }, 1);
  }, [name, description, bannerPath, startDate, endDate, status, triggerAutosave]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Main Event title is required.');
      return;
    }

    if (!startDate) {
      setError('Event start date and time is required.');
      return;
    }

    if (!endDate) {
      setError('Event end date and time is required.');
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      setError('Event end date must be strictly after the start date.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const { data, error: functionError } = await supabase.functions.invoke('admin-create-event', {
        body: { 
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

      if (!data?.success || !data?.event) {
        throw new Error(data?.error?.message || 'Failed to create event');
      }

      // Contextual navigation directly to newly created event details
      await discardDraft();
      navigate(`/admin/events/${data.event.id}`);
    } catch (err: any) {
      console.error('Event creation failed:', err);

      let message = 'An unexpected error occurred while creating the event.';

      if (err?.context && typeof err.context.json === 'function') {
        try {
          const body = await err.context.json();
          if (body?.error?.message) {
            message = body.error.message;
          }
        } catch {
          // ignore json parse error
        }
      } else if (err instanceof Error) {
        message = err.message;
      }

      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="mb-4">
        <Link 
          to="/admin/events" 
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Events List
        </Link>
      </div>

      <PageHeader
        title="Create Main Event"
        description="Configure a new flagship event with complete schedule and media assets."
      />

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-t-xl px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-bold tracking-wide uppercase">Event Configuration</h3>
          </div>
          <div className="flex items-center gap-3">
            <DraftSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} errorMessage={saveErrorMessage} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-white/10 text-gray-300">
              Step 1 of 3 (Main Event)
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {error && (
            <div className="rounded-lg bg-red-50 p-4 border border-red-200">
              <ErrorState message={error} />
            </div>
          )}

          {/* Basic Info Section */}
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
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                  placeholder="e.g. KITS FEST 2026 / National Tech Symposium"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Event Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                  placeholder="Provide an overview of the event, eligibility, and core theme..."
                />
              </div>

              {/* Event Banner Upload */}
              <div className="pt-2">
                <ImageUpload
                  value={bannerPath}
                  onChange={setBannerPath}
                  folder="events/banners"
                  label="Event Banner"
                  helperText="Upload official event poster or banner. PNG, JPG, WebP up to 5MB."
                />
              </div>
            </div>
          </div>

          {/* Schedule & Status Section */}
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
                  <option value="ACTIVE">ACTIVE (Published to Students)</option>
                  <option value="ARCHIVED">ARCHIVED (Internal / Draft)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="border-t border-gray-200 pt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 w-full">
            <Link
              to="/admin/events"
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
                <span>{isSubmitting ? 'Creating Event...' : 'Create Event & Proceed'}</span>
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Resume Draft Modal */}
      <ResumeDraftModal
        isOpen={hasExistingDraft}
        title={draft?.title || 'Main Event Draft'}
        subtitle="Unfinished event creation"
        lastSavedAt={lastSavedAt || draft?.updated_at}
        onResume={handleResumeDraft}
        onStartNew={startNew}
        onDelete={discardDraft}
      />
    </div>
  );
}
