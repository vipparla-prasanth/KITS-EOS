import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { 
  Award, 
  Search, 
  CheckCircle2, 
  XCircle, 
  ArrowLeft, 
  GraduationCap,
  Layers,
  ShieldCheck,
  User
} from 'lucide-react';

interface VerificationResult {
  is_valid: boolean;
  message?: string;
  certificate_id?: string;
  certificate_code?: string;
  type?: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'PARTICIPANT';
  status?: string;
  student_name?: string;
  roll_number?: string;
  college?: string;
  department?: string;
  year?: number;
  sub_event_name?: string;
  event_name?: string;
  issued_at?: string;
  verified_at?: string;
}

export function PublicCertificateVerification() {
  const { certId } = useParams<{ certId?: string }>();
  const [inputCertCode, setInputCertCode] = useState(certId || '');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const verifyCertificateCode = async (codeToVerify: string) => {
    const cleanQuery = codeToVerify.trim();
    if (!cleanQuery) return;

    try {
      setIsLoading(true);
      setSearched(true);
      setResult(null);

      // Call public verify_certificate RPC
      const { data, error } = await supabase.rpc('verify_certificate', {
        cert_query: cleanQuery,
      });

      if (error) throw error;
      setResult(data as VerificationResult);
    } catch (err: any) {
      console.error('Verification error:', err);
      setResult({
        is_valid: false,
        message: err.message || 'Verification service temporarily unavailable.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (certId) {
      setInputCertCode(certId);
      verifyCertificateCode(certId);
    }
  }, [certId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verifyCertificateCode(inputCertCode);
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto pb-16 font-sans page-enter">
      {/* Back Link */}
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-kits-red transition mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Home</span>
        </Link>

        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-2xs mb-1">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
            Certificate Authenticity Verification
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 max-w-md mx-auto">
            Verify official participation, winner, and runner credentials issued by KITS Akshar Institute of Technology.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSubmit} className="bg-white p-4 rounded-3xl border border-gray-200 shadow-sm space-y-3">
        <label className="block text-xs font-black uppercase tracking-wider text-gray-700">
          Enter Certificate Credential Code
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-gray-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              placeholder="e.g. KITS-EOS-CERT-4829173056"
              value={inputCertCode}
              onChange={(e) => setInputCertCode(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-mono font-bold text-gray-900 focus:bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !inputCertCode.trim()}
            className="px-6 py-3 rounded-2xl bg-kits-red text-white text-xs font-black uppercase tracking-wider shadow-2xs hover:bg-red-700 disabled:opacity-50 transition cursor-pointer shrink-0"
          >
            {isLoading ? 'Verifying...' : 'Verify'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Official format: <code className="font-mono text-gray-600">KITS-EOS-CERT-XXXXXXXXXX</code> (Printed at the footer of official certificates).
        </p>
      </form>

      {/* Verification Result Display */}
      {searched && !isLoading && (
        <div>
          {result?.is_valid ? (
            <div className="bg-white rounded-3xl border-2 border-emerald-500 p-6 sm:p-8 shadow-md space-y-5 animate-fade-in">
              {/* Official College Banner Header (Exact supplied asset) */}
              {/* Official Institutional Header */}
              <div className="w-full flex items-center justify-between pb-4 border-b border-gray-100 px-2 sm:px-4">
                <img
                  src="/kits_logo_official.jpg"
                  alt="KITS Logo"
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover shadow-sm border border-amber-400 shrink-0"
                />
                <div className="text-center px-2">
                  <h2 className="text-base sm:text-lg font-black tracking-tight text-[#003366]">
                    <span className="text-[#C8102E]">KITS</span> AKSHAR
                  </h2>
                  <p className="text-[11px] sm:text-xs font-bold text-gray-800 tracking-wider">
                    INSTITUTE OF TECHNOLOGY
                  </p>
                  <p className="text-[9px] sm:text-[10px] font-bold text-[#003366] tracking-widest uppercase">
                    AUTONOMOUS
                  </p>
                  <p className="text-[8px] sm:text-[9px] text-gray-500 font-medium">
                    Approved by AICTE, New Delhi | Affiliated to JNTUK, Kakinada
                  </p>
                </div>
                <img
                  src="/naac_a_logo.png"
                  alt="NAAC A Grade"
                  className="w-16 sm:w-20 h-auto object-contain shrink-0"
                />
              </div>

              {/* Success Badge */}
              <div className="flex items-center gap-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-black uppercase text-emerald-900 tracking-tight">
                    ✓ Certificate Verified & Authentic
                  </h3>
                  <p className="text-[11px] text-emerald-700 font-medium">
                    This credential was officially issued by KITS-EOS event operations.
                  </p>
                </div>
              </div>

              {/* Student and Event Verified Details */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-0.5">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Candidate Name</span>
                    <span className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-gray-400" />
                      {result.student_name}
                    </span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-0.5">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Roll Number</span>
                    <span className="font-mono font-bold text-gray-900 text-sm flex items-center gap-1.5">
                      <GraduationCap className="h-3.5 w-3.5 text-gray-400" />
                      {result.roll_number}
                    </span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-0.5">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Event & Track</span>
                    <span className="font-bold text-gray-900 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-gray-400" />
                      {result.sub_event_name}
                    </span>
                    <span className="text-[10px] text-gray-500 block">{result.event_name}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-0.5">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Official Recognition</span>
                    <span className="font-black text-kits-red text-sm flex items-center gap-1.5">
                      <Award className="h-3.5 w-3.5 text-kits-red" />
                      {result.type === 'WINNER'
                        ? '1ST PLACE (WINNER)'
                        : result.type === 'RUNNER'
                        ? '2ND PLACE (RUNNER-UP)'
                        : result.type === 'THIRD_PLACE'
                        ? '3RD PLACE'
                        : 'PARTICIPATION CERTIFICATE'}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-bold">Institution:</span>
                    <span className="font-bold text-gray-900">{result.college}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-bold">Department:</span>
                    <span className="font-bold text-gray-900">{result.department}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-bold">Credential Code:</span>
                    <span className="font-mono font-bold text-gray-900">{result.certificate_code}</span>
                  </div>
                </div>

                <p className="text-[11px] text-gray-400 italic text-center">
                  This is a system-generated certificate and is digitally verifiable through the KITS-EOS certificate verification system.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border-2 border-red-300 p-6 sm:p-8 shadow-sm space-y-3 text-center">
              <div className="inline-flex p-3 rounded-full bg-red-50 text-red-600 mb-1">
                <XCircle className="h-8 w-8" />
              </div>
              <h3 className="text-sm font-black uppercase text-red-900">
                Certificate Not Verified
              </h3>
              <p className="text-xs text-gray-600 max-w-sm mx-auto">
                {result?.message || 'No official certificate record matched the credential code entered. Please check the code and try again.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
