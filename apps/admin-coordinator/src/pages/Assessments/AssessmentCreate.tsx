import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Award,
  AlertCircle,
  Trophy,
  Layers,
  UserCheck,
  Sparkles,
} from 'lucide-react';
import { assessmentService, supabase, extractErrorMessage } from '@kits-eos/shared';

export function AssessmentCreate() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State with sensible defaults
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState(
    '1. Ensure you have a stable internet connection before beginning.\n' +
    '2. You have a fixed duration to complete all questions.\n' +
    '3. Tab-switching is monitored. 3 strikes will immediately terminate the exam.\n' +
    '4. Answers are autosaved automatically upon selection.'
  );
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [passingPercentage, setPassingPercentage] = useState(40);
  const [includeInGlobalLeaderboard, setIncludeInGlobalLeaderboard] = useState(false);
  const [randomizeQuestions, setRandomizeQuestions] = useState(false);
  const [randomizeOptions, setRandomizeOptions] = useState(false);
  const [eventId, setEventId] = useState<string>('');
  const [subEventId, setSubEventId] = useState<string>('');
  const [eventsList, setEventsList] = useState<Array<{ id: string; name: string }>>([]);
  const [subEventsList, setSubEventsList] = useState<Array<{ id: string; name: string; event_id: string }>>([]);

  // Dedicated Assessment Coordinator State (Item 2)
  const [assignCoordinatorNow, setAssignCoordinatorNow] = useState(true);
  const [coordName, setCoordName] = useState('');
  const [coordUsername, setCoordUsername] = useState('');
  const [coordPassword, setCoordPassword] = useState('');
  const [coordPhone, setCoordPhone] = useState('');

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCoordPassword(pwd);
  };

  useEffect(() => {
    supabase.from('events').select('id, name').order('name').then(({ data }) => {
      if (data) setEventsList(data);
    });
    supabase.from('sub_events').select('id, name, event_id').order('name').then(({ data }) => {
      if (data) setSubEventsList(data);
    });
  }, []);

  // Default start = now + 1 hour, end = now + 25 hours
  const now = new Date();
  const defaultStart = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const defaultEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 16);

  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Hardened client validation
    if (!title.trim()) {
      setError('Assessment title is required.');
      return;
    }

    if (durationMinutes < 1) {
      setError('Duration must be at least 1 minute.');
      return;
    }

    if (passingPercentage < 0 || passingPercentage > 100) {
      setError('Passing percentage must be between 0 and 100.');
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setError('Please provide valid start and end dates.');
      return;
    }

    if (end <= start) {
      setError('Closing end time must be strictly after the start time.');
      return;
    }

    const isStandalone = !eventId && !subEventId;
    if (isStandalone && assignCoordinatorNow && coordUsername.trim()) {
      if (!coordName.trim()) {
        setError('Coordinator display name is required.');
        return;
      }
      if (coordUsername.trim().length < 3) {
        setError('Coordinator username must be at least 3 characters.');
        return;
      }
      if (coordPassword.trim().length < 6) {
        setError('Coordinator password must be at least 6 characters.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const { data, error: err } = await assessmentService.createAssessment({
        title: title.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        duration_minutes: durationMinutes,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        passing_percentage: passingPercentage,
        include_in_global_leaderboard: includeInGlobalLeaderboard,
        randomize_questions: randomizeQuestions,
        randomize_options: randomizeOptions,
        event_id: eventId || null,
        sub_event_id: subEventId || null,
      });

      if (err) throw err;
      if (data?.id) {
        if (isStandalone && assignCoordinatorNow && coordUsername.trim()) {
          const { error: coordErr } = await assessmentService.assignCoordinator(data.id, {
            name: coordName.trim(),
            username: coordUsername.trim(),
            password: coordPassword.trim(),
            phone: coordPhone.trim() || undefined,
          });
          if (coordErr) {
            console.error('Coordinator assignment warning:', coordErr);
            const coordErrorMsg = extractErrorMessage(coordErr, 'Coordinator could not be assigned.');
            navigate(`/admin/assessments/${data.id}?coordError=${encodeURIComponent(coordErrorMsg)}&tab=COORDINATOR`);
            return;
          }
        }
        navigate(`/admin/assessments/${data.id}`);
      } else {
        navigate('/admin/assessments');
      }
    } catch (err: any) {
      console.error('Failed to create assessment:', err);
      setError(extractErrorMessage(err, 'Failed to create assessment. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Breadcrumb Header */}
      <div className="flex items-center space-x-4">
        <Link
          to="/admin/assessments"
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Create New Assessment</h1>
          <p className="text-xs text-gray-500">
            Define exam schedule, instructions, and duration before authoring questions.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Configuration Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
            Assessment Title <span className="text-kits-red">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g., Computer Science Technical Assessment 2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
            Short Description
          </label>
          <textarea
            rows={2}
            placeholder="Brief overview of subjects covered and purpose..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
          />
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
            Candidate Instructions & Proctoring Notice
          </label>
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full px-4 py-2 text-sm font-mono bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition text-xs"
          />
        </div>

        {/* Grid: Schedule & Duration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-gray-100">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
              Opening Start Time <span className="text-kits-red">*</span>
            </label>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
              Closing End Time <span className="text-kits-red">*</span>
            </label>
            <input
              type="datetime-local"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
              <Clock className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
              Exam Duration (Minutes) <span className="text-kits-red">*</span>
            </label>
            <input
              type="number"
              min={1}
              max={600}
              required
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
            />
            <p className="text-xs text-gray-400 mt-1">
              Authoritative server timer allocated per candidate.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
              <Award className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
              Passing Percentage (%) <span className="text-kits-red">*</span>
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              required
              value={passingPercentage}
              onChange={(e) => setPassingPercentage(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
            />
            <p className="text-xs text-gray-400 mt-1">
              Minimum score percentage required to pass.
            </p>
          </div>
        </div>

        {/* Event & Sub-Event Linkage (Item 2) */}
        <div className="pt-4 border-t border-gray-100 space-y-4">
          <div className="flex items-center space-x-2 text-xs font-bold text-gray-700 uppercase tracking-wider">
            <Layers className="w-4 h-4 text-kits-red" />
            <span>Event & Sub-Event Affiliation (Optional)</span>
          </div>
          <p className="text-xs text-gray-500">
            Link this assessment to a specific event/sub-event for coordinator access control, or leave unlinked as a campus-wide standalone assessment.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
                Main Event
              </label>
              <select
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setSubEventId('');
                }}
                className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
              >
                <option value="">Standalone (Campus-wide / No Event)</option>
                {eventsList.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
                Sub-Event / Round
              </label>
              <select
                value={subEventId}
                onChange={(e) => setSubEventId(e.target.value)}
                disabled={!eventId}
                className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition disabled:opacity-50"
              >
                <option value="">No specific sub-event</option>
                {subEventsList
                  .filter((se) => se.event_id === eventId)
                  .map((se) => (
                    <option key={se.id} value={se.id}>
                      {se.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>

        {/* Dedicated Assessment Coordinator Assignment (Item 2) */}
        {!eventId && !subEventId && (
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-bold text-gray-700 uppercase tracking-wider">
                <UserCheck className="w-4 h-4 text-kits-blue" />
                <span>Dedicated Assessment Coordinator (Required for Standalone Publication)</span>
              </div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignCoordinatorNow}
                  onChange={(e) => setAssignCoordinatorNow(e.target.checked)}
                  className="rounded text-kits-red focus:ring-kits-red"
                />
                <span className="text-xs text-gray-600 font-medium">Assign now</span>
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Standalone assessments require exactly one assigned coordinator before publication. Coordinators host and monitor the examination in realtime.
            </p>

            {assignCoordinatorNow && (
              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
                      Coordinator Display Name <span className="text-kits-red">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. Ramesh Kumar"
                      value={coordName}
                      onChange={(e) => setCoordName(e.target.value)}
                      className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
                      Unique Coordinator Username <span className="text-kits-red">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. coord_physics_2026"
                      value={coordUsername}
                      onChange={(e) => setCoordUsername(e.target.value)}
                      className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue transition"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-600">
                        Password Setup <span className="text-kits-red">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={generateRandomPassword}
                        className="text-[11px] font-bold text-kits-blue hover:underline flex items-center space-x-1"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Generate Random</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Minimum 6 characters"
                      value={coordPassword}
                      onChange={(e) => setCoordPassword(e.target.value)}
                      className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue transition font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
                      Phone Number (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91 9876543210"
                      value={coordPhone}
                      onChange={(e) => setCoordPhone(e.target.value)}
                      className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue transition"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Randomization & Shuffling Controls (Item 3) */}
        <div className="pt-4 border-t border-gray-100 space-y-4">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={randomizeQuestions}
              onChange={(e) => setRandomizeQuestions(e.target.checked)}
              className="mt-1 h-4 w-4 text-kits-red rounded border-gray-300 focus:ring-kits-red/20"
            />
            <div>
              <span className="text-sm font-bold text-gray-800">
                Randomize Question Order
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Each candidate will receive questions in an independently shuffled, deterministic sequence that stays stable across reconnects.
              </p>
            </div>
          </label>

          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={randomizeOptions}
              onChange={(e) => setRandomizeOptions(e.target.checked)}
              className="mt-1 h-4 w-4 text-kits-red rounded border-gray-300 focus:ring-kits-red/20"
            />
            <div>
              <span className="text-sm font-bold text-gray-800">
                Randomize Option Choices (MCQ)
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Options A, B, C, D are independently shuffled for each candidate while preserving authoritative answer key mapping.
              </p>
            </div>
          </label>
        </div>

        {/* Global Leaderboard Checkbox */}
        <div className="pt-2 border-t border-gray-100">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInGlobalLeaderboard}
              onChange={(e) => setIncludeInGlobalLeaderboard(e.target.checked)}
              className="mt-1 h-4 w-4 text-kits-red rounded border-gray-300 focus:ring-kits-red/20"
            />
            <div>
              <span className="text-sm font-bold text-gray-800 flex items-center">
                <Trophy className="w-4 h-4 text-purple-600 mr-1.5" />
                Include Scores in KITS-EOS Global Assessment Leaderboard
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                When enabled, completed candidate scores for this exam will be aggregated into the campus-wide global assessment rankings.
              </p>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end items-center space-x-3 pt-6 border-t border-gray-100">
          <Link
            to="/admin/assessments"
            className="px-4 py-2.5 text-sm font-semibold text-gray-600 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center px-6 py-2.5 bg-kits-red text-white text-sm font-semibold rounded-xl hover:bg-kits-red/90 transition shadow-sm disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Creating Draft...
              </>
            ) : (
              'Save & Proceed to Questions'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
export default AssessmentCreate;
