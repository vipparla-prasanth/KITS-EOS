import React, { useState, useRef, useEffect, useCallback } from 'react';
import './DeleteButton.css';

export type DeleteAnimationState = 
  | 'idle' 
  | 'pressing' 
  | 'lid-open' 
  | 'eating' 
  | 'eaten' 
  | 'closing' 
  | 'collapsed';

export interface DeleteButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Text/element to display inside button (can also use children) */
  label?: React.ReactNode;
  /** Existing destructive delete handler from parent */
  onDelete?: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void> | void;
  /** Existing external loading state from parent */
  loading?: boolean;
  /** Optional loading label (for screen readers) */
  loadingLabel?: string;
  /** Destructive visual variant */
  variant?: 'danger' | 'outline' | 'subtle' | 'ghost';
  /** Sizing variant */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Explicit icon pixel size (defaults according to size) */
  iconSize?: number;
  /** Accessible label for screen readers */
  ariaLabel?: string;
  /** Custom additional CSS classes */
  className?: string;
}

export function DeleteButton({
  label = 'Delete',
  children,
  onDelete,
  onClick,
  loading = false,
  loadingLabel = 'Deleting...',
  variant = 'danger',
  size = 'md',
  iconSize,
  disabled = false,
  className = '',
  ariaLabel,
  type = 'button',
  ...rest
}: DeleteButtonProps) {
  const [animState, setAnimState] = useState<DeleteAnimationState>('idle');
  const timersRef = useRef<number[]>([]);
  const isExecutingRef = useRef(false);
  const prevLoadingRef = useRef(loading);

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  // Failure Recovery: If loading transitions from true -> false while collapsed,
  // restore component back to idle state so user can retry safely.
  useEffect(() => {
    if (prevLoadingRef.current && !loading && (animState === 'collapsed' || animState === 'closing' || animState === 'eaten')) {
      clearAllTimers();
      isExecutingRef.current = false;
      setAnimState('idle');
    }
    prevLoadingRef.current = loading;
  }, [loading, animState, clearAllTimers]);

  const resolvedIconSize = iconSize || {
    xs: 13,
    sm: 14,
    md: 15,
    lg: 17,
  }[size];

  // Base styling per size
  const sizeClasses = {
    xs: 'px-2.5 py-1 text-[10px] rounded-lg min-h-[30px]',
    sm: 'px-3.5 py-1.5 text-[11px] rounded-xl min-h-[34px]',
    md: 'px-5 py-2.5 text-xs rounded-xl min-h-[40px]',
    lg: 'px-6 py-3 text-sm rounded-2xl min-h-[46px]',
  }[size];

  // Color variant styling matching KITS-EOS Design System
  const variantClasses = {
    danger: 'bg-kits-red text-white hover:bg-red-700 shadow-2xs active:scale-[0.98]',
    outline: 'bg-white text-kits-red border border-red-200 hover:bg-red-50 hover:border-red-300 shadow-2xs',
    subtle: 'bg-red-50 text-kits-red border border-red-100 hover:bg-red-100 hover:text-red-800 shadow-2xs',
    ghost: 'bg-transparent text-kits-red hover:bg-red-50',
  }[variant];

  const content = children !== undefined ? children : label;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading || isExecutingRef.current) {
      e.preventDefault();
      return;
    }

    // Check for prefers-reduced-motion
    const prefersReducedMotion = 
      typeof window !== 'undefined' && 
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReducedMotion) {
      // Immediate execution without complex motion
      setAnimState('collapsed');
      const handler = onDelete || onClick;
      if (handler) {
        try {
          await handler(e);
        } catch {
          setAnimState('idle');
        }
      }
      return;
    }

    // Begin the deliberate, clearly observable 7-stage micro-interaction sequence (~1.4s total)
    isExecutingRef.current = true;
    clearAllTimers();

    // Stage 2: Immediate tactile press (~100ms)
    setAnimState('pressing');

    // Stage 3: Trash lid opens visibly (~220ms). Text remains 100% visible so user sees lid open first.
    const t1 = window.setTimeout(() => {
      setAnimState('lid-open');
    }, 100);

    // Stage 4: HERO MOMENT - Bin approaches & text visibly slides into the bin mouth (~600ms)
    const t2 = window.setTimeout(() => {
      setAnimState('eating');
    }, 320);

    // Stage 5: Brief pause after eating (~120ms). Empty open bin registers the completed consumption.
    const t3 = window.setTimeout(() => {
      setAnimState('eaten');
    }, 920);

    // Stage 6: Lid closes smoothly (~200ms)
    const t4 = window.setTimeout(() => {
      setAnimState('closing');
    }, 1040);

    // Stage 7: Smooth collapse into compact icon state [ 🗑 ] (~220ms)
    const t5 = window.setTimeout(() => {
      setAnimState('collapsed');
    }, 1240);

    // Initiate parent deletion operation as eating is underway (~600ms)
    // Runs in parallel so backend API is not delayed, while keeping visual flow intact
    const t6 = window.setTimeout(async () => {
      const handler = onDelete || onClick;
      if (handler) {
        try {
          await handler(e);
        } catch {
          // Failure Recovery: Reset on error
          clearAllTimers();
          isExecutingRef.current = false;
          setAnimState('idle');
        }
      }
    }, 600);

    timersRef.current.push(t1, t2, t3, t4, t5, t6);
  };

  const isCollapsedState = animState === 'collapsed' || (loading && animState !== 'idle');
  const accessibleLabel = ariaLabel || (typeof content === 'string' ? content : 'Delete');

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled || loading || (isExecutingRef.current && animState !== 'idle')}
      aria-label={isCollapsedState ? (loading ? loadingLabel : accessibleLabel) : accessibleLabel}
      aria-busy={loading}
      className={`kits-delete-btn state-${animState} ${variantClasses} ${sizeClasses} font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer ${className}`}
      {...rest}
    >
      {/* Centered Trash Icon / Loader */}
      <span className="kits-delete-icon-wrapper" aria-hidden="true">
        {loading && isCollapsedState ? (
          <svg
            width={resolvedIconSize}
            height={resolvedIconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kits-delete-spinner text-current"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg
            width={resolvedIconSize}
            height={resolvedIconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kits-delete-trash-svg"
          >
            {/* Trash Lid Group (hinged at left tip x=3, y=6) */}
            <g className="kits-delete-trash-lid">
              <path d="M3 6h18" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </g>
            {/* Trash Bin Body Group */}
            <g className="kits-delete-trash-body">
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <line x1="10" x2="10" y1="11" y2="17" />
              <line x1="14" x2="14" y1="11" y2="17" />
            </g>
          </svg>
        )}
      </span>

      {/* Clipped & Animated Label */}
      <span className="kits-delete-label-clipper">
        <span className="kits-delete-label-text">
          {content}
        </span>
      </span>
    </button>
  );
}
