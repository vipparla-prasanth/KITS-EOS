import { useState, useMemo } from 'react';
import { 
  Users, 
  CreditCard, 
  CheckCircle2, 
  Award, 
  Layers, 
  Search, 
  RefreshCw, 
  Calendar 
} from 'lucide-react';

export interface ScopedCategoryStats {
  category_id: string;
  category_name: string;
  event_id: string;
  event_name: string;
  sub_events_count: number;
  total_registrations: number;
  total_participants: number;
  solo_registrations: number;
  team_registrations: number;
  paid_registrations: number;
  pending_registrations: number;
  total_revenue: number;
  attended_count: number;
  attendance_percentage: number;
  certificates_count: number;
  published_sub_events_count: number;
}

export interface ScopedSubEventStats {
  sub_event_id: string;
  sub_event_name: string;
  category_id: string;
  category_name: string;
  event_id: string;
  event_name: string;
  participation_type: string;
  fee_amount_solo: number;
  fee_amount_team: number;
  results_locked: boolean;
  results_published: boolean;
  winner_team_id?: string | null;
  runner_team_id?: string | null;
  third_team_id?: string | null;
  registration_count: number;
  total_participants: number;
  solo_count: number;
  team_count: number;
  paid_count: number;
  pending_count: number;
  revenue: number;
  attended_count: number;
  attendance_percentage: number;
  certificates_count: number;
  results_status: 'PUBLISHED' | 'LOCKED' | 'WINNERS_DECLARED' | 'PENDING';
  eligible_competitors_count: number;
  can_direct_publish: boolean;
}

export interface ScopeSummaryStats {
  total_categories: number;
  total_sub_events: number;
  total_registrations: number;
  total_participants: number;
  total_attended: number;
  overall_attendance_percentage: number;
  total_revenue: number;
  total_certificates: number;
}

