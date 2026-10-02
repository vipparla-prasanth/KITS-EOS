import { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { 
  Award, 
  Trophy, 
  Medal, 
  Search, 
  CheckCircle2, 
  Lock
} from 'lucide-react';
import type { Certificate } from '@kits-eos/shared/src/types/models';

export function CertificatesList() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  useEffect(() => {
    async function fetchCertificates() {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchErr } = await supabase
          .from('certificates')
          .select(`
            id,
            team_member_id,
            sub_event_id,
            type,
            status,
            student_corrections_used,
            storage_path,
            team_members (
              id,
              snapshot_name,
              snapshot_roll_number,
              snapshot_college,
              snapshot_department,
              snapshot_year,
              is_leader
            ),
            sub_events (
              id,
              name,
              events (
                id,
                name
              ),
              categories (
                id,
                name
              )
            )
          `)
          .order('id', { ascending: false });

        if (fetchErr) throw fetchErr;
        setCertificates((data as unknown as Certificate[]) || []);
      } catch (err: any) {
        console.error('Failed to load certificates:', err);
        setError('Failed to load certificates directory.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchCertificates();
  }, []);

  const filteredCertificates = certificates.filter((cert) => {
    const tm = cert.team_members;
    const sub = cert.sub_events;
    const q = searchTerm.toLowerCase();

    const matchesSearch = !q || 
      tm?.snapshot_name?.toLowerCase().includes(q) ||
      tm?.snapshot_roll_number?.toLowerCase().includes(q) ||
      tm?.snapshot_college?.toLowerCase().includes(q) ||
      sub?.name?.toLowerCase().includes(q);

    const matchesType = typeFilter === 'ALL' || cert.type === typeFilter;
    const matchesStatus = statusFilter === 'ALL' || cert.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const totalCerts = certificates.length;
  const winnersCount = certificates.filter(c => c.type === 'WINNER').length;
  const runnersCount = certificates.filter(c => c.type === 'RUNNER').length;
  const participantsCount = certificates.filter(c => c.type === 'PARTICIPANT').length;

  if (isLoading) {
    return <LoadingState message="Loading Certificate Directory..." />;
  }

  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        title="Certificate Management & Credentials"
        description="Individual member credentials, verified achievements, and tamper-evident certificates."
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Issued</span>
          <p className="text-2xl font-black text-gray-900 mt-1">{totalCerts}</p>
          <span className="text-[11px] text-gray-500 font-medium">All Achievements</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Winner Certificates</span>
          <p className="text-2xl font-black text-amber-600 mt-1">{winnersCount}</p>
          <span className="text-[11px] text-amber-700 font-medium">1st Place Podium</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">Runner-up</span>
          <p className="text-2xl font-black text-slate-800 mt-1">{runnersCount}</p>
          <span className="text-[11px] text-slate-600 font-medium">2nd Place Podium</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-kits-blue">Participation</span>
          <p className="text-2xl font-black text-kits-blue mt-1">{participantsCount}</p>
          <span className="text-[11px] text-gray-500 font-medium">Attended Members</span>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search recipient, roll no, college, sub-event..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg px-3 py-2"
            >
              <option value="ALL">All Award Types</option>
              <option value="WINNER">Winner (1st)</option>
              <option value="RUNNER">Runner-up (2nd)</option>
              <option value="PARTICIPANT">Participation</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg px-3 py-2"
            >
              <option value="ALL">All Statuses</option>
              <option value="UNLOCKED">Unlocked</option>
              <option value="LOCKED">Locked</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <ErrorState message={error} />
          </div>
        )}

        {filteredCertificates.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-400">
            No certificates found matching the search criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Recipient</th>
                  <th className="py-3 px-4">College & Dept</th>
                  <th className="py-3 px-4">Sub-event & Event</th>
                  <th className="py-3 px-4">Award Level</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCertificates.map((cert) => {
                  const tm = cert.team_members;
                  const sub = cert.sub_events;
                  const ev = sub?.events || (sub?.categories as any)?.events;

                  return (
                    <tr key={cert.id} className="hover:bg-gray-50/60 transition">
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <p className="font-bold text-gray-900">{tm?.snapshot_name || 'Student'}</p>
                          <p className="text-[11px] font-mono text-gray-500">{tm?.snapshot_roll_number}</p>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-gray-800">{tm?.snapshot_college || 'KITS'}</p>
                          <p className="text-[11px] text-gray-500">{tm?.snapshot_department} • Year {tm?.snapshot_year}</p>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <p className="font-bold text-gray-900">{sub?.name}</p>
                          <p className="text-[11px] text-gray-500">{ev?.name || 'Main Event'}</p>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {cert.type === 'WINNER' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                            <Trophy className="h-3 w-3 text-amber-700" /> Winner (1st)
                          </span>
                        ) : cert.type === 'RUNNER' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-slate-200 text-slate-900 border border-slate-400">
                            <Medal className="h-3 w-3 text-slate-700" /> Runner-up (2nd)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-kits-blue border border-blue-200">
                            <Award className="h-3 w-3" /> Participation
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {cert.status === 'UNLOCKED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" /> Unlocked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600 border border-gray-200">
                            <Lock className="h-3 w-3" /> Locked
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <span className="text-[11px] font-mono text-gray-400">
                          ID: {cert.id.substring(0, 8)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
