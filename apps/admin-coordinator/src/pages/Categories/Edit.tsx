import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useFormDraft, DraftSaveIndicator, ResumeDraftModal } from '@kits-eos/shared';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ArrowLeft, Save, FolderPlus, AlertTriangle } from 'lucide-react';
import type { Event } from '@kits-eos/shared/src/types/models';

export function EditCategory() {
  const { eventId, categoryId } = useParams<{ eventId: string; categoryId: string }>();
  const navigate = useNavigate();
  
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [event, setEvent] = useState<Event | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
    draftType: 'ADMIN_CATEGORY_EDIT',
    entityId: categoryId || null,
    title: name ? `Edit Category: ${name}` : 'Edit Category Draft',
    enabled: Boolean(categoryId && !isLoading && !fetchError),
  });

  const handleResumeDraft = () => {
    const loaded = resumeDraft();
    if (!loaded?.payload) return;

    if (status === 'ARCHIVED') {
      setStaleDraftNotice('This category is ARCHIVED. Applying old draft changes is restricted. You may delete this stale draft.');
      return;
    }

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
    if (isLoading || fetchError || !categoryId) return;

    triggerAutosave({
      name,
      description,
      status,
    }, 1);
  }, [name, description, status, isLoading, fetchError, categoryId, triggerAutosave]);

  useEffect(() => {
    async function fetchData() {
      if (!eventId || !categoryId) return;
      try {
        setIsLoading(true);
        setFetchError(null);
        
        const [eventRes, catRes] = await Promise.all([
          supabase.from('events').select('id, name').eq('id', eventId).single(),
          supabase.from('categories').select('*').eq('id', categoryId).single()
        ]);

        if (eventRes.error) throw eventRes.error;
        if (catRes.error) throw catRes.error;

        setEvent(eventRes.data as unknown as Event);
        setName(catRes.data.name);
        setDescription(catRes.data.description || '');
        setStatus(catRes.data.status as 'ACTIVE' | 'ARCHIVED');
      } catch (err) {
        console.error('Failed to fetch category details:', err);
        setFetchError('An error occurred while loading category details.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [eventId, categoryId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) return;
    
    if (!name.trim()) {
      setSubmitError('Category name is required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const { data, error: functionError } = await supabase.functions.invoke('admin-update-category', {
        body: {
          category_id: categoryId,
          name: name.trim().toUpperCase(),
          description: description.trim() || null,
          status
        }
      });

      if (functionError) throw functionError;
      if (!data?.success) throw new Error(data?.error?.message || 'Failed to update category');

      await discardDraft();
      navigate(`/admin/events/${eventId}/categories/${categoryId}`);
    } catch (err: any) {
      console.error('Category update failed:', err);
      let message = 'Failed to update category';
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
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading category..." />;
  }

  if (fetchError || !event) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-4">
          <Link to={`/admin/events/${eventId}`} className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Event
          </Link>
        </div>
        <ErrorState message={fetchError || 'Category not found.'} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="mb-4">
        <Link 
          to={`/admin/events/${eventId}/categories/${categoryId}`} 
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Category Details
        </Link>
      </div>

      <PageHeader
        title={`Edit Category: ${name}`}
        description={`Update category info under ${event.name}.`}
      />

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-t-xl px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-bold tracking-wide uppercase">Edit Category</h3>
          </div>
          <div className="flex items-center gap-3">
            <DraftSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} errorMessage={saveErrorMessage} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-white/10 text-gray-300">
              Parent: {event.name}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
              to={`/admin/events/${eventId}/categories/${categoryId}`}
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
                <span>{isSubmitting ? 'Saving...' : 'Save Changes'}</span>
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Resume Draft Modal */}
      <ResumeDraftModal
        isOpen={hasExistingDraft}
        title={draft?.title || 'Edit Category Draft'}
        subtitle={`Category: ${name || categoryId}`}
        lastSavedAt={lastSavedAt || draft?.updated_at}
        onResume={handleResumeDraft}
        onStartNew={startNew}
        onDelete={discardDraft}
      />
    </div>
  );
}
