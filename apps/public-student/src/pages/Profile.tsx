import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { PrivacyRequest, PrivacyRequestType } from '@kits-eos/shared/src/types/models';
import { useAuth } from '../context/AuthContext';
import { 
  User, 
  Save, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  Phone as PhoneIcon, 
  GraduationCap,
  ShieldCheck,
  Download,
  Clock,
  Plus,
  FileText,
  ExternalLink,
  Trash2,
  AlertTriangle
} from 'lucide-react';

function validateIndianMobile(raw: string): { valid: boolean; cleaned: string; error?: string } {
  const digits = raw.replace(/\D/g, '');
  let tenDigits = digits;
  if (digits.length === 12 && digits.startsWith('91')) {
    tenDigits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    tenDigits = digits.slice(1);
  }

  if (!tenDigits) {
    return { valid: false, cleaned: '', error: 'Contact number is required.' };
  }
  if (tenDigits.length !== 10) {
    return { valid: false, cleaned: tenDigits, error: 'Mobile number must be exactly 10 digits.' };
  }
  if (!/^[6-9]/.test(tenDigits)) {
    return { valid: false, cleaned: tenDigits, error: 'Mobile number must start with 6, 7, 8, or 9.' };
  }
  return { valid: true, cleaned: tenDigits };
}

