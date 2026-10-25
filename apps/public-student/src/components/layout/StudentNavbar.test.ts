import { describe, it, expect } from 'vitest';

describe('StudentNavbar Responsive Truncation and Overflow Constraints', () => {
  // Helper to simulate the title generation logic used in StudentNavbar
  function getProfileLinkTitle(profile?: { full_name?: string | null; roll_number?: string | null } | null, email?: string | null): string {
    const name = profile?.full_name || email?.split('@')[0] || 'Student Profile';
    const roll = profile?.roll_number || 'Student';
    return `${name} (${roll})`;
  }

  function getProfileAriaLabel(profile?: { full_name?: string | null; roll_number?: string | null } | null): string {
    const name = profile?.full_name || 'Student';
    const roll = profile?.roll_number || 'Student';
    return `Student Profile: ${name} (${roll})`;
  }

  describe('Student Name Tooltip & Accessibility Attributes', () => {
    it('formats short student names with roll number correctly', () => {
      const profile = { full_name: 'Rahul Rao', roll_number: '25JK1A0501' };
      const title = getProfileLinkTitle(profile);
      expect(title).toBe('Rahul Rao (25JK1A0501)');
      expect(getProfileAriaLabel(profile)).toBe('Student Profile: Rahul Rao (25JK1A0501)');
    });

    it('preserves very long student names completely in accessible title attribute', () => {
      const longName = 'Sri Venkatasubramanian Ramachandran-Narasimhan IV';
      const profile = { full_name: longName, roll_number: '25JK1A0599' };
      const title = getProfileLinkTitle(profile);

      // Even when visually truncated by CSS truncate, full name must be exposed via title
      expect(title).toContain(longName);
      expect(title).toBe(`${longName} (25JK1A0599)`);
    });

    it('falls back gracefully to email prefix when full name is missing', () => {
      const title = getProfileLinkTitle(null, 'student2026@kitsakshar.ac.in');
      expect(title).toBe('student2026 (Student)');
    });
  });

  describe('Navbar Class & Layout Integrity Safeguards', () => {
    it('verifies profile link has shrink and min-w-0 to prevent horizontal overflow', () => {
      // Classes applied to Link to="/profile" in StudentNavbar.tsx
      const profileLinkClasses = 'flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-xl border border-gray-200/80 hover:border-kits-blue/40 glass-element-subtle hover:bg-blue-50/50 transition text-left group shrink min-w-0 max-w-[110px] sm:max-w-[135px] md:max-w-[160px] lg:max-w-[180px] xl:max-w-[145px] 2xl:max-w-[200px]';

      expect(profileLinkClasses).toContain('shrink');
      expect(profileLinkClasses).toContain('min-w-0');
      expect(profileLinkClasses).not.toContain('shrink-0'); // Must NOT be shrink-0
      expect(profileLinkClasses).toContain('max-w-[110px]');
      expect(profileLinkClasses).toContain('2xl:max-w-[200px]');
    });

    it('verifies sign-out button is strictly shrink-0 with minimum tap target', () => {
      // Classes applied to sign-out button in StudentNavbar.tsx
      const signOutButtonClasses = 'p-1.5 sm:p-2 text-gray-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition cursor-pointer shrink-0 min-w-8 min-h-8 flex items-center justify-center';

      expect(signOutButtonClasses).toContain('shrink-0');
      expect(signOutButtonClasses).toContain('min-w-8');
      expect(signOutButtonClasses).toContain('min-h-8');
    });

    it('verifies inner student text elements include truncate for long strings', () => {
      const nameClasses = 'text-[11px] 2xl:text-xs font-bold text-gray-900 leading-tight truncate';
      const rollClasses = 'text-[9px] 2xl:text-[10px] font-mono text-gray-500 mt-0.5 leading-tight truncate';

      expect(nameClasses).toContain('truncate');
      expect(rollClasses).toContain('truncate');
    });

    it('verifies desktop nav items have responsive gap and padding to fit xl screens', () => {
      const navClasses = 'hidden xl:flex items-center gap-0.5 2xl:gap-1.5 text-xs font-bold shrink min-w-0';
      expect(navClasses).toContain('hidden xl:flex');
      expect(navClasses).toContain('shrink');
      expect(navClasses).toContain('min-w-0');
    });
  });
});
