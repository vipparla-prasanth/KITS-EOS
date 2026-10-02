import { useState, useEffect } from 'react';
import type { EventItem, CategoryItem, SubEventItem } from '../types';
import { fetchAllSubEventsForEvent } from '../services/fallbackData';
import { X, Calendar, MapPin, Sparkles, Loader2, Info } from 'lucide-react';

interface EventModalProps {
  event: EventItem | null;
  onClose: () => void;
}

export function EventModal({ event, onClose }: EventModalProps) {
  const [categoriesWithSubEvents, setCategoriesWithSubEvents] = useState<
    { category: CategoryItem; subEvents: SubEventItem[] }[]
  >([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubEvent, setSelectedSubEvent] = useState<SubEventItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!event) return;

    let isMounted = true;
    setLoading(true);

    fetchAllSubEventsForEvent(event.id)
      .then((data) => {
        if (!isMounted) return;
        setCategoriesWithSubEvents(data);
        if (data.length > 0) {
          setSelectedCategoryId(data[0].category.id);
          if (data[0].subEvents.length > 0) {
            setSelectedSubEvent(data[0].subEvents[0]);
          }
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [event]);

  if (!event) return null;

  const currentCategoryData = categoriesWithSubEvents.find(
    (c) => c.category.id === selectedCategoryId
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm overflow-y-auto animate-fadeIn">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 via-[#002855] to-[#003366] text-white p-5 sm:p-6 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white text-[10px] font-black uppercase tracking-wider mb-2 border border-white/20">
            <Sparkles className="w-3 h-3 text-red-300" />
            <span>Event Directory & Competition Guidelines</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black tracking-tight">{event.name}</h2>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Explore competition categories, schedule timings, venue details, and participation guidelines.
          </p>
        </div>

        {/* Informational Banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex items-center gap-2.5 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Informational Notice:</strong> Registrations and payments are active on the primary KITS-EOS platform. This standby node provides live operational info.
          </span>
        </div>

        {/* Modal Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-kits-blue" />
              <p className="text-xs font-bold text-gray-500">Loading competition tracks & sub-events...</p>
            </div>
          ) : categoriesWithSubEvents.length === 0 ? (
            <div className="text-center py-12 text-gray-500 space-y-2">
              <p className="text-sm font-bold">No categories or sub-events published yet.</p>
              <p className="text-xs text-gray-400">Please check back closer to the event launch date.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Category Selection Tabs */}
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 block mb-2">
                  Select Category Track
                </label>
                <div className="flex flex-wrap gap-2">
                  {categoriesWithSubEvents.map(({ category, subEvents }) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryId(category.id);
                        if (subEvents.length > 0) {
                          setSelectedSubEvent(subEvents[0]);
                        } else {
                          setSelectedSubEvent(null);
                        }
                      }}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                        selectedCategoryId === category.id
                          ? 'bg-kits-blue text-white shadow-sm'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {category.name}
                      <span className="ml-1.5 opacity-75 text-[10px]">({subEvents.length})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-Events under Selected Category */}
              {currentCategoryData && currentCategoryData.subEvents.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left: Sub-events list selector */}
                  <div className="lg:col-span-5 space-y-2 max-h-[340px] overflow-y-auto pr-1">
                    <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                      Available Sub-Events
                    </label>
                    {currentCategoryData.subEvents.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setSelectedSubEvent(sub)}
                        className={`w-full text-left p-3.5 rounded-2xl border transition ${
                          selectedSubEvent?.id === sub.id
                            ? 'bg-blue-50/70 border-kits-blue ring-1 ring-kits-blue shadow-2xs'
                            : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs sm:text-sm font-black text-gray-900">{sub.name}</h4>
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                            {sub.participation_type}
                          </span>
                        </div>
                        {sub.venue && (
                          <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-1">
                            <MapPin className="w-3 h-3 text-gray-400" />
                            <span>{sub.venue}</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Right: Detailed Sub-Event View */}
                  <div className="lg:col-span-7 bg-gray-50/80 border border-gray-200 rounded-3xl p-5 sm:p-6 space-y-4">
                    {selectedSubEvent ? (
                      <div className="space-y-4">
                        <div className="border-b border-gray-200 pb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-kits-blue text-[10px] font-black uppercase">
                              {selectedSubEvent.participation_type} PARTICIPATION
                            </span>
                            {selectedSubEvent.max_team_size > 1 && (
                              <span className="px-2.5 py-0.5 rounded-full bg-gray-200 text-gray-700 text-[10px] font-bold">
                                Max {selectedSubEvent.max_team_size} Members / Team
                              </span>
                            )}
                          </div>
                          <h3 className="text-base sm:text-lg font-black text-gray-900">
                            {selectedSubEvent.name}
                          </h3>
                        </div>

                        {/* Timing & Venue Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div className="bg-white p-3 rounded-2xl border border-gray-200 flex items-start gap-2.5">
                            <Calendar className="w-4 h-4 text-kits-red shrink-0 mt-0.5" />
                            <div>
                              <div className="text-[10px] font-bold uppercase text-gray-400">Schedule</div>
                              <div className="font-bold text-gray-800">
                                {selectedSubEvent.start_time
                                  ? new Date(selectedSubEvent.start_time).toLocaleString('en-IN', {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    })
                                  : 'Schedule TBA'}
                              </div>
                            </div>
                          </div>

                          <div className="bg-white p-3 rounded-2xl border border-gray-200 flex items-start gap-2.5">
                            <MapPin className="w-4 h-4 text-kits-blue shrink-0 mt-0.5" />
                            <div>
                              <div className="text-[10px] font-bold uppercase text-gray-400">Venue</div>
                              <div className="font-bold text-gray-800">
                                {selectedSubEvent.venue || 'Campus Central Halls'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Description */}
                        {selectedSubEvent.description && (
                          <div className="space-y-1">
                            <h5 className="text-[11px] font-black uppercase text-gray-500">Description</h5>
                            <p className="text-xs text-gray-700 leading-relaxed bg-white p-3.5 rounded-2xl border border-gray-200">
                              {selectedSubEvent.description}
                            </p>
                          </div>
                        )}

                        {/* Rules */}
                        {selectedSubEvent.rules && (
                          <div className="space-y-1">
                            <h5 className="text-[11px] font-black uppercase text-gray-500">
                              Rules & Evaluation Criteria
                            </h5>
                            <div className="text-xs text-gray-700 whitespace-pre-line bg-white p-3.5 rounded-2xl border border-gray-200 max-h-40 overflow-y-auto">
                              {selectedSubEvent.rules}
                            </div>
                          </div>
                        )}

                        {/* Registration Restriction Alert */}
                        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-2.5 text-xs text-blue-950">
                          <Info className="w-4 h-4 text-kits-blue shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold block">Looking to register for this event?</span>
                            <span className="text-blue-800 text-[11px]">
                              To submit registrations, team rosters, or online payments, please visit the primary KITS-EOS student portal.
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 text-center py-8">Select a sub-event to view details.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-200 text-gray-500 text-xs">
                  No sub-events listed in this category track.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-gray-50 border-t border-gray-200 p-4 px-6 flex items-center justify-between text-xs text-gray-500">
          <span className="font-medium">KITS Akshar Institute of Technology</span>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-4 py-2 text-xs font-bold"
          >
            Close Overview
          </button>
        </div>
      </div>
    </div>
  );
}
