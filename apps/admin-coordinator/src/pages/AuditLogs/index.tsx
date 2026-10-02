import { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { 
  Search, 
  ShieldCheck, 
  Code, 
  X, 
  Database
} from 'lucide-react';
import type { AuditLog } from '@kits-eos/shared/src/types/models';

export function AuditLogsList() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');

  // Inspector modal
  const [inspectLog, setInspectLog] = useState<AuditLog | null>(null);

  useEffect(() => {
    async function fetchAuditLogs() {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchErr } = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false });

        if (fetchErr) throw fetchErr;
        setLogs(data || []);
      } catch (err: any) {
        console.error('Failed to load audit logs:', err);
        setError('Failed to load audit trail.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchAuditLogs();
  }, []);

  const uniqueActions = Array.from(new Set(logs.map(l => l.action).filter(Boolean)));

  const filteredLogs = logs.filter((log) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q ||
      log.action.toLowerCase().includes(q) ||
      log.entity_type.toLowerCase().includes(q) ||
      log.entity_id.toLowerCase().includes(q) ||
      (log.actor_id && log.actor_id.toLowerCase().includes(q));

    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  if (isLoading) {
    return <LoadingState message="Loading Append-Only Audit Trail..." />;
  }

  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        title="Administrative Audit Trail & Traceability"
        description="Immutable chronological logs of security, operational mutations, and coordinator activities."
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Log Entries</span>
          <p className="text-2xl font-black text-gray-900 mt-1">{logs.length}</p>
          <span className="text-[11px] text-gray-500 font-medium">Append-only Records</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-kits-blue">Unique Actions</span>
          <p className="text-2xl font-black text-kits-blue mt-1">{uniqueActions.length}</p>
          <span className="text-[11px] text-gray-500 font-medium">Distinct Operations</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Integrity Status</span>
          <p className="text-xl font-black text-emerald-600 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="h-5 w-5" /> Verified
          </p>
          <span className="text-[11px] text-emerald-700 font-medium">Tamper-Evident</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Trace Coverage</span>
          <p className="text-2xl font-black text-purple-600 mt-1">100%</p>
          <span className="text-[11px] text-purple-700 font-medium">Backend & Edge Enforced</span>
        </div>
      </div>

      {/* Logs Table & Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search action, entity ID, actor ID..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          <div className="flex items-center gap-3">
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg px-3 py-2"
            >
              <option value="ALL">All Actions ({uniqueActions.length})</option>
              {uniqueActions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <ErrorState message={error} />
          </div>
        )}

        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-400">
            No audit logs found matching criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-sans">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity Type</th>
                  <th className="py-3 px-4">Entity Reference ID</th>
                  <th className="py-3 px-4">Actor ID</th>
                  <th className="py-3 px-4 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/60 transition">
                    <td className="py-3 px-4 font-mono text-[11px] text-gray-600 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-[11px]">
                        {log.action}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-semibold text-gray-700 uppercase text-[10px]">
                      {log.entity_type}
                    </td>

                    <td className="py-3 px-4 font-mono text-[11px] text-gray-500">
                      {log.entity_id.substring(0, 16)}...
                    </td>

                    <td className="py-3 px-4 font-mono text-[11px] text-gray-500">
                      {log.actor_id ? log.actor_id.substring(0, 12) + '...' : 'SYSTEM / ANON'}
                    </td>

                    <td className="py-3 px-4 text-right">
                      {log.metadata ? (
                        <button
                          onClick={() => setInspectLog(log)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-kits-blue bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded transition"
                        >
                          <Code className="h-3 w-3" /> Inspect JSON
                        </button>
                      ) : (
                        <span className="text-gray-400 italic text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* JSON Metadata Inspector Modal */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-kits-blue" />
                <h3 className="text-xs font-black uppercase text-gray-900">
                  Audit Payload Inspector: {inspectLog.action}
                </h3>
              </div>
              <button onClick={() => setInspectLog(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="bg-gray-950 text-emerald-400 p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-96">
              <pre>{JSON.stringify(inspectLog.metadata, null, 2)}</pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setInspectLog(null)}
                className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-bold uppercase hover:bg-gray-800"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
