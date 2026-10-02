import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useScrollLock } from '@kits-eos/shared';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { 
  AlertTriangle, 
  Plus, 
  Clock, 
  CheckCircle2, 
  Send, 
  RefreshCw, 
  X, 
  LifeBuoy
} from 'lucide-react';

interface ComplaintItem {
  id: string;
  category: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'CLOSED';
  resolution: string | null;
}

const CATEGORIES = [
  { value: 'SCHEDULE', label: 'Schedule / Timing Conflict' },
  { value: 'ATTENDANCE', label: 'Attendance / Check-in Issue' },
  { value: 'CERTIFICATE', label: 'Certificate Data / Spelling Correction' },
  { value: 'PAYMENT', label: 'Payment / Fee Verification' },
  { value: 'TECHNICAL', label: 'Technical Platform / Portal Glitch' },
  { value: 'OTHER', label: 'Other Grievance / Inquiry' },
];

export function StudentComplaints() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Complaint Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('SCHEDULE');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchComplaints = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('complaints')
        .select('*')
        .eq('user_id', user.id);

      if (err) throw err;
      setComplaints((data as ComplaintItem[]) || []);
    } catch (err: any) {
      console.error('Failed to load complaints:', err);
      setError(err.message || 'Failed to load your support tickets.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();
  }, [user]);

  // Safe scroll lock and Escape key when complaint modal is open
  useScrollLock(isModalOpen);

  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !description.trim()) return;

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const { error: err } = await supabase
        .from('complaints')
        .insert({
          user_id: user.id,
          category: selectedCategory,
          description: description.trim(),
          status: 'OPEN',
        });

      if (err) throw err;

      setSuccessMessage('Your support ticket has been logged. Organizers will review and provide a resolution.');
      setIsModalOpen(false);
      setDescription('');
      await fetchComplaints();
    } catch (err: any) {
      console.error('Failed to log ticket:', err);
      setSubmitError(err.message || 'Failed to submit support ticket.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <LoadingState message="Loading your support tickets..." />;
  if (error) return <ErrorState message={error} onRetry={fetchComplaints} />;

  const openCount = complaints.filter((c) => c.status === 'OPEN').length;
  const resolvedCount = complaints.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Help & Grievance Support</h1>
          <p className="text-xs text-gray-500 mt-1">
            Log support requests, report event issues, and track official administrator resolutions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchComplaints}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            title="Refresh Tickets"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          <button
            onClick={() => { setIsModalOpen(true); setSubmitError(null); }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition shadow-2xs"
          >
            <Plus className="h-4 w-4" />
            <span>New Ticket</span>
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-600 hover:text-emerald-800">
            Dismiss
          </button>
        </div>
      )}

      {/* Ticket Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Tickets</span>
          <h3 className="text-2xl font-black text-gray-900 mt-1">{complaints.length}</h3>
          <p className="text-[11px] text-gray-500">Submitted requests</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">In Review (Open)</span>
          <h3 className="text-2xl font-black text-amber-600 mt-1">{openCount}</h3>
          <p className="text-[11px] text-amber-700">Awaiting organizer response</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Resolved</span>
          <h3 className="text-2xl font-black text-emerald-600 mt-1">{resolvedCount}</h3>
          <p className="text-[11px] text-emerald-700">Solution provided</p>
        </div>
      </div>

      {/* Tickets List */}
      {complaints.length === 0 ? (
        <EmptyState
          title="No Support Tickets Logged"
          description="Have an issue with registration, attendance, scheduling, or certificates? Submit a ticket for organizers to resolve."
          icon={<LifeBuoy className="h-8 w-8 text-gray-400" />}
          action={
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold hover:bg-red-700 transition"
            >
              <Plus className="h-4 w-4" />
              <span>Submit a Request</span>
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {complaints.map((comp) => {
            const isOpen = comp.status === 'OPEN';
            const isResolved = comp.status === 'RESOLVED';

            return (
              <div
                key={comp.id}
                className="bg-white rounded-2xl border border-gray-200 p-6 shadow-2xs space-y-4 hover:border-gray-300 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-200">
                        #{comp.id.substring(0, 8)}
                      </span>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-kits-blue px-2.5 py-0.5 rounded">
                        {comp.category}
                      </span>
                    </div>
                  </div>

                  <div>
                    {isOpen ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-300">
                        <Clock className="h-3.5 w-3.5 text-amber-600" />
                        OPEN (IN REVIEW)
                      </span>
                    ) : isResolved ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        RESOLVED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-gray-100 text-gray-700 border border-gray-300">
                        CLOSED
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Description</span>
                  <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap bg-gray-50/60 p-3.5 rounded-xl border border-gray-100">
                    {comp.description}
                  </p>
                </div>

                {comp.resolution ? (
                  <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1 text-xs">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Organizer Resolution Response
                    </span>
                    <p className="text-emerald-950 font-medium whitespace-pre-wrap mt-1">
                      {comp.resolution}
                    </p>
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-400 italic">
                    Ticket is currently queued in administrative review.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Ticket Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 space-y-5 shadow-2xl border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-kits-red" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Submit Support Ticket
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {submitError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold text-gray-700">
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 mb-1">
                  Issue Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 mb-1">
                  Description of Grievance / Inquiry <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain your issue clearly, mentioning any relevant sub-event, roll number, or token..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs text-gray-900 focus:bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting || !description.trim()}
                  className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-red-700 disabled:opacity-50 transition"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isSubmitting ? 'Submitting...' : 'Log Ticket'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
