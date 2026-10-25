import { useState, useEffect } from 'react';
import {
  RotateCcw,
  Clock,
  AlertTriangle,
  ShieldCheck,
  X,
  ArrowRight,
} from 'lucide-react';
import { assessmentService, type Assessment } from '@kits-eos/shared';

interface AssessmentReopenModalProps {
  isOpen: boolean;
  onClose: () => void;
  assessment: Assessment | null;
  onSuccess: (result: any) => void;
}

/**
 * Format Date to local datetime-local input string: YYYY-MM-DDTHH:mm
 */
function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function AssessmentReopenModal({
  isOpen,
  onClose,
  assessment,
  onSuccess,
}: AssessmentReopenModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [extendSchedule, setExtendSchedule] = useState(false);
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');

  // Check if current assessment's scheduled closing time has already passed
  const isWindowExpired = Boolean(
    assessment && new Date() >= new Date(assessment.end_time)
  );

  // Initialize dates whenever modal opens or assessment changes
  useEffect(() => {
    if (isOpen && assessment) {
      setError(null);
      setReason('');
      const now = new Date();
      const expired = now >= new Date(assessment.end_time);
      setExtendSchedule(expired);

      // Default start time: Keep existing start or set to now if start was past
      const originalStart = new Date(assessment.start_time);
      setNewStartTime(toLocalDatetimeString(originalStart));

      // Default new end time: 1 hour from now or existing end time if in future
      if (expired) {
        const suggestedEnd = new Date(now.getTime() + 60 * 60 * 1000);
        setNewEndTime(toLocalDatetimeString(suggestedEnd));
      } else {
        const originalEnd = new Date(assessment.end_time);
        setNewEndTime(toLocalDatetimeString(originalEnd));
      }
    }
  }, [isOpen, assessment]);

  if (!isOpen || !assessment) return null;

  const now = new Date();
  const minEndTimeString = toLocalDatetimeString(new Date(now.getTime() + 60 * 1000));

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessment) return;

    setError(null);

    // Validate schedule if window is expired or user opted to extend
    let targetStartISO: string | null = null;
    let targetEndISO: string | null = null;

    if (isWindowExpired || extendSchedule) {
      if (!newEndTime) {
        setError('Please specify a new closing date and time.');
        return;
      }

      const parsedEnd = new Date(newEndTime);
      if (isNaN(parsedEnd.getTime())) {
        setError('Invalid closing date and time format.');
        return;
      }

      if (parsedEnd <= now) {
        setError('The new closing time must be in the future.');
        return;
      }

      const parsedStart = newStartTime ? new Date(newStartTime) : new Date(assessment.start_time);
      if (parsedEnd <= parsedStart) {
        setError('Closing time must be strictly after the start time.');
        return;
      }

      targetStartISO = parsedStart.toISOString();
      targetEndISO = parsedEnd.toISOString();
    }

    setLoading(true);

    try {
      const { data, error: err } = await assessmentService.reopenAssessment(assessment.id, {
        newStartTime: targetStartISO,
        newEndTime: targetEndISO,
        reason: reason.trim() || 'Reopened by administrator',
      });

      if (err) throw err;

      if (data?.success) {
        onSuccess(data);
        onClose();
      } else {
        setError(data?.message || 'Failed to reopen assessment.');
      }
    } catch (err: any) {
      console.error('Reopen assessment failed:', err);
      setError(err.message || 'Server error occurred while reopening assessment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-5 right-5 p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3.5 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 shadow-sm">
            <RotateCcw className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900 tracking-tight">
              Reopen Assessment
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Restore assessment to active publishing status
            </p>
          </div>
        </div>

        {/* Status Transition Preview */}
        <div className="mb-5 p-3.5 bg-gray-50 border border-gray-200/90 rounded-2xl flex items-center justify-between text-xs">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Current Status
            </span>
            <div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                {assessment.status}
              </span>
            </div>
          </div>

          <div className="flex items-center px-2 text-gray-400">
            <ArrowRight className="w-4 h-4" />
          </div>

          <div className="space-y-0.5 text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Resulting Status
            </span>
            <div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                PUBLISHED
              </span>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleReopen} className="space-y-4">
          {/* Assessment Summary */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs space-y-1">
            <p className="font-bold text-gray-900">{assessment.title}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-500">
              <span>Duration: <strong>{assessment.duration_minutes} Mins</strong></span>
              <span>Questions: <strong>{assessment.total_questions_count}</strong></span>
              <span>Passing: <strong>{assessment.passing_percentage}%</strong></span>
            </div>
          </div>

          {/* Schedule Window Notice & Inputs */}
          {isWindowExpired ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
              <div className="flex items-start space-x-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 space-y-0.5">
                  <p className="font-bold">Scheduled Window Has Concluded</p>
                  <p className="text-amber-800 leading-relaxed">
                    The previous closing time was{' '}
                    <strong>{new Date(assessment.end_time).toLocaleString()}</strong>.
                    To reopen this assessment, you must configure a new future closing time. Deadlines are never silently extended.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Start Time
                  </label>
                  <input
                    type="datetime-local"
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                    New Closing Time *
                  </label>
                  <input
                    type="datetime-local"
                    min={minEndTimeString}
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-3">
              <div className="flex items-start space-x-2.5">
                <Clock className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-900 space-y-0.5">
                  <p className="font-bold">Original Schedule Window Still Active</p>
                  <p className="text-blue-800 leading-relaxed">
                    Closing time: <strong>{new Date(assessment.end_time).toLocaleString()}</strong>.
                    Reopening will immediately restore student access for the remaining window duration.
                  </p>
                </div>
              </div>

              <div className="pt-1">
                <label className="inline-flex items-center space-x-2 cursor-pointer text-xs text-gray-700 font-medium">
                  <input
                    type="checkbox"
                    checked={extendSchedule}
                    onChange={(e) => setExtendSchedule(e.target.checked)}
                    className="rounded text-kits-blue focus:ring-kits-blue"
                  />
                  <span>Optionally adjust or extend the closing window</span>
                </label>
              </div>

              {extendSchedule && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                      Start Time
                    </label>
                    <input
                      type="datetime-local"
                      value={newStartTime}
                      onChange={(e) => setNewStartTime(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                      New Closing Time *
                    </label>
                    <input
                      type="datetime-local"
                      min={minEndTimeString}
                      value={newEndTime}
                      onChange={(e) => setNewEndTime(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reason for Audit Log */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-1">
              Administrative Reason (Logged in Audit Trail)
            </label>
            <input
              type="text"
              placeholder="e.g. Host authorized re-run, schedule window extension, candidate batch"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
            />
          </div>

          {/* Data Integrity Guarantees Checklist */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/70 text-[11px] text-gray-600 space-y-1.5">
            <div className="flex items-center space-x-2 text-emerald-800 font-semibold">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Data Protection & Integrity Guarantees:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-gray-500 pl-1">
              <li>All historical student attempts, answers, and scores remain permanently saved.</li>
              <li>Existing certificates and leaderboards are protected from alteration.</li>
              <li>Students who already submitted or were terminated cannot retake (one attempt rule enforced).</li>
            </ul>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Reopening Assessment...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Confirm & Reopen Assessment</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AssessmentReopenModal;
