import React, { useState, forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  wrapperClassName?: string;
  leftIcon?: React.ReactNode;
  iconClassName?: string;
}

/**
 * Institutional PasswordInput Component with Accessible Eye-Toggle UX.
 * - Masked by default (type="password")
 * - Unmasks to plain text on toggle (type="text")
 * - Independent local state per field instance
 * - Zero persistence, zero logging, zero clipboard side-effects
 * - Accessible button with type="button" and appropriate aria-labels
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      className = '',
      wrapperClassName = '',
      leftIcon,
      iconClassName = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
      <div className={`relative flex items-center w-full ${wrapperClassName}`}>
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          type={isVisible ? 'text' : 'password'}
          disabled={disabled}
          className={`${className} ${leftIcon ? 'pl-9' : ''} pr-10`}
          {...props}
        />
        <button
          type="button"
          tabIndex={0}
          disabled={disabled}
          onClick={() => setIsVisible((prev) => !prev)}
          className={`absolute right-0 inset-y-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-hidden focus:text-gray-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none ${iconClassName}`}
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          aria-pressed={isVisible}
          title={isVisible ? 'Hide password' : 'Show password'}
        >
          {isVisible ? (
            <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';