export function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [college, setCollege] = useState('');
  const [department, setDepartment] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState(3);
  const [phone, setPhone] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestType, setRequestType] = useState<PrivacyRequestType>('DATA_ACCESS');
  const [requestDescription, setRequestDescription] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestSubmitError, setRequestSubmitError] = useState<string | null>(null);
  const [requestSubmitSuccess, setRequestSubmitSuccess] = useState<string | null>(null);

  const [isExportingData, setIsExportingData] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const [isAcknowledgeModalOpen, setIsAcknowledgeModalOpen] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);

  // Account Deactivation Modal State
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [deactivatePhrase, setDeactivatePhrase] = useState('');
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const isNameLocked = Boolean(profile?.name_change_used);
  const isPrivacyAcknowledged = Boolean(profile?.privacy_acknowledged_at);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setRollNumber(profile.roll_number || '');
      setCollege(profile.college || '');
      setDepartment(profile.other_department ? `${profile.department} (${profile.other_department})` : (profile.department || ''));
      setYearOfStudy(profile.year_of_study || 3);
      setPhone(profile.phone || '');
    }
  }, [profile]);

  const loadPrivacyRequests = async () => {
    if (!user) return;
    try {
      setIsLoadingRequests(true);
      const { data, error: fetchErr } = await supabase
        .from('privacy_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;
      setPrivacyRequests((data || []) as PrivacyRequest[]);
    } catch (err) {
      console.error('Failed to load privacy requests:', err);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    loadPrivacyRequests();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setError(null);
    setSuccess(false);

    const phoneVal = validateIndianMobile(phone);
    if (!phoneVal.valid) {
      setError(phoneVal.error || 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    const updatePayload: {
      year_of_study: number;
      phone: string;
      full_name?: string;
    } = {
      year_of_study: Number(yearOfStudy),
      phone: phoneVal.cleaned,
    };

    const trimmedName = fullName.trim();
    const nameModified = !isNameLocked && trimmedName !== (profile?.full_name || '').trim();

    if (nameModified) {
      if (!trimmedName) {
        setError('Full legal name cannot be empty.');
        return;
      }
      updatePayload.full_name = trimmedName;
    }

    setIsSaving(true);

    try {
      const { error: err } = await supabase
        .from('student_profiles')
        .update(updatePayload)
        .eq('user_id', user.id);

      if (err) throw err;

      setSuccess(true);
      await refreshProfile();
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setError(err.message || 'Failed to update student profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadMyData = async () => {
    try {
      setIsExportingData(true);
      setExportError(null);
      setExportSuccess(false);

      const { data, error: exportErr } = await supabase.rpc('get_student_personal_data_export');
      if (exportErr) throw exportErr;

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to generate personal data export.');
      }

      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileRoll = profile?.roll_number || 'student';
      a.download = `kits_eos_personal_data_export_${fileRoll}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 5000);
    } catch (err: any) {
      console.error('Failed to export student personal data:', err);
      setExportError(err.message || 'Failed to generate personal data export.');
    } finally {
      setIsExportingData(false);
    }
  };

  const handleAcknowledgePrivacyNotice = async () => {
    try {
      setIsAcknowledging(true);
      setAcknowledgeError(null);

      const { data, error: ackErr } = await supabase.rpc('acknowledge_privacy_notice', {
        p_version: '1.0'
      });

      if (ackErr) throw ackErr;
      if (!data?.success) throw new Error(data?.error || 'Failed to record acknowledgement.');

      await refreshProfile();
      setIsAcknowledgeModalOpen(false);
    } catch (err: any) {
      console.error('Failed to acknowledge privacy notice:', err);
      setAcknowledgeError(err.message || 'Failed to record acknowledgement.');
    } finally {
      setIsAcknowledging(false);
    }
  };

  const handleSubmitPrivacyRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!requestDescription.trim()) {
      setRequestSubmitError('Please enter a description for your request.');
      return;
    }

    try {
      setIsSubmittingRequest(true);
      setRequestSubmitError(null);
      setRequestSubmitSuccess(null);

      const { data, error: insertErr } = await supabase
        .from('privacy_requests')
        .insert({
          user_id: user.id,
          request_type: requestType,
          description: requestDescription.trim(),
          status: 'PENDING'
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      setRequestSubmitSuccess('Your privacy request has been submitted for institutional review.');
      setRequestDescription('');
      if (data) {
        setPrivacyRequests(prev => [data as PrivacyRequest, ...prev]);
      }
      setTimeout(() => {
        setIsRequestModalOpen(false);
        setRequestSubmitSuccess(null);
      }, 2000);
    } catch (err: any) {
      console.error('Failed to submit privacy request:', err);
      setRequestSubmitError(err.message || 'Failed to submit privacy request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleDeactivateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deactivatePhrase.trim() !== 'DELETE MY ACCOUNT') {
      setDeactivateError('Please type exactly "DELETE MY ACCOUNT" to confirm.');
      return;
    }

    try {
      setIsDeactivating(true);
      setDeactivateError(null);

      const { data, error: rpcErr } = await supabase.rpc('student_deactivate_account', {
        p_confirmation_phrase: 'DELETE MY ACCOUNT',
      });

      if (rpcErr) throw rpcErr;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to deactivate account.');
      }

      await signOut();
      navigate('/login', {
        replace: true,
        state: {
          deactivatedNotice:
            'Your account has been deactivated. You have 15 days to log in and reactivate your account before permanent deletion.',
        },
      });
    } catch (err: any) {
      console.error('Account deactivation failed:', err);
      setDeactivateError(err.message || 'Failed to deactivate account.');
    } finally {
      setIsDeactivating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">
      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xs space-y-3">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center font-black text-lg border border-red-100">
            <User className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              Student Profile
            </h1>
            <p className="text-xs text-gray-500 font-medium">
              Verified institutional profile and participation identity
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xs space-y-6">
        <div className="border-b border-gray-100 pb-4">
          <h2 className="text-base font-black text-gray-900 tracking-tight">
            Academic & Contact Details
          </h2>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            Personal information stored securely and managed under institutional data governance.
          </p>
        </div>

        {success && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>Student profile changes saved successfully.</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 text-xs font-semibold text-gray-700">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600">
                Full Legal Name <span className="text-red-500">*</span>
              </label>
              {isNameLocked ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
                  <Lock className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                  <span>Verified / Locked</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                  One-time change available
                </span>
              )}
            </div>
            {isNameLocked ? (
              <input type="text" readOnly value={fullName} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 font-semibold rounded-xl text-sm cursor-not-allowed select-none focus:outline-none" />
            ) : (
              <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition" />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600">
                  Roll Number
                </label>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400">
                  <Lock className="w-2.5 h-2.5" />
                  <span>Locked</span>
                </span>
              </div>
              <input type="text" readOnly value={rollNumber} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 font-mono font-semibold rounded-xl text-sm cursor-not-allowed select-none focus:outline-none" />
              <p className="text-[11px] text-gray-400 mt-1 font-normal">Permanently assigned student identity.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600">
                  Year of Study <span className="text-red-500">*</span>
                </label>
                <GraduationCap className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <select
                value={yearOfStudy}
                onChange={(e) => setYearOfStudy(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition bg-white"
              >
                <option value={1}>1st Year</option>
                <option value={2}>2nd Year</option>
                <option value={3}>3rd Year</option>
                <option value={4}>4th Year</option>
              </select>
              <p className="text-[11px] text-gray-500 mt-1 font-normal">Academic standing for eligibility criteria.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600">
                  Department
                </label>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400">
                  <Lock className="w-2.5 h-2.5" />
                  <span>Locked</span>
                </span>
              </div>
              <input type="text" readOnly value={department} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 font-semibold rounded-xl text-sm cursor-not-allowed select-none focus:outline-none" />
              <p className="text-[11px] text-gray-400 mt-1 font-normal">Assigned academic branch.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600">
                  College / Institution
                </label>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400">
                  <Lock className="w-2.5 h-2.5" />
                  <span>Locked</span>
                </span>
              </div>
              <input type="text" readOnly value={college} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 font-semibold rounded-xl text-sm cursor-not-allowed select-none focus:outline-none" />
              <p className="text-[11px] text-gray-400 mt-1 font-normal">Verified host institution.</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600">
                Contact Number <span className="text-red-500">*</span>
              </label>
              <PhoneIcon className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={15}
              placeholder="e.g. 9876543210"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 font-mono focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
            />
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-kits-red text-white text-xs font-bold hover:bg-red-700 transition disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{isSaving ? 'Saving Changes...' : 'Save Profile Changes'}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-blue-50 text-kits-blue flex items-center justify-center font-black border border-blue-100">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 tracking-tight">
                Privacy & Data Governance
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Personal data rights, transparency notices, and export controls.
              </p>
            </div>
          </div>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-kits-blue hover:underline">
            <span>View Privacy Notice</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-gray-900">
                  Privacy Notice Version: {profile?.privacy_notice_version || '1.0'}
                </span>
                {isPrivacyAcknowledged ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    <span>Acknowledged</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">
                    <Clock className="h-3 w-3 text-amber-600" />
                    <span>Pending Acknowledgement</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                {isPrivacyAcknowledged && profile?.privacy_acknowledged_at
                  ? `Acknowledged on ${new Date(profile.privacy_acknowledged_at).toLocaleDateString('en-IN')}`
                  : 'Please review and explicitly acknowledge the KITS-EOS Privacy Notice.'}
              </p>
            </div>
            {!isPrivacyAcknowledged && (
              <button type="button" onClick={() => setIsAcknowledgeModalOpen(true)} className="px-4 py-2 rounded-xl bg-kits-blue text-white text-xs font-bold hover:bg-blue-800 transition">
                Acknowledge Notice v1.0
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-3 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-gray-900 font-bold text-xs">
                <Download className="h-4 w-4 text-kits-blue" />
                <span>Download My Data (Portability)</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">Download a machine-readable JSON archive of all personal data.</p>
            </div>
            {exportSuccess && (
              <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[10.5px] text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>Personal data archive exported!</span>
              </div>
            )}
            {exportError && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-[10.5px] text-red-700 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                <span>{exportError}</span>
              </div>
            )}
            <button type="button" disabled={isExportingData} onClick={handleDownloadMyData} className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50">
              <Download className="h-3.5 w-3.5" />
              <span>{isExportingData ? 'Generating Archive...' : 'Download My Data (JSON)'}</span>
            </button>
          </div>

          <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-3 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-gray-900 font-bold text-xs">
                <FileText className="h-4 w-4 text-kits-red" />
                <span>Privacy & Data Requests</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">Submit an institutional request to correct fields or inquire regarding privacy.</p>
            </div>
            <button type="button" onClick={() => setIsRequestModalOpen(true)} className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-black transition">
              <Plus className="h-3.5 w-3.5" />
              <span>Submit Privacy Request</span>
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-700">My Submitted Privacy Requests</h3>
          {isLoadingRequests ? (
            <div className="p-6 text-center text-xs text-gray-400">Loading requests...</div>
          ) : privacyRequests.length === 0 ? (
            <div className="p-6 text-center rounded-2xl border border-dashed border-gray-200 text-xs text-gray-400">No requests submitted.</div>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-2xl overflow-hidden bg-white">
              {privacyRequests.map((req) => (
                <div key={req.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-gray-100 text-gray-800">{req.request_type.replace('_', ' ')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${req.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{req.status}</span>
                  </div>
                  <p className="text-xs text-gray-700">{req.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone: Account Deactivation */}
      <div className="bg-red-50/60 rounded-3xl border border-red-200 p-6 sm:p-8 shadow-2xs space-y-4">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-red-100 text-kits-red flex items-center justify-center font-black text-lg border border-red-200">
            <Trash2 className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight">
              Danger Zone: Account Deactivation
            </h2>
            <p className="text-xs text-gray-600 font-medium">
              15-day recoverable deactivation followed by automated personal data cleanup
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-red-100 space-y-2 text-xs text-gray-600 leading-relaxed">
          <p>
            Deactivating your account will immediately end your session and schedule your account for permanent deletion after a <strong>15-day recovery period</strong>.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[11px] text-gray-500">
            <li>Within 15 days: You may sign in with your email at any time to reactivate your account.</li>
            <li>After 15 days: Your profile data and login credentials will be permanently erased.</li>
            <li>Institutional records (event registrations, team history, attendance, and certificates) are preserved for official compliance.</li>
          </ul>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => {
              setIsDeactivateModalOpen(true);
              setDeactivatePhrase('');
              setDeactivateError(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
            <span>Deactivate Account</span>
          </button>
        </div>
      </div>

      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-black text-gray-900">Submit Privacy Request</h3>
            {requestSubmitSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{requestSubmitSuccess}</span>
              </div>
            )}
            {requestSubmitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{requestSubmitError}</span>
              </div>
            )}
            <form onSubmit={handleSubmitPrivacyRequest} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Request Type</label>
                <select value={requestType} onChange={(e) => setRequestType(e.target.value as PrivacyRequestType)} className="w-full px-3 py-2 border rounded-xl text-xs">
                  <option value="DATA_CORRECTION">Data Correction (Roll No, Dept, Name)</option>
                  <option value="DATA_ACCESS">Data Access Inquiry</option>
                  <option value="DATA_DELETION">Data Deletion / Erasure Evaluation</option>
                  <option value="OTHER">Other Privacy Inquiry</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Description & Details</label>
                <textarea rows={4} value={requestDescription} onChange={(e) => setRequestDescription(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" placeholder="Please provide specific details regarding your privacy request..." />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setIsRequestModalOpen(false); setRequestSubmitError(null); }} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">Cancel</button>
                <button type="submit" disabled={isSubmittingRequest} className="px-4 py-2 bg-kits-blue text-white rounded-xl text-xs font-bold hover:bg-blue-800 transition disabled:opacity-50">
                  {isSubmittingRequest ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAcknowledgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-black text-gray-900">Acknowledge Privacy Notice (v1.0)</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              I have read the KITS-EOS Privacy Notice (Version 1.0) and understand how my personal data (academic profile, registrations, payment records, attendance, and certificates) will be processed for event participation and institutional operations under the Digital Personal Data Protection Act, 2023.
            </p>
            {acknowledgeError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{acknowledgeError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setIsAcknowledgeModalOpen(false); setAcknowledgeError(null); }} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">Close</button>
              <button type="button" onClick={handleAcknowledgePrivacyNotice} disabled={isAcknowledging} className="px-4 py-2 bg-kits-blue text-white rounded-xl text-xs font-bold hover:bg-blue-800 transition disabled:opacity-50">
                {isAcknowledging ? 'Recording...' : 'I Acknowledge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Account Deactivation Modal */}
      {isDeactivateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-red-200">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">Confirm Account Deactivation</h3>
                <p className="text-xs text-gray-500">This action will begin the 15-day recovery period</p>
              </div>
            </div>

            <div className="p-3.5 bg-red-50/70 rounded-2xl border border-red-100 text-xs text-red-800 space-y-2 leading-relaxed">
              <p className="font-bold">Important Notice:</p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-red-700">
                <li>You will be signed out immediately.</li>
                <li>You will have <strong>15 days</strong> to log in and cancel this deactivation.</li>
                <li>After 15 days, your personal profile and login will be permanently deleted.</li>
              </ul>
            </div>

            {deactivateError && (
              <div className="p-3 bg-red-100 border border-red-200 rounded-xl text-xs text-red-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{deactivateError}</span>
              </div>
            )}

            <form onSubmit={handleDeactivateAccount} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  Type <span className="font-mono font-black text-red-600 select-all">DELETE MY ACCOUNT</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deactivatePhrase}
                  onChange={(e) => setDeactivatePhrase(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeactivating}
                  onClick={() => {
                    setIsDeactivateModalOpen(false);
                    setDeactivatePhrase('');
                    setDeactivateError(null);
                  }}
                  className="px-4 py-2.5 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeactivating || deactivatePhrase.trim() !== 'DELETE MY ACCOUNT'}
                  className="px-4 py-2.5 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{isDeactivating ? 'Deactivating...' : 'Confirm Deactivation'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
