import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock, Check, X, RotateCcw } from 'lucide-react';

interface DateTimePickerProps {
  id?: string;
  label?: string;
  value: string | null;
  onChange: (isoString: string) => void;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  disabled?: boolean;
  minDate?: string | Date;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_OF_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseDateValue(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function formatDisplayDateTime(date: Date | null): string {
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours).padStart(2, '0');

  return `${day}-${month}-${year}  ${hoursStr}:${minutes} ${period}`;
}

export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  required = false,
  placeholder = 'DD-MM-YYYY  hh:mm AM/PM',
  helperText,
  disabled = false,
}: DateTimePickerProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Position state for portal
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number; openUpwards: boolean }>({
    top: 0,
    left: 0,
    openUpwards: false,
  });

  // Parsed initial date
  const parsedInitial = parseDateValue(value);
  const initialDate = parsedInitial || new Date();

  const [viewYear, setViewYear] = useState<number>(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialDate.getMonth());

  // Date selection
  const [selectedDate, setSelectedDate] = useState<Date | null>(parsedInitial);

  // Time selection (12-hour format)
  const [hour12, setHour12] = useState<number>(() => {
    if (!parsedInitial) return 9;
    const h = parsedInitial.getHours() % 12;
    return h === 0 ? 12 : h;
  });

  const [minute, setMinute] = useState<number>(() => {
    if (!parsedInitial) return 0;
    return parsedInitial.getMinutes();
  });

  const [period, setPeriod] = useState<'AM' | 'PM'>(() => {
    if (!parsedInitial) return 'AM';
    return parsedInitial.getHours() >= 12 ? 'PM' : 'AM';
  });

  // Sync state if external value changes
  useEffect(() => {
    const parsed = parseDateValue(value);
    if (parsed) {
      setSelectedDate(parsed);
      setViewYear(parsed.getFullYear());
      setViewMonth(parsed.getMonth());
      const h = parsed.getHours() % 12;
      setHour12(h === 0 ? 12 : h);
      setMinute(parsed.getMinutes());
      setPeriod(parsed.getHours() >= 12 ? 'PM' : 'AM');
    } else {
      setSelectedDate(null);
    }
  }, [value]);

  // Recalculate popover position on open, scroll, or resize
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const POPOVER_HEIGHT = 410;
    const effectiveWidth = Math.min(330, window.innerWidth - 16);

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpwards = spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow;

    const top = openUpwards
      ? rect.top + window.scrollY - POPOVER_HEIGHT - 6
      : rect.bottom + window.scrollY + 6;

    // Constrain left within viewport
    let left = rect.left + window.scrollX;
    if (left + effectiveWidth > window.innerWidth - 8) {
      left = window.innerWidth - effectiveWidth - 8;
    }
    if (left < 8) left = 8;

    setPopoverCoords({ top, left, openUpwards });
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Escape key listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(prev => prev - 1);
    } else {
      setViewMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(prev => prev + 1);
    } else {
      setViewMonth(prev => prev + 1);
    }
  };

  const computeDate = (d: Date, h12: number, m: number, p: 'AM' | 'PM') => {
    const result = new Date(d);
    let hours24 = h12 % 12;
    if (p === 'PM') hours24 += 12;
    result.setHours(hours24, m, 0, 0);
    return result;
  };

  const handleSelectDay = (day: number) => {
    const newBase = new Date(viewYear, viewMonth, day);
    setSelectedDate(newBase);
    const finalDate = computeDate(newBase, hour12, minute, period);
    onChange(finalDate.toISOString());
  };

  const handleTimeChange = (newHour: number, newMin: number, newPeriod: 'AM' | 'PM') => {
    setHour12(newHour);
    setMinute(newMin);
    setPeriod(newPeriod);

    const base = selectedDate || new Date(viewYear, viewMonth, new Date().getDate());
    setSelectedDate(base);
    const finalDate = computeDate(base, newHour, newMin, newPeriod);
    onChange(finalDate.toISOString());
  };

  const handleSetNow = () => {
    const now = new Date();
    setSelectedDate(now);
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    const h = now.getHours() % 12;
    const currentH12 = h === 0 ? 12 : h;
    const currentM = now.getMinutes();
    const currentPeriod = now.getHours() >= 12 ? 'PM' : 'AM';
    setHour12(currentH12);
    setMinute(currentM);
    setPeriod(currentPeriod);
    onChange(now.toISOString());
  };

  const handleClear = () => {
    setSelectedDate(null);
    onChange('');
    setIsOpen(false);
  };

  // Calendar Grid Builder
  const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const calendarCells: {
    day: number;
    month: number;
    year: number;
    isCurrentMonth: boolean;
  }[] = [];

  // Leading days from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    calendarCells.push({
      day: daysInPrevMonth - i,
      month: viewMonth === 0 ? 11 : viewMonth - 1,
      year: viewMonth === 0 ? viewYear - 1 : viewYear,
      isCurrentMonth: false,
    });
  }

  // Days in current month
  for (let i = 1; i <= daysInCurrentMonth; i++) {
    calendarCells.push({
      day: i,
      month: viewMonth,
      year: viewYear,
      isCurrentMonth: true,
    });
  }

  // Trailing days from next month
  const remainingCells = (7 - (calendarCells.length % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    calendarCells.push({
      day: i,
      month: viewMonth === 11 ? 0 : viewMonth + 1,
      year: viewMonth === 11 ? viewYear + 1 : viewYear,
      isCurrentMonth: false,
    });
  }

  const today = new Date();
  const isToday = (cellYear: number, cellMonth: number, cellDay: number) => {
    return (
      today.getFullYear() === cellYear &&
      today.getMonth() === cellMonth &&
      today.getDate() === cellDay
    );
  };

  const isSelectedDay = (cellYear: number, cellMonth: number, cellDay: number) => {
    if (!selectedDate) return false;
    return (
      selectedDate.getFullYear() === cellYear &&
      selectedDate.getMonth() === cellMonth &&
      selectedDate.getDate() === cellDay
    );
  };

  const displayString = selectedDate ? formatDisplayDateTime(computeDate(selectedDate, hour12, minute, period)) : '';

  return (
    <div className="relative w-full">
      {label && (
        <label 
          htmlFor={id} 
          className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Input Display Trigger */}
      <div 
        ref={triggerRef}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
          }
        }}
        className={`relative flex items-center w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-gray-900 shadow-sm cursor-pointer transition select-none ${
          disabled 
            ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-gray-400' 
            : isOpen 
              ? 'border-kits-red ring-2 ring-kits-red/20' 
              : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <span className={`font-mono text-xs sm:text-sm tracking-wide flex-1 ${!displayString ? 'text-gray-400 font-sans' : 'font-semibold text-gray-900'}`}>
          {displayString || placeholder}
        </span>

        <div className="flex items-center gap-1.5 text-gray-400 ml-2">
          {displayString && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="p-1 hover:text-red-600 rounded-md transition"
              title="Clear date"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <Calendar className="h-4 w-4 text-kits-red" />
        </div>
      </div>

      {helperText && <p className="mt-1 text-[11px] text-gray-500">{helperText}</p>}

      {/* Portal Popover Dropdown Attached directly to document.body */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: `${popoverCoords.top}px`,
            left: `${popoverCoords.left}px`,
            width: 'min(330px, calc(100vw - 16px))',
            maxWidth: 'calc(100vw - 16px)',
            boxSizing: 'border-box',
            zIndex: 9999,
          }}
          className="rounded-xl bg-white p-3 sm:p-4 shadow-2xl border border-gray-200 text-gray-900 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Header Navigation */}
          <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2.5">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition"
              title="Previous Month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-900">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition"
              title="Next Month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
            {DAYS_OF_WEEK.map((d) => (
              <span key={d} className="text-[10px] font-extrabold text-gray-400">
                {d}
              </span>
            ))}
          </div>

          {/* Calendar Day Cells */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {calendarCells.map((cell, idx) => {
              const selected = isSelectedDay(cell.year, cell.month, cell.day);
              const currentDay = isToday(cell.year, cell.month, cell.day);

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (cell.isCurrentMonth) {
                      handleSelectDay(cell.day);
                    } else {
                      setViewMonth(cell.month);
                      setViewYear(cell.year);
                      handleSelectDay(cell.day);
                    }
                  }}
                  className={`h-7 w-7 sm:h-8 sm:w-8 text-xs font-semibold rounded-lg flex items-center justify-center transition mx-auto ${
                    selected
                      ? 'bg-kits-red text-white font-bold shadow-sm'
                      : currentDay
                        ? 'bg-red-50 text-kits-red font-bold border border-red-200 hover:bg-red-100'
                        : cell.isCurrentMonth
                          ? 'text-gray-800 hover:bg-gray-100'
                          : 'text-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Time Selector Section */}
          <div className="mt-3.5 pt-3 border-t border-gray-100 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-gray-700 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-kits-blue" />
                Time (12-Hour)
              </span>
              <button
                type="button"
                onClick={handleSetNow}
                className="text-[10px] font-bold text-kits-red hover:underline tracking-normal flex items-center gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                Set Current Time
              </button>
            </div>

            <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-200 gap-2">
              {/* Hour & Minute Pickers */}
              <div className="flex items-center gap-1.5">
                <div className="flex flex-col">
                  <label className="text-[9px] font-extrabold text-gray-400 uppercase mb-0.5">Hour</label>
                  <select
                    value={hour12}
                    onChange={(e) => handleTimeChange(Number(e.target.value), minute, period)}
                    className="bg-white border border-gray-300 text-gray-900 text-xs font-bold rounded px-2 py-1 focus:ring-1 focus:ring-kits-red focus:border-kits-red shadow-2xs"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="text-gray-400 font-bold self-end mb-1">:</span>

                <div className="flex flex-col">
                  <label className="text-[9px] font-extrabold text-gray-400 uppercase mb-0.5">Min</label>
                  <select
                    value={minute}
                    onChange={(e) => handleTimeChange(hour12, Number(e.target.value), period)}
                    className="bg-white border border-gray-300 text-gray-900 text-xs font-bold rounded px-2 py-1 focus:ring-1 focus:ring-kits-red focus:border-kits-red shadow-2xs"
                  >
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                      <option key={m} value={m}>
                        {String(m).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* AM / PM Segmented Control */}
              <div className="flex flex-col">
                <label className="text-[9px] font-extrabold text-gray-400 uppercase mb-0.5">Period</label>
                <div className="flex rounded-md border border-gray-300 bg-white p-0.5 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => handleTimeChange(hour12, minute, 'AM')}
                    className={`px-2.5 py-1 text-xs font-extrabold rounded transition ${
                      period === 'AM'
                        ? 'bg-kits-blue text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900 bg-transparent'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTimeChange(hour12, minute, 'PM')}
                    className={`px-2.5 py-1 text-xs font-extrabold rounded transition ${
                      period === 'PM'
                        ? 'bg-kits-blue text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900 bg-transparent'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs font-bold text-gray-500 hover:text-red-600 transition px-2 py-1"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-black transition shadow-sm"
            >
              <Check className="h-3.5 w-3.5" />
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
