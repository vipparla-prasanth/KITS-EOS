import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import {
  PINNED_COLLEGES,
  APPROVED_COLLEGES,
  STANDARD_COLLEGES,
  OTHER_COLLEGE_OPTION,
  isStandardCollege
} from '../constants/academic';

export interface CollegeSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  label?: string;
  id?: string;
  name?: string;
  className?: string;
  error?: string;
  size?: 'sm' | 'md';
  autoFocus?: boolean;
}

/**
 * Production-ready Searchable College Selection Combobox for KITS-EOS.
 * 
 * Features:
 * - Pinned top 2 institutions (KITS Akshar & KKR & KSR)
 * - 36 approved state colleges in preserved order
 * - Search by partial substring matching (case-insensitive)
 * - 'Other' option with immediate custom input revelation
 * - Full backward compatibility with legacy custom stored colleges
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 * - Touch-friendly mobile layout with responsive popover
 */
export function CollegeSelect({
  value = '',
  onChange,
  disabled = false,
  required = false,
  placeholder = 'Search or Select College 🔍',
  label,
  id,
  name,
  className = '',
  error,
  size = 'md',
  autoFocus = false
}: CollegeSelectProps) {
  const generatedId = useId();
  const selectId = id || `college-select-${generatedId}`;
  const customInputId = `${selectId}-custom`;

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  // Determine if the current value is custom (not in standard predefined list)
  const isValueStandard = useMemo(() => isStandardCollege(value), [value]);

  // Track if "Other" mode is active
  const [isOtherSelected, setIsOtherSelected] = useState<boolean>(() => {
    if (!value) return false;
    return !isStandardCollege(value);
  });

  // Synchronize isOtherSelected if value updates externally
  useEffect(() => {
    if (value) {
      if (isStandardCollege(value)) {
        setIsOtherSelected(false);
      } else {
        setIsOtherSelected(true);
      }
    }
  }, [value]);

  // Standard college matched name if any
  const matchedStandardName = useMemo(() => {
    if (!value) return '';
    const trimmed = value.trim().toLowerCase();
    const found = STANDARD_COLLEGES.find(c => c.toLowerCase() === trimmed);
    return found || '';
  }, [value]);

  // Filtered colleges based on search query
  const filteredPinned = useMemo(() => {
    if (!searchQuery.trim()) return PINNED_COLLEGES;
    const q = searchQuery.toLowerCase().trim();
    return PINNED_COLLEGES.filter(c => c.toLowerCase().includes(q));
  }, [searchQuery]);

  const filteredApproved = useMemo(() => {
    if (!searchQuery.trim()) return APPROVED_COLLEGES;
    const q = searchQuery.toLowerCase().trim();
    return APPROVED_COLLEGES.filter(c => c.toLowerCase().includes(q));
  }, [searchQuery]);

  const isOtherMatching = useMemo(() => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return OTHER_COLLEGE_OPTION.toLowerCase().includes(q) || 'custom'.includes(q);
  }, [searchQuery]);

  // Flattened visible options for keyboard navigation
  const visibleOptions = useMemo(() => {
    const list: string[] = [...filteredPinned, ...filteredApproved];
    if (isOtherMatching) {
      list.push(OTHER_COLLEGE_OPTION);
    }
    return list;
  }, [filteredPinned, filteredApproved, isOtherMatching]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(-1);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 30);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listboxRef.current) {
      const activeEl = listboxRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelectStandard = (college: string) => {
    setIsOtherSelected(false);
    onChange(college);
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const handleSelectOther = () => {
    setIsOtherSelected(true);
    // If transitioning from a standard college, initialize with empty string for user to type
    if (isValueStandard) {
      onChange('');
    }
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
    setTimeout(() => {
      customInputRef.current?.focus();
    }, 60);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => {
          const next = prev + 1;
          return next >= visibleOptions.length ? 0 : next;
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => {
          const next = prev - 1;
          return next < 0 ? visibleOptions.length - 1 : next;
        });
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visibleOptions.length) {
          const chosen = visibleOptions[highlightedIndex];
          if (chosen === OTHER_COLLEGE_OPTION) {
            handleSelectOther();
          } else {
            handleSelectStandard(chosen);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  // Determine display label on the trigger button
  const displayLabel = useMemo(() => {
    if (isOtherSelected) {
      return value.trim() ? `Other: ${value.trim()}` : 'Other (Enter college below)';
    }
    if (matchedStandardName) {
      return matchedStandardName;
    }
    if (value && !isValueStandard) {
      return `Other: ${value}`;
    }
    return '';
  }, [isOtherSelected, value, matchedStandardName, isValueStandard]);

  const isCompact = size === 'sm';

  return (
    <div ref={containerRef} className={`relative w-full space-y-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={selectId}
          className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Main Combobox Trigger Button */}
      <div className="relative">
        <button
          type="button"
          id={selectId}
          name={name}
          disabled={disabled}
          autoFocus={autoFocus}
          onClick={() => !disabled && setIsOpen(prev => !prev)}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={label ? selectId : undefined}
          className={`w-full flex items-center justify-between text-left transition-all outline-none border ${
            isCompact ? 'px-3 py-2 text-xs rounded-lg' : 'px-3.5 py-2.5 text-xs rounded-xl'
          } ${
            disabled
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : error
              ? 'bg-white text-gray-900 border-red-400 focus:ring-1 focus:ring-red-200'
              : isOpen
              ? 'bg-white text-gray-900 border-kits-blue ring-1 ring-blue-100'
              : 'bg-white text-gray-900 border-gray-300 hover:border-gray-400 focus:border-kits-blue focus:ring-1 focus:ring-kits-blue'
          }`}
        >
          <div className="flex items-center gap-2 truncate pr-2">
            {/* Institution Building Icon */}
            <svg
              className={`shrink-0 w-3.5 h-3.5 ${
                displayLabel ? 'text-kits-blue' : 'text-gray-400'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>

            <span className={`truncate font-medium ${displayLabel ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}>
              {displayLabel || placeholder}
            </span>
          </div>

          {/* Chevron Indicator */}
          <svg
            className={`shrink-0 w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-kits-blue' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          className={`absolute left-0 right-0 z-50 mt-1 bg-white border border-gray-200 ${
            isCompact ? 'rounded-lg' : 'rounded-xl'
          } shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100`}
          style={{ minWidth: '260px' }}
        >
          {/* Search Box Header */}
          <div className="p-2 border-b border-gray-100 bg-gray-50/90 sticky top-0 z-10">
            <div className="relative flex items-center">
              <svg
                className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>

              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search college or institution..."
                autoComplete="off"
                spellCheck={false}
                className="w-full pl-7.5 pr-7 py-1.5 text-xs bg-white border border-gray-200 rounded-md font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              />

              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 p-0.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Colleges List */}
          <ul
            ref={listboxRef}
            role="listbox"
            className="max-h-48 sm:max-h-52 overflow-y-auto overscroll-contain divide-y divide-gray-50 text-xs py-0.5 focus:outline-none"
          >
            {visibleOptions.length === 0 ? (
              <li className="px-3 py-4 text-center text-gray-500">
                <p className="font-semibold text-gray-700">No colleges matched "{searchQuery}"</p>
                <button
                  type="button"
                  onClick={handleSelectOther}
                  className="mt-1 text-xs text-kits-blue font-bold hover:underline cursor-pointer"
                >
                  Enter custom college name →
                </button>
              </li>
            ) : (
              <>
                {/* Pinned Colleges Section */}
                {filteredPinned.length > 0 && (
                  <div className="bg-blue-50/25">
                    <div className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-kits-blue flex items-center justify-between">
                      <span>Featured / Host</span>
                    </div>
                    {filteredPinned.map((college) => {
                      const isSelected = matchedStandardName.toLowerCase() === college.toLowerCase();
                      const globalIdx = visibleOptions.indexOf(college);
                      const isHighlighted = globalIdx === highlightedIndex;

                      return (
                        <li
                          key={college}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelectStandard(college)}
                          onMouseEnter={() => setHighlightedIndex(globalIdx)}
                          className={`px-2.5 py-1.5 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50 text-kits-blue font-bold'
                              : isHighlighted
                              ? 'bg-gray-100 text-gray-900 font-medium'
                              : 'text-gray-800 hover:bg-gray-50 font-medium'
                          }`}
                        >
                          <span className="truncate pr-2" title={college}>{college}</span>
                          {isSelected ? (
                            <svg className="w-3.5 h-3.5 text-kits-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span className="shrink-0 text-[8.5px] font-bold px-1.5 py-0.2 rounded bg-blue-100/60 text-kits-blue">Host</span>
                          )}
                        </li>
                      );
                    })}
                  </div>
                )}

                {/* Approved Colleges Section */}
                {filteredApproved.length > 0 && (
                  <div>
                    {!searchQuery && (
                      <div className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-gray-400 bg-gray-50/50">
                        All Approved Institutions
                      </div>
                    )}
                    {filteredApproved.map((college) => {
                      const isSelected = matchedStandardName.toLowerCase() === college.toLowerCase();
                      const globalIdx = visibleOptions.indexOf(college);
                      const isHighlighted = globalIdx === highlightedIndex;

                      return (
                        <li
                          key={college}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelectStandard(college)}
                          onMouseEnter={() => setHighlightedIndex(globalIdx)}
                          className={`px-2.5 py-1.5 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50 text-kits-blue font-bold'
                              : isHighlighted
                              ? 'bg-gray-100 text-gray-900 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <span className="truncate pr-2" title={college}>{college}</span>
                          {isSelected && (
                            <svg className="w-3.5 h-3.5 text-kits-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </li>
                      );
                    })}
                  </div>
                )}

                {/* Other Option */}
                {isOtherMatching && (
                  <div className="pt-0.5 border-t border-gray-100 bg-gray-50/50">
                    {(() => {
                      const globalIdx = visibleOptions.indexOf(OTHER_COLLEGE_OPTION);
                      const isHighlighted = globalIdx === highlightedIndex;

                      return (
                        <li
                          role="option"
                          aria-selected={isOtherSelected}
                          onClick={handleSelectOther}
                          onMouseEnter={() => setHighlightedIndex(globalIdx)}
                          className={`px-2.5 py-1.5 flex items-center justify-between cursor-pointer transition-colors ${
                            isOtherSelected
                              ? 'bg-blue-50 text-kits-blue font-bold'
                              : isHighlighted
                              ? 'bg-gray-100 text-gray-900 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold">Other</span>
                            <span className="text-[9.5px] text-gray-400 font-normal">
                              (Enter custom institution)
                            </span>
                          </div>
                          {isOtherSelected && (
                            <svg className="w-3.5 h-3.5 text-kits-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </li>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
          </ul>
        </div>
      )}

      {/* Custom College Text Input (Revealed strictly when 'Other' is selected) */}
      {isOtherSelected && (
        <div className="space-y-1 pt-1 animate-in fade-in duration-150">
          <label
            htmlFor={customInputId}
            className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-500"
          >
            Please enter your college name {required && <span className="text-red-500">*</span>}
          </label>
          <input
            ref={customInputRef}
            type="text"
            id={customInputId}
            name={`${name || 'college'}_custom`}
            required={required}
            disabled={disabled}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="Please enter your college name"
            className={`w-full text-xs bg-white border font-medium text-gray-900 placeholder-gray-400 transition-all ${
              isCompact ? 'px-3 py-2 rounded-lg' : 'px-3.5 py-2.5 rounded-xl'
            } ${
              error || (required && isOtherSelected && !value.trim())
                ? 'border-amber-400 focus:border-kits-blue focus:ring-1 focus:ring-kits-blue ring-1 ring-amber-100'
                : 'border-gray-300 focus:border-kits-blue focus:ring-1 focus:ring-kits-blue'
            }`}
          />
        </div>
      )}

      {error && <p className="text-[11px] font-medium text-red-500 mt-1">{error}</p>}
    </div>
  );
}
