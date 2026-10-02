import React, { useState } from 'react';
import { invokeAdminEdgeFunction } from '@kits-eos/shared';
import { 
  GraduationCap, 
  X, 
  Lock, 
  User, 
  Hash, 
  Building, 
  Calendar, 
  Phone, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle, 
  Loader2 
} from 'lucide-react';

import { DEPARTMENTS, DEFAULT_COLLEGE, CollegeSelect } from '@kits-eos/shared';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultFullName?: string;
  defaultEmail?: string;
}

export function LinkStudentProfileModal({
  isOpen,
  onClose,
  onSuccess,
  defaultFullName = '',
  defaultEmail = ''
}: Props) {
  const [fullName, setFullName] = useState(defaultFullName);
  const [rollNumber, setRollNumber] = useState('');
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [otherDepartment, setOtherDepartment] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState<number>(3);
  const [phone, setPhone] = useState('');
  const [college, setCollege] = useState(DEFAULT_COLLEGE);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Client-side validations
    if (!fullName.trim()) {
      setErrorMessage('Full legal name is required.');
      return;
    }
    if (!rollNumber.trim()) {
      setErrorMessage('Student Roll Number is required.');
      return;
    }
    if (!college.trim()) {
      setErrorMessage('College / Campus name is required.');
      return;
    }
    if (department === 'OTHER' && !otherDepartment.trim()) {
      setErrorMessage('Please specify your department.');
      return;
    }
    if (!phone.trim() || phone.trim().length < 10) {
      setErrorMessage('A valid 10-digit mobile number is required.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMessage('Student Portal Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify.');
      return;
    }

    try {
      setLoading(true);

      // Invoke Edge Function with current authenticated Admin session
      const { data, error } = await invokeAdminEdgeFunction('admin-onboard-student', {
        body: {
          full_name: fullName.trim(),
          roll_number: rollNumber.trim().toUpperCase(),
          college: college.trim(),
          department: department.trim(),
          other_department: department === 'OTHER' ? otherDepartment.trim() : null,
          year_of_study: Number(yearOfStudy),
          phone: phone.trim(),
          password: password.trim(),
        }
      });

      if (error) {
        let msg = 'Failed to link student profile.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error?.message) msg = errBody.error.message;
            else if (errBody?.message) msg = errBody.message;
          } catch {
            // fallback
          }
        } else if (error instanceof Error) {
          msg = error.message;
        }
        setErrorMessage(msg);
        return;
      }

      if (!data?.success) {
        setErrorMessage(data?.message || data?.error?.message || 'Failed to link student profile.');
        return;
      }

      // Success
      setSuccessMessage('Student capability activated! You can now log into the Student Portal using your email and password.');
      setTimeout(() => {
        onSuccess();
      }, 2200);

    } catch (err: any) {
      console.error('Student linking failed:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during onboarding.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 modal-overlay-animate overflow-y-auto">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full p-4 sm:p-6 text-left shadow-2xl border border-gray-200 modal-dialog-animate my-auto max-h-[calc(100dvh-2rem)] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2.5 text-kits-blue font-black text-sm uppercase tracking-wider">
            <div className="h-8 w-8 rounded-xl bg-blue-50 text-kits-blue flex items-center justify-center border border-blue-100">
              <GraduationCap className="h-4 w-4" />
            </div>
            <span>Link Student Profile</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl transition hover:bg-gray-100 cursor-pointer disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Informational Subtext */}
        <div className="mt-3 mb-4 bg-slate-50 border border-slate-200/80 rounded-2xl p-3 text-xs text-gray-600">
          <p className="font-semibold text-gray-800">
            Institutional Account Linking
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            This will attach a verified Student identity to your existing account (<span className="font-bold text-gray-700">{defaultEmail}</span>). Your Administrator privileges and Google Sign-In remain fully intact.
          </p>
        </div>

        {/* Feedback Messages */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-kits-red font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-kits-red" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage ? (
          <div className="py-6 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto shadow-2xs">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h4 className="text-base font-black text-gray-900">Linking Completed</h4>
            <p className="text-xs font-semibold text-emerald-700 max-w-sm mx-auto leading-relaxed">
              {successMessage}
            </p>
            <p className="text-[11px] text-gray-400">Closing window...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            {/* Full Name & Roll Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Full Legal Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Prasanth V"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Roll Number
                </label>
                <div className="relative">
                  <Hash className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. 22JR1A05XX"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 uppercase focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>
              </div>
            </div>

            {/* Department & Year of Study */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Department
                </label>
                <div className="relative">
                  <Building className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue bg-white"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Year of Study
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <select
                    value={yearOfStudy}
                    onChange={(e) => setYearOfStudy(Number(e.target.value))}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue bg-white"
                  >
                    <option value={1}>1st Year</option>
                    <option value={2}>2nd Year</option>
                    <option value={3}>3rd Year</option>
                    <option value={4}>4th Year</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Other Department Field */}
            {department === 'OTHER' && (
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Specify Department
                </label>
                <input
                  type="text"
                  required
                  value={otherDepartment}
                  onChange={(e) => setOtherDepartment(e.target.value)}
                  placeholder="Enter branch name"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                />
              </div>
            )}

            {/* Mobile & College */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Mobile Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile"
                    maxLength={10}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>
              </div>

              <div>
                <CollegeSelect
                  label="College / Campus"
                  required
                  value={college}
                  onChange={setCollege}
                  size="sm"
                />
              </div>
            </div>

            {/* Student Portal Password & Confirm Password */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-gray-100">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Student Portal Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="w-full pl-9 pr-9 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse xs:grid xs:grid-cols-2 gap-2.5 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="btn-secondary w-full py-2.5 px-4 text-xs font-bold text-center"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-liquid btn-primary-blue w-full py-2.5 px-4 text-xs font-black uppercase tracking-wider shadow-2xs text-center"
              >
                <span className="btn-content">
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>Linking...</span>
                    </>
                  ) : (
                    <span>Link Profile</span>
                  )}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
