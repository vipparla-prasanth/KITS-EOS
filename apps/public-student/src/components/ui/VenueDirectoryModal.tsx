import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@kits-eos/shared';
import { 
  X, 
  Search, 
  MapPin, 
  Phone, 
  FileSpreadsheet, 
  Loader2, 
  User, 
  GraduationCap, 
  Briefcase 
} from 'lucide-react';
import { 
  fetchVenueDirectoryData, 
  downloadVenueDirectoryExcel, 
  type VenueDirectoryItem 
} from '../../services/venueDirectoryService';

interface VenueDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  mainEventId?: string;
  mainEventName?: string;
}

export function VenueDirectoryModal({ 
  isOpen, 
  onClose,
  mainEventId,
  mainEventName
}: VenueDirectoryModalProps) {
  const [items, setItems] = useState<VenueDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchVenues = useCallback(async () => {
    if (!isOpen) return;

    try {
      setLoading(true);
      setError(null);
      const data = await fetchVenueDirectoryData(mainEventId);
      setItems(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load venue directory.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, mainEventId]);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  // Safe scroll lock and Escape key listener
  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleDownloadExcel = async () => {
    try {
      setDownloading(true);
      await downloadVenueDirectoryExcel(items, mainEventName);
    } catch (err: any) {
      console.error('Failed to download venue directory Excel:', err);
      alert(err.message || 'Unable to download Venue Directory Excel.');
    } finally {
      setDownloading(false);
    }
  };

  const filteredItems = items.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;

    const matchSubEvent = item.subEventName.toLowerCase().includes(q);
    const matchEvent = item.eventName.toLowerCase().includes(q);
    const matchVenue = item.venue.toLowerCase().includes(q);
    const matchCoord = item.coordinators.some(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );

    return matchSubEvent || matchEvent || matchVenue || matchCoord;
  });

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-xs transition-opacity duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-modal-title"
    >
      <div className="relative w-full max-w-5xl bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-gray-200 flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 sm:px-8 py-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-gray-50/60 to-white">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-red-50 text-kits-red border border-red-100">
              <MapPin className="h-3.5 w-3.5" />
              <span>Campus Venue Directory</span>
            </div>
            <h2 id="venue-modal-title" className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              {mainEventName ? `${mainEventName} • VENUE & COORDINATOR DIRECTORY` : 'EVENT VENUE & COORDINATOR DIRECTORY'}
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 font-medium">
              {mainEventName
                ? `Find sub-event venues and contact assigned coordinators for ${mainEventName}.`
                : 'Find your event venue and contact the assigned coordinators.'}
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Download Excel Button */}
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={downloading || loading || items.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 active:scale-95 transition shadow-sm cursor-pointer disabled:opacity-50"
              title="Download official KITS-EOS-Event-Venue-Coordinator-Directory.xlsx"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              <span>⬇ Download Excel</span>
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Search & Counter Toolbar */}
        <div className="px-5 sm:px-8 py-3 bg-gray-50/80 border-b border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search event, venue, coordinator, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
            />
          </div>

          <div className="text-[11px] font-bold text-gray-500 self-end sm:self-center">
            Showing <span className="text-gray-900 font-black">{filteredItems.length}</span> active sub-event{filteredItems.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-gray-400">
              <Loader2 className="h-7 w-7 animate-spin text-kits-blue" />
              <p className="text-xs font-bold uppercase tracking-wider">Loading authoritative venue directory...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2">
              <p className="text-xs font-black text-red-800">{error}</p>
              <button
                type="button"
                onClick={fetchVenues}
                className="text-xs text-kits-blue underline font-bold cursor-pointer"
              >
                Retry loading
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center space-y-2 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
              <User className="h-8 w-8 text-gray-300 mx-auto" />
              <p className="text-sm font-bold text-gray-700">No events or venues match your search.</p>
              <p className="text-xs text-gray-400">Try searching for a different keyword or clearing the search filter.</p>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE (Medium screens & up) */}
              <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-2xl shadow-2xs">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-gray-900 text-white uppercase text-[10px] font-black tracking-wider">
                      <th className="py-3.5 px-4 w-[28%]">EVENT / SUB-EVENT</th>
                      <th className="py-3.5 px-4 w-[36%]">VENUE</th>
                      <th className="py-3.5 px-4 w-[20%]">COORDINATOR</th>
                      <th className="py-3.5 px-4 w-[16%]">CONTACT NUMBER</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white font-medium">
                    {filteredItems.map((item, idx) => {
                      const coordCount = item.coordinators.length;
                      if (coordCount === 0) {
                        return (
                          <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                            <td className="py-3 px-4 font-black text-gray-900 align-top">
                              <div>{item.subEventName}</div>
                              {item.categoryName && (
                                <span className="text-[10px] font-bold text-gray-400 uppercase">
                                  {item.categoryName}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-gray-700 align-top">
                              <div className="flex items-start gap-1.5 font-mono text-[11px]">
                                <MapPin className="h-3.5 w-3.5 text-kits-red shrink-0 mt-0.5" />
                                <span>{item.venue}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-gray-400 italic align-top">Not Assigned</td>
                            <td className="py-3 px-4 text-gray-400 italic align-top">Not Assigned</td>
                          </tr>
                        );
                      }

                      return item.coordinators.map((coord, cIdx) => (
                        <tr 
                          key={`${item.id}-${coord.id || cIdx}`}
                          className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}
                        >
                          {cIdx === 0 ? (
                            <td 
                              rowSpan={coordCount} 
                              className="py-3.5 px-4 font-black text-gray-900 align-top border-r border-gray-100"
                            >
                              <div className="text-sm font-black tracking-tight">{item.subEventName}</div>
                              {item.categoryName && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-black bg-gray-100 text-gray-600 uppercase">
                                  {item.categoryName}
                                </span>
                              )}
                            </td>
                          ) : null}

                          {cIdx === 0 ? (
                            <td 
                              rowSpan={coordCount} 
                              className="py-3.5 px-4 text-gray-700 align-top border-r border-gray-100"
                            >
                              <div className="flex items-start gap-1.5 font-mono text-xs font-bold leading-relaxed text-gray-800">
                                <MapPin className="h-4 w-4 text-kits-red shrink-0 mt-0.5" />
                                <span>{item.venue}</span>
                              </div>
                            </td>
                          ) : null}

                          <td className="py-3 px-4 text-gray-800 align-middle">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${
                                  coord.role === 'FACULTY'
                                    ? 'bg-red-50 text-kits-red border border-red-100'
                                    : 'bg-blue-50 text-kits-blue border border-blue-100'
                                }`}
                              >
                                {coord.role === 'FACULTY' ? 'FACULTY' : 'STUDENT'}
                              </span>
                              <span className="font-bold capitalize text-gray-900">
                                {coord.name}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono text-xs align-middle">
                            {coord.phone && coord.phone !== 'Not Assigned' ? (
                              <a
                                href={`tel:${coord.phone}`}
                                className="inline-flex items-center gap-1.5 text-kits-blue hover:text-blue-800 hover:underline font-bold"
                              >
                                <Phone className="h-3 w-3 text-kits-red shrink-0" />
                                <span>{coord.phone}</span>
                              </a>
                            ) : (
                              <span className="text-gray-400 italic">Not Assigned</span>
                            )}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>

              {/* MOBILE CARDS (Small screens) */}
              <div className="block md:hidden space-y-3.5">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs space-y-3"
                  >
                    <div className="border-b border-gray-100 pb-2.5 flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-black uppercase tracking-tight text-gray-900">
                          {item.subEventName}
                        </h3>
                        {item.categoryName && (
                          <span className="text-[10px] font-bold text-gray-400 uppercase">
                            {item.categoryName}
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-600 shrink-0">
                        {item.coordinators.length} Coord{item.coordinators.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* Venue */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-kits-red">
                        <MapPin className="h-3 w-3" />
                        <span>Venue</span>
                      </div>
                      <p className="text-xs font-mono font-bold text-gray-800 pl-4 bg-red-50/40 p-2 rounded-xl border border-red-100/60 leading-relaxed">
                        {item.venue}
                      </p>
                    </div>

                    {/* Coordinators */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
                        <User className="h-3 w-3" />
                        <span>{item.coordinators.length > 1 ? 'Coordinators' : 'Coordinator'}</span>
                      </div>

                      {item.coordinators.length === 0 ? (
                        <p className="text-xs text-gray-400 italic pl-4">No coordinators assigned yet.</p>
                      ) : (
                        <div className="space-y-2 pl-2">
                          {item.coordinators.map((coord) => (
                            <div
                              key={coord.id}
                              className="flex items-center justify-between gap-2 p-2 rounded-xl bg-gray-50 border border-gray-100"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  {coord.role === 'FACULTY' ? (
                                    <Briefcase className="h-3 w-3 text-kits-red shrink-0" />
                                  ) : (
                                    <GraduationCap className="h-3 w-3 text-kits-blue shrink-0" />
                                  )}
                                  <span className="text-xs font-bold text-gray-900 capitalize">
                                    {coord.name}
                                  </span>
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block pl-4">
                                  {coord.role === 'FACULTY' ? 'Faculty Lead' : 'Student Lead'}
                                </span>
                              </div>

                              {coord.phone && coord.phone !== 'Not Assigned' ? (
                                <a
                                  href={`tel:${coord.phone}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-[11px] font-mono font-bold text-kits-blue shadow-2xs hover:bg-blue-50 transition shrink-0"
                                >
                                  <Phone className="h-3 w-3 text-kits-red" />
                                  <span>{coord.phone}</span>
                                </a>
                              ) : (
                                <span className="text-[10px] text-gray-400 italic">No phone</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-8 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span className="text-[11px] font-semibold text-gray-500">
            Official KITS-EOS Campus Operations • KITS Akshar Institute of Technology
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-gray-200 text-gray-800 text-xs font-bold hover:bg-gray-300 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
