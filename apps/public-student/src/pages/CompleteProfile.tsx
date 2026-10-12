import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  UserCheck, 
  AlertCircle, 
  ShieldCheck, 
  CheckCircle2, 
  LogOut,
  Mail,
  Loader2
} from 'lucide-react';
import { DEPARTMENTS, DEFAULT_COLLEGE, CollegeSelect } from '@kits-eos/shared';

export function CompleteProfile() {
  const { user, profile, completeProfile, signOut, isLoading, isAuthTransitioning } = useAuth();
  const navigate = useNavigate();

  // Form Fields
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');
  const [rollNumber, setRollNumber] = useState('');
  const [college, setCollege] = useState(DEFAULT_COLLEGE);
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [otherDepartment, setOtherDepartment] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState<number>(3);
  const [phone, setPhone] = useState('');
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isLoading || isAuthTransitioning) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kits-red"></div>
      </div>
    );
  }

  // If unauthenticated, redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // If profile is already complete, redirect to dashboard
  if (profile) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim() || !rollNumber.trim() || !phone.trim()) {
      setErrorMessage('Please fill in all required student profile details.');
      return;
    }

    if (!college.trim()) {
      setErrorMessage('Please select or enter your college / institution name.');
      return;
    }

    if (department === 'OTHER' && !otherDepartment.trim()) {
      setErrorMessage('Please specify your other department name.');
      return;
    }

    if (phone.trim().length < 10) {
      setErrorMessage('A valid 10-digit mobile number is required.');
      return;
    }

    if (!privacyAcknowledged) {
      setErrorMessage('Please read and acknowledge the Privacy Notice to continue.');
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await completeProfile({
        full_name: fullName.trim(),
        roll_number: rollNumber.trim().toUpperCase(),
        college: college.trim(),
        department: department.trim(),
        other_department: department === 'OTHER' ? otherDepartment.trim() : null,
        year_of_study: Number(yearOfStudy),
        phone: phone.trim(),
        privacy_acknowledged: true,
        privacy_notice_version: '1.0',
      });

      if (!result.success) {
        if (result.code === 'DUPLICATE_ROLL_NUMBER') {
          setErrorMessage(
            result.message || `An account with Roll Number "${rollNumber.trim().toUpperCase()}" already exists. Please verify your roll number.`
          );
        } else {
          setErrorMessage(result.error?.message || result.message || 'Failed to complete profile.');
        }
        return;
      }

      // Profile complete! Route to dashboard
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      console.error('Complete profile error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred while saving your profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="w-full min-h-[80vh] flex items-center justify-center py-6 sm:py-12 px-4 selection:bg-red-200 page-enter">
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-[#002855] to-[#003366] text-white p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/30">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>Account Onboarding Incomplete</span>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-200 transition cursor-pointer"
              title="Sign in with a different account"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-4 flex items-center gap-2">
            <UserCheck className="h-7 w-7 text-amber-400" />
            Complete Your Student Profile
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
            Your login account is verified. To participate in KITS-EOS flagship competitions, generate digital ID cards, and access your student console, please complete your official academic details.
          </p>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs font-mono text-slate-300">
            <Mail className="h-3.5 w-3.5 text-blue-300 shrink-0" />
            <span className="text-slate-400">Authenticated Email:</span>
            <span className="font-bold text-white bg-white/10 px-2 py-0.5 rounded border border-white/10">
              {user.email}
            </span>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8 space-y-5">
          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 flex items-start gap-3 shadow-2xs">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-kits-red" />
              <div>
                <span className="font-bold block mb-0.5">Profile Validation Notice</span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4 text-xs font-semibold text-gray-700">
            <div>
              <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                Full Legal Name <span className="text-red-500">*</span>
              </label>
              <p className="text-[10px] text-gray-400 mb-1 font-normal leading-tight">
                Enter your full name exactly as you want it to appear on your event certificates.
              </p>
              <input
                type="text"
                required
                placeholder="e.g. John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                  Roll Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 24JK1A1201"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs font-mono uppercase text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                />
              </div>

              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                  Year of Study <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={yearOfStudy}
                  onChange={(e) => setYearOfStudy(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
                >
                  <option value={1}>1st Year</option>
                  <option value={2}>2nd Year</option>
                  <option value={3}>3rd Year</option>
                  <option value={4}>4th Year</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                Department / Branch <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
              >
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            {department === 'OTHER' && (
              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                  Specify Department Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter your department name"
                  value={otherDepartment}
                  onChange={(e) => setOtherDepartment(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                />
              </div>
            )}

            <div>
              <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                College / Institution <span className="text-red-500">*</span>
              </label>
              <CollegeSelect
                value={college}
                onChange={setCollege}
                className="w-full text-xs"
              />
            </div>

            <div>
              <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                Mobile Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs font-mono text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
              />
            </div>

            {/* Privacy Notice Box */}
            <div className="p-3.5 bg-blue-50/60 rounded-2xl border border-blue-200/80 space-y-2">
              <div className="flex items-center gap-1.5 text-blue-900 font-bold text-[11px]">
                <ShieldCheck className="h-4 w-4 text-kits-blue shrink-0" />
                <span>Privacy & Data Protection Notice</span>
              </div>
              <p className="text-[10px] text-gray-600 leading-relaxed font-normal">
                KITS-EOS collects your academic information to manage event participation, issue verified credentials, and maintain institutional records in compliance with DPDP governance.
              </p>
              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={privacyAcknowledged}
                  onChange={(e) => setPrivacyAcknowledged(e.target.checked)}
                  className="mt-0.5 rounded text-kits-blue focus:ring-kits-blue border-gray-300 h-3.5 w-3.5"
                />
                <span className="text-[10px] text-gray-700 font-medium">
                  I understand and agree to the institutional data processing terms.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-lg shadow-red-900/20 flex items-center justify-center gap-2 cursor-pointer mt-4"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving Profile...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Complete Profile & Enter Student Portal</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
