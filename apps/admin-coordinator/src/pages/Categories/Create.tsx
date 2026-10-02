import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useFormDraft, DraftSaveIndicator, ResumeDraftModal } from '@kits-eos/shared';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { ArrowLeft, Save, FolderPlus } from 'lucide-react';
import type { Event } from '@kits-eos/shared/src/types/models';

export function CreateCategory() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');

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
    draftType: 'ADMIN_CATEGORY_CREATE',
    entityId: eventId || null,
    title: name ? `Category: ${name}` : 'New Category Draft',
    enabled: Boolean(eventId && !isLoading),
  });

  const handleResumeDraft = () => {
    const loaded = resumeDraft();
    if (!loaded?.payload) return;
    const p = loaded.payload;
    if (p.name !== undefined) setName(p.name);
    if (p.description !== undefined) setDescription(p.description);
    if (p.status !== undefined) setStatus(p.status);
  };

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (isLoading || !eventId) return;

    triggerAutosave({
      name,
      description,
      status,
    }, 1);
  }, [name, description, status, isLoading, eventId, triggerAutosave]);

  useEffect(() => {
    async function fetchEvent() {
      if (!eventId) return;
      try {
        const { data, error: fetchError } = await supabase
          .from('events')
          .select('id, name')
          .eq('id', eventId)
          .single();
        if (fetchError) throw fetchError;
        if (data) {
          setEvent(data as unknown as Event);
        }
      } catch (err) {
        setError('Failed to fetch parent event details.');
      } finally {
        setIsLoading(false);
      }
    }
    fetchEvent();
  }, [eventId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    
    if (!name.trim()) {
      setError('Category name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data, error: functionError } = await supabase.functions.invoke('admin-create-category', {
        body: {
          event_id: eventId,
          name: name.trim().toUpperCase(),
          description: description.trim() || null,
          status
        }
      });

      if (functionError) {
        throw functionError;
      }

      if (!data?.success || !data?.category) {
        throw new Error(data?.error?.message || 'Failed to create category');
      }

      // Contextual navigation to category details
      await discardDraft();
      navigate(`/admin/events/${eventId}/categories/${data.category.id}`);
    } catch (err: any) {
      console.error('Failed to create category:', err);
      let message = 'An error occurred while creating the category';
      if (err?.context && typeof err.context.json === 'function') {
        try {
          const body = await err.context.json();
          if (body?.error?.message) message = body.error.message;
        } catch {
          // ignore
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-xs font-semibold text-gray-500">Loading parent event...</div>;
  }

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-4">
          <Link to="/admin/events" className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Events
          </Link>
        </div>
        <ErrorState message="Parent event not found." />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="mb-4">
        <Link 
          to={`/admin/events/${eventId}`} 
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to {event.name}
        </Link>
      </div>

      <PageHeader
        title="Add New Category"
        description={`Create a theme category for grouping sub-events under ${event.name}.`}
      />

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-t-xl px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-bold tracking-wide uppercase">Category Configuration</h3>
          </div>
          <div className="flex items-center gap-3">
            <DraftSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} errorMessage={saveErrorMessage} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-white/10 text-gray-300">
              Step 2 of 3 (Category)
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-4 border border-red-200">
              <ErrorState message={error} />
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Category Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              id="name"
              required
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
              placeholder="e.g. Technical Events / Cultural Extravaganza / Gaming Arena"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Category Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
              placeholder="Describe the category's theme, target participants, or criteria..."
            />
          </div>

          <div>
            <label htmlFor="status" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Status
            </label>
            <select
              id="status"
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'ARCHIVED')}
              className="block w-full md:w-56 rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </div>

          <div className="border-t border-gray-200 pt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 w-full">
            <Link
              to={`/admin/events/${eventId}`}
              className="btn-secondary w-full sm:w-auto px-4 py-2 text-sm font-semibold text-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-liquid btn-primary-red w-full sm:w-auto px-5 py-2 text-sm font-bold shadow-sm text-center"
            >
              <span className="btn-content">
                <Save className="h-4 w-4" />
                <span>{isSubmitting ? 'Creating Category...' : 'Create Category & Proceed'}</span>
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Resume Draft Modal */}
      <ResumeDraftModal
        isOpen={hasExistingDraft}
        title={draft?.title || 'New Category Draft'}
        subtitle={event ? `Parent Event: ${event.name}` : undefined}
        lastSavedAt={lastSavedAt || draft?.updated_at}
        onResume={handleResumeDraft}
        onStartNew={startNew}
        onDelete={discardDraft}
      />
    </div>
  );
}