interface ScopedAnalyticsViewProps {
  summary: ScopeSummaryStats;
  categories: ScopedCategoryStats[];
  subEvents: ScopedSubEventStats[];
  role: 'ADMIN' | 'COORDINATOR';
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function ScopedAnalyticsView({
  summary,
  categories,
  subEvents,
  role,
  onRefresh,
  isRefreshing = false,
}: ScopedAnalyticsViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'CATEGORIES' | 'SUB_EVENTS'>('CATEGORIES');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Filter categories
  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = cat.category_name?.toLowerCase().includes(q);
        const matchEvent = cat.event_name?.toLowerCase().includes(q);
        if (!matchName && !matchEvent) return false;
      }
      return true;
    });
  }, [categories, searchQuery]);

  // Filter sub-events
  const filteredSubEvents = useMemo(() => {
    return subEvents.filter((se) => {
      if (selectedCategoryFilter !== 'ALL' && se.category_id !== selectedCategoryFilter) {
        return false;
      }
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'PUBLISHED' && !se.results_published) return false;
        if (statusFilter === 'PENDING' && se.results_published) return false;
        if (statusFilter === 'DIRECT_READY' && !se.can_direct_publish) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = se.sub_event_name?.toLowerCase().includes(q);
        const matchCat = se.category_name?.toLowerCase().includes(q);
        const matchEv = se.event_name?.toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchEv) return false;
      }
      return true;
    });
  }, [subEvents, selectedCategoryFilter, statusFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Scope KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Card 1: Registrations */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Registrations</span>
            <Users className="h-4 w-4 text-kits-red" />
          </div>
          <p className="text-2xl font-black text-gray-900 font-mono">
            {summary?.total_registrations || 0}
          </p>
          <span className="text-[10px] text-gray-500 font-bold block">
            Across {summary?.total_sub_events || 0} Sub-Events
          </span>
        </div>

        {/* Card 2: Participant Slots */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Participant Slots</span>
            <Layers className="h-4 w-4 text-kits-blue" />
          </div>
          <p className="text-2xl font-black text-gray-900 font-mono">
            {summary?.total_participants || 0}
          </p>
          <div className="text-[10px] leading-tight space-y-0.5">
            <span className="text-gray-500 font-bold block">
              Operational entries across {summary?.total_sub_events ?? 0} Sub-Events
            </span>
            <span className="text-kits-blue font-extrabold block">
              {summary?.total_participants ?? 0} Participant Slots
            </span>
          </div>
        </div>

        {/* Card 3: Attendance */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Attendance</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-700 font-mono">
            {summary?.total_attended || 0}
          </p>
          <span className="text-[10px] text-emerald-800 font-bold block">
            {summary?.overall_attendance_percentage || 0}% Turnout Rate
          </span>
        </div>

        {/* Card 4: Revenue */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Revenue</span>
            <CreditCard className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-700 font-mono">
            ₹{(summary?.total_revenue || 0).toLocaleString('en-IN')}
          </p>
          <span className="text-[10px] text-gray-500 font-bold block">
            Verified Collections
          </span>
        </div>

        {/* Card 5: Categories */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Categories</span>
            <Calendar className="h-4 w-4 text-gray-700" />
          </div>
          <p className="text-2xl font-black text-gray-900 font-mono">
            {summary?.total_categories || 0}
          </p>
          <span className="text-[10px] text-gray-500 font-bold block">
            {role === 'COORDINATOR' ? 'Assigned Scope' : 'Active Divisions'}
          </span>
        </div>

        {/* Card 6: Certificates */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Certificates</span>
            <Award className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-2xl font-black text-gray-900 font-mono">
            {summary?.total_certificates || 0}
          </p>
          <span className="text-[10px] text-gray-500 font-bold block">
            Issued Credentials
          </span>
        </div>
      </div>

      {/* Analytical View Switcher & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Tab Buttons */}
        <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-bold w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('CATEGORIES')}
            className={`flex-1 sm:flex-initial px-5 py-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeSubTab === 'CATEGORIES'
                ? 'bg-white text-gray-900 shadow-2xs font-black'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Calendar className="h-3.5 w-3.5 text-kits-red" />
            <span>Category-wise Breakdown ({categories.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('SUB_EVENTS')}
            className={`flex-1 sm:flex-initial px-5 py-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeSubTab === 'SUB_EVENTS'
                ? 'bg-white text-gray-900 shadow-2xs font-black'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-kits-blue" />
            <span>Sub-event-wise Analytics ({subEvents.length})</span>
          </button>
        </div>

        {/* Filter Controls & Refresh */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 sm:w-64">
            <Search className="h-3.5 w-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeSubTab === 'CATEGORIES' ? 'categories...' : 'sub-events...'}`}
              className="w-full pl-8.5 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          {activeSubTab === 'SUB_EVENTS' && (
            <>
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-700"
              >
                <option value="ALL">All Categories</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>{c.category_name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-700"
              >
                <option value="ALL">All Statuses</option>
                <option value="PUBLISHED">Published</option>
                <option value="PENDING">Pending Results</option>
                <option value="DIRECT_READY">Direct Publish Ready</option>
              </select>
            </>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition cursor-pointer"
              title="Refresh Analytics"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-kits-red' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          VIEW 1: CATEGORY-WISE ANALYTICS
          ========================================================================= */}
      {activeSubTab === 'CATEGORIES' && (
        <div className="space-y-4">
          {/* Category Cards Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCategories.map((cat) => (
              <div
                key={cat.category_id}
                className="bg-white rounded-2xl border border-gray-200 shadow-2xs p-5 space-y-4 flex flex-col justify-between hover:border-kits-blue hover:shadow-xs transition"
              >
                <div>
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-red-50 text-kits-red border border-red-100">
                      {cat.event_name}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-gray-400">
                      {cat.sub_events_count} Sub-Event{cat.sub_events_count === 1 ? '' : 's'}
                    </span>
                  </div>

                  <h3 className="text-base font-black text-gray-900 tracking-tight mt-2.5">
                    {cat.category_name}
                  </h3>

                  {/* Operational Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                    <div className="p-2.5 bg-gray-50 rounded-xl">
                      <span className="text-[9px] font-black uppercase text-gray-500 block">Registrations</span>
                      <p className="font-mono font-black text-gray-900 text-sm mt-0.5">
                        {cat.total_registrations}
                      </p>
                      <span className="text-[9px] text-gray-400 font-medium">
                        {cat.solo_registrations} Solo • {cat.team_registrations} Teams
                      </span>
                    </div>

                    <div className="p-2.5 bg-gray-50 rounded-xl">
                      <span className="text-[9px] font-black uppercase text-gray-500 block">Participants</span>
                      <p className="font-mono font-black text-gray-900 text-sm mt-0.5">
                        {cat.total_participants}
                      </p>
                      <span className="text-[9px] text-gray-400 font-medium">
                        Enrolled Students
                      </span>
                    </div>

                    <div className="p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100">
                      <span className="text-[9px] font-black uppercase text-emerald-800 block">Attendance</span>
                      <p className="font-mono font-black text-emerald-900 text-sm mt-0.5">
                        {cat.attended_count} / {cat.total_participants}
                      </p>
                      <span className="text-[9px] text-emerald-700 font-bold">
                        {cat.attendance_percentage}% Attended
                      </span>
                    </div>

                    <div className="p-2.5 bg-blue-50/60 rounded-xl border border-blue-100">
                      <span className="text-[9px] font-black uppercase text-kits-blue block">Revenue</span>
                      <p className="font-mono font-black text-blue-950 text-sm mt-0.5">
                        ₹{(cat.total_revenue || 0).toLocaleString('en-IN')}
                      </p>
                      <span className="text-[9px] text-gray-500 font-medium">
                        {cat.paid_registrations} Paid • {cat.pending_registrations} Pending
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                  <span className="flex items-center gap-1 font-bold">
                    <Award className="h-3.5 w-3.5 text-amber-600" />
                    {cat.certificates_count} Certificates
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                    cat.published_sub_events_count === cat.sub_events_count && cat.sub_events_count > 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : cat.published_sub_events_count > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-gray-100 text-gray-600'
                  }`}>
                    {cat.published_sub_events_count} / {cat.sub_events_count} Published
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Full Category Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                Detailed Category Breakdown Table
              </h4>
              <span className="text-[10px] font-mono text-gray-400">
                {filteredCategories.length} Categories
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4 font-black">Category</th>
                    <th className="py-3 px-3 font-black text-center">Sub-Events</th>
                    <th className="py-3 px-3 font-black text-center">Registrations</th>
                    <th className="py-3 px-3 font-black text-center">Participants</th>
                    <th className="py-3 px-3 font-black text-center">Solo / Team</th>
                    <th className="py-3 px-3 font-black text-center">Paid / Pending</th>
                    <th className="py-3 px-3 font-black text-center">Attendance</th>
                    <th className="py-3 px-3 font-black text-right">Revenue (₹)</th>
                    <th className="py-3 px-4 font-black text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {filteredCategories.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">
                        No categories found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredCategories.map((c) => (
                      <tr key={c.category_id} className="hover:bg-gray-50/60 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900">{c.category_name}</div>
                          <div className="text-[10px] text-gray-400 font-normal">{c.event_name}</div>
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-gray-800">
                          {c.sub_events_count}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-gray-900">
                          {c.total_registrations}
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-gray-700">
                          {c.total_participants}
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-[11px] text-gray-600">
                          {c.solo_registrations}S / {c.team_registrations}T
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-[11px]">
                          <span className="text-emerald-700 font-bold">{c.paid_registrations}</span>
                          <span className="text-gray-400"> / </span>
                          <span className="text-amber-700 font-bold">{c.pending_registrations}</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            c.attendance_percentage >= 70 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                          }`}>
                            {c.attended_count}/{c.total_participants} ({c.attendance_percentage}%)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                          ₹{(c.total_revenue || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            c.published_sub_events_count === c.sub_events_count && c.sub_events_count > 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.published_sub_events_count > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-600'
                          }`}>
                            {c.published_sub_events_count}/{c.sub_events_count} Done
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 2: SUB-EVENT-WISE ANALYTICS
          ========================================================================= */}
      {activeSubTab === 'SUB_EVENTS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                Detailed Sub-Event Performance Matrix
              </h4>
              <span className="text-[10px] font-mono text-gray-400">
                {filteredSubEvents.length} Sub-Events
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4 font-black">Sub-Event</th>
                    <th className="py-3 px-3 font-black text-center">Format</th>
                    <th className="py-3 px-3 font-black text-center">Registrations</th>
                    <th className="py-3 px-3 font-black text-center">Participants</th>
                    <th className="py-3 px-3 font-black text-center">Attendance</th>
                    <th className="py-3 px-3 font-black text-center">Payment Status</th>
                    <th className="py-3 px-3 font-black text-right">Revenue (₹)</th>
                    <th className="py-3 px-3 font-black text-center">Certificates</th>
                    <th className="py-3 px-4 font-black text-center">Results / Publishing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {filteredSubEvents.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">
                        No sub-events found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredSubEvents.map((se) => (
                      <tr key={se.sub_event_id} className="hover:bg-gray-50/60 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900">{se.sub_event_name}</div>
                          <div className="text-[10px] text-gray-400 font-normal">
                            {se.category_name} • {se.event_name}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            se.participation_type === 'TEAM'
                              ? 'bg-blue-50 text-kits-blue border border-blue-200'
                              : se.participation_type === 'SOLO'
                                ? 'bg-gray-100 text-gray-700 border border-gray-200'
                                : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}>
                            {se.participation_type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-gray-900">
                          {se.registration_count}
                          <div className="text-[9px] text-gray-400 font-normal font-sans">
                            {se.solo_count}S / {se.team_count}T
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-gray-700">
                          {se.total_participants}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            se.attendance_percentage >= 70 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                          }`}>
                            {se.attended_count}/{se.total_participants} ({se.attendance_percentage}%)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-[11px]">
                          <span className="text-emerald-700 font-bold">{se.paid_count} Paid</span>
                          {se.pending_count > 0 && (
                            <span className="text-amber-700 font-bold block text-[10px]">
                              {se.pending_count} Pending
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                          ₹{(se.revenue || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-gray-800">
                          {se.certificates_count}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="space-y-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase block ${
                              se.results_published
                                ? 'bg-emerald-100 text-emerald-800'
                                : se.results_locked
                                  ? 'bg-blue-100 text-blue-800'
                                  : se.winner_team_id
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-gray-100 text-gray-600'
                            }`}>
                              {se.results_status}
                            </span>
                            {se.can_direct_publish && !se.results_published && (
                              <span className="text-[9px] font-black uppercase text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 block">
                                &lt;2 Competitors (Direct)
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
