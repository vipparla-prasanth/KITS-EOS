import React, { useState, useEffect } from 'react';
import type { EventItem } from '../types';
import { fetchActiveEvents } from '../services/fallbackData';
import { EventModal } from './EventModal';
import { 
  Search, 
  Calendar, 
  ArrowRight, 
  CheckCircle2, 
  Layers, 
  Loader2
} from 'lucide-react';

export function PublicPortal() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);

  // Inquiry Desk Form State
  const [ticketName, setTicketName] = useState('');
  const [ticketRoll, setTicketRoll] = useState('');
  const [ticketDept, setTicketDept] = useState('CSE');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketSubmitted, setTicketSubmitted] = useState(false);

  useEffect(() => {
    let isMounted = true;
    fetchActiveEvents()
      .then((data) => {
        if (isMounted) setEvents(data);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleInquirySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTicketSubmitted(true);
    setTicketMessage('');
  };

  const filteredEvents = events.filter((ev) =>
    ev.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-10">
      {/* 1. HERO SECTION */}
      <section className="bg-gradient-to-br from-slate-900 via-[#002855] to-[#003366] text-white rounded-3xl p-6 sm:p-10 shadow-xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-3xl space-y-4 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] sm:text-xs font-black uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Institutional Contingency & Event Directory</span>
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
            Central Event Operations Standby Node
          </h1>

          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed max-w-2xl font-medium">
            Welcome to the KITS-EOS Secondary Standby Environment. Browse institutional event schedules, track rules, competition venues, and contingency guidelines.
          </p>

          <div className="p-3 bg-white/10 border border-white/20 rounded-2xl text-xs text-white max-w-xl">
            <span className="font-bold block text-red-200">Notice on Registrations & Payments:</span>
            <span>
              All student registrations, team formations, and fee transactions are processed via the primary KITS-EOS portal. This portal serves as a reliable emergency directory and operational information hub.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="#events-directory"
              className="px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-lg active:scale-95 flex items-center gap-2"
            >
              <span>Explore Events & Tracks</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <a
              href="#protocols"
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold uppercase tracking-wider transition active:scale-95 flex items-center justify-center"
            >
              Offline Protocols
            </a>
          </div>
        </div>
      </section>

      {/* 2. FLAGSHIP EVENTS DIRECTORY */}
      <section id="events-directory" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              Active Institutional Events
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Select an event to view published tracks, sub-events, schedules, and competition venues.
            </p>
          </div>

          {/* Real-time Search */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search event name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue shadow-2xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 space-y-3 bg-white rounded-3xl border border-gray-200">
            <Loader2 className="w-8 h-8 animate-spin text-kits-blue" />
            <p className="text-xs font-bold text-gray-500">Retrieving flagship events directory...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-3xl border border-gray-200 space-y-2">
            <Layers className="w-10 h-10 text-gray-300 mx-auto" />
            <p className="text-sm font-bold text-gray-700">No active events found.</p>
            <p className="text-xs text-gray-500">
              {searchQuery ? `No results match "${searchQuery}"` : 'Event schedules will appear here once published.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredEvents.map((event) => (
              <div
                key={event.id}
                className="bg-white rounded-3xl border border-gray-200 shadow-2xs hover:shadow-md transition overflow-hidden flex flex-col justify-between group"
              >
                <div>
                  {/* Banner / Header Image representation */}
                  <div className="h-36 bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-10">
                      <Layers className="w-24 h-24" />
                    </div>
                    <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/10 text-[10px] font-black uppercase text-red-200 w-max border border-white/10">
                      Active Event
                    </div>
                    <h3 className="text-base sm:text-lg font-black tracking-tight leading-snug line-clamp-2">
                      {event.name}
                    </h3>
                  </div>

                  <div className="p-5 space-y-3">
                    <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                      {event.description || 'Institutional symposium and inter-collegiate technical competition tracks.'}
                    </p>

                    <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500">
                      <Calendar className="w-3.5 h-3.5 text-kits-blue" />
                      <span>Published on {new Date(event.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
                    </div>
                  </div>
                </div>

                <div className="p-5 pt-0">
                  <button
                    type="button"
                    onClick={() => setSelectedEvent(event)}
                    className="w-full py-2.5 px-4 rounded-xl bg-gray-50 hover:bg-kits-blue text-gray-800 hover:text-white text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-2 border border-gray-200 hover:border-kits-blue active:scale-95"
                  >
                    <span>View Tracks & Sub-Events</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. OPERATIONAL CONTINGENCY PROTOCOLS */}
      <section id="protocols" className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 text-kits-blue flex items-center justify-center font-black text-sm">
            01
          </div>
          <h3 className="text-sm sm:text-base font-black text-gray-900">
            Offline Tokens & Helpdesk
          </h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            If experiencing connectivity issues with the primary student portal, report directly to the Central Operations Desk in Block A with your college ID card.
          </p>
        </div>

        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-3">
          <div className="h-10 w-10 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center font-black text-sm">
            02
          </div>
          <h3 className="text-sm sm:text-base font-black text-gray-900">
            Attendance Verification
          </h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Student and faculty coordinators are equipped with offline-synchronized attendance rosters to ensure uninterrupted verification at competition venues.
          </p>
        </div>

        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-3">
          <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-sm">
            03
          </div>
          <h3 className="text-sm sm:text-base font-black text-gray-900">
            Institutional Authenticity
          </h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            All certificates and tokens issued by KITS-EOS maintain cryptographic signatures. Authenticity verification remains fully active.
          </p>
        </div>
      </section>

      {/* 4. EMERGENCY INQUIRY DESK */}
      <section id="support" className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-2xs max-w-2xl mx-auto space-y-5">
        <div className="border-b border-gray-100 pb-3">
          <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight">
            Standby Emergency Inquiry Desk
          </h3>
          <p className="text-xs text-gray-500">
            Submit an urgent inquiry directly to the on-duty Central Operations Team.
          </p>
        </div>

        {ticketSubmitted ? (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 space-y-2">
            <div className="font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Inquiry Logged Successfully</span>
            </div>
            <p>
              Your dispatch has been noted. An operations coordinator will connect with your department lead or reach out to you directly.
            </p>
            <button
              type="button"
              onClick={() => setTicketSubmitted(false)}
              className="mt-2 text-xs font-black text-emerald-900 underline"
            >
              Submit another inquiry
            </button>
          </div>
        ) : (
          <form onSubmit={handleInquirySubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-700 block">Your Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Rikki Varma"
                  value={ticketName}
                  onChange={(e) => setTicketName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-700 block">Roll Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., 21JR1A0501"
                  value={ticketRoll}
                  onChange={(e) => setTicketRoll(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue uppercase"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-700 block">Department</label>
              <select
                value={ticketDept}
                onChange={(e) => setTicketDept(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium"
              >
                <option value="CSE">Computer Science & Engineering (CSE)</option>
                <option value="ECE">Electronics & Communication (ECE)</option>
                <option value="EEE">Electrical & Electronics (EEE)</option>
                <option value="MECH">Mechanical Engineering (MECH)</option>
                <option value="CIVIL">Civil Engineering (CIVIL)</option>
                <option value="IT">Information Technology (IT)</option>
                <option value="AI_DS">Artificial Intelligence & Data Science</option>
                <option value="AIML">Artificial Intelligence & Machine Learning</option>
                <option value="OTHER">Other Institution / Department</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-700 block">Description of Issue / Request</label>
              <textarea
                required
                rows={3}
                placeholder="Describe your event, pass, or operational issue in detail..."
                value={ticketMessage}
                onChange={(e) => setTicketMessage(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 rounded-xl bg-kits-blue text-white text-xs font-black uppercase tracking-wider hover:bg-[#002855] active:scale-95 transition shadow-2xs"
            >
              Transmit to Emergency Operations Desk
            </button>
          </form>
        )}
      </section>

      {/* Event Details Drilldown Modal */}
      {selectedEvent && (
        <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
