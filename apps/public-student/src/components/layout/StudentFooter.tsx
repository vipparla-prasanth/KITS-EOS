import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Mail, Phone, MapPin, Globe, FileSpreadsheet } from 'lucide-react';
import { openCookiePreferencesModal } from '@kits-eos/shared';
import { CampusLocationModal } from '../ui/CampusLocationModal';
import { downloadEventDirectoryExcel } from '../../services/eventDirectoryService';

interface SocialLinkItem {
  name: string;
  label: string;
  url: string;
  hoverClass: string;
  icon: (props: { className?: string }) => React.JSX.Element;
}

const SOCIAL_LINKS: readonly SocialLinkItem[] = [
  {
    name: 'Instagram',
    label: 'KITS Akshar on Instagram',
    url: 'https://www.instagram.com/kitsakshar',
    hoverClass: 'hover:text-kits-red hover:border-kits-red/40 hover:bg-red-50/50',
    icon: ({ className = 'w-4 h-4' }) => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
      </svg>
    ),
  },
  {
    name: 'LinkedIn',
    label: 'KITS Akshar on LinkedIn',
    url: 'https://www.linkedin.com/company/kitsakshar',
    hoverClass: 'hover:text-kits-blue hover:border-kits-blue/40 hover:bg-blue-50/50',
    icon: ({ className = 'w-4 h-4' }) => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect width="4" height="12" x="2" y="9" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    ),
  },
  {
    name: 'YouTube',
    label: 'KITS Akshar on YouTube',
    url: 'https://www.youtube.com/@kitsAkshar',
    hoverClass: 'hover:text-kits-red hover:border-kits-red/40 hover:bg-red-50/50',
    icon: ({ className = 'w-4 h-4' }) => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
        <path d="m10 15 5-3-5-3z" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: 'Facebook',
    label: 'KITS Akshar on Facebook',
    url: 'https://www.facebook.com/kitsAkshar/',
    hoverClass: 'hover:text-kits-blue hover:border-kits-blue/40 hover:bg-blue-50/50',
    icon: ({ className = 'w-4 h-4' }) => (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    ),
  },
];

export function StudentFooter() {
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadDirectory = async () => {
    try {
      setIsDownloading(true);
      await downloadEventDirectoryExcel();
    } catch (err: any) {
      console.error('Failed to download event directory:', err);
      alert(err.message || 'Unable to generate the Event Directory. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };
  return (
    <footer className="bg-white border-t border-gray-200 mt-auto pt-10 pb-8 font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8">
          {/* Column 1: Institutional Brand & Identity */}
          <div className="space-y-3 sm:col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3">
              <img
                src="/college_logo.png"
                alt="KITS Logo"
                className="h-10 w-10 object-contain shrink-0"
              />
              <div>
                <div className="text-sm font-black tracking-tight text-gray-900 leading-tight">
                  <span className="text-kits-red font-black">KITS</span>{' '}
                  <span className="text-kits-blue font-black">Akshar</span> Institute of Technology
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 mt-0.5">
                  KITS-EOS • Event Operations System
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed max-w-md font-normal">
              The centralized campus event platform providing seamless student registration, tamper-evident 
              QR tokens, real-time coordinator attendance check-ins, and cryptographically verifiable digital certificates.
            </p>

            {/* Official Contact Summary */}
            <div className="pt-2 space-y-1.5 text-xs text-gray-600">
              <button
                type="button"
                onClick={() => setIsMapModalOpen(true)}
                className="flex items-start gap-2 text-left hover:text-kits-red transition cursor-pointer group"
                title="Click to view interactive Campus Location Map"
              >
                <MapPin className="h-3.5 w-3.5 text-kits-red shrink-0 mt-0.5 group-hover:scale-110 transition" />
                <span className="text-[11px] text-gray-600 group-hover:text-kits-red leading-snug font-medium underline-offset-2 hover:underline">
                  NH16, Opp. Katuri Medical College, Yanamadala, Guntur, AP 522019 (View Map)
                </span>
              </button>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-kits-blue shrink-0" />
                <div className="flex items-center gap-2 text-[11px]">
                  <a href="tel:0863-2288887" className="hover:text-kits-blue font-mono transition">0863-2288887</a>
                  <span>•</span>
                  <a href="tel:0863-2288886" className="hover:text-kits-blue font-mono transition">0863-2288886</a>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-kits-red shrink-0" />
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <a href="mailto:principalkitsakshar@gmail.com" className="hover:text-kits-blue font-mono transition">principalkitsakshar@gmail.com</a>
                </div>
              </div>
            </div>

            {/* Official Social Media Channels */}
            <div className="pt-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-2">
                Connect With Us
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {SOCIAL_LINKS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <a
                      key={item.name}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={item.label}
                      title={item.label}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-kits-blue focus-visible:ring-offset-1 ${item.hoverClass}`}
                    >
                      <Icon className="w-4 h-4" />
                    </a>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Column 2: CAMPUS OPERATIONS */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
              Campus Operations
            </h4>
            <ul className="space-y-1.5 text-xs text-gray-600">
              <li>
                <Link to="/" className="hover:text-kits-red transition">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/about-keos" className="hover:text-kits-red transition">
                  About K-EOS
                </Link>
              </li>
              <li>
                <Link to="/events" className="hover:text-kits-red transition">
                  Explore Events
                </Link>
              </li>
              <li>
                <Link to="/vision" className="hover:text-kits-blue transition">
                  Our Visionaries
                </Link>
              </li>
              <li>
                <Link to="/contact-coordinators" className="hover:text-kits-red transition">
                  Contact Coordinators
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setIsMapModalOpen(true)}
                  className="hover:text-kits-red transition cursor-pointer text-left flex items-center gap-1 text-xs text-gray-600"
                >
                  <span>Campus Location / Map</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={handleDownloadDirectory}
                  disabled={isDownloading}
                  className="hover:text-kits-blue font-bold text-kits-blue transition cursor-pointer text-left flex items-center gap-1.5 text-xs disabled:opacity-50"
                  title="Download official Event, Venue & Coordinator Directory (.xlsx)"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>{isDownloading ? 'Generating Directory...' : 'Event Directory (.xlsx)'}</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: KITS PORTAL */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
              KITS Portal
            </h4>
            <ul className="space-y-1.5 text-xs text-gray-600">
              <li>
                <a 
                  href="https://www.kitsakshar.ac.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-bold text-kits-blue hover:text-blue-800 transition group"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span>Official KITS Portal</span>
                  <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100 transition" />
                </a>
              </li>
              <li className="text-[11px] text-gray-400 leading-relaxed pt-1">
                Access official college notifications, academic calendar, department faculty, and institutional information.
              </li>
            </ul>
          </div>

          {/* Column 4: VERIFICATION & SUPPORT */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
              Verification & Support
            </h4>
            <ul className="space-y-1.5 text-xs text-gray-600">
              <li>
                <Link to="/verify-certificate" className="hover:text-kits-blue font-semibold transition">
                  Verify Certificate
                </Link>
              </li>
              <li>
                <Link to="/tech-support#team-keos" className="hover:text-kits-red font-bold text-gray-800 transition">
                  Team KEOS
                </Link>
              </li>
              <li>
                <Link to="/tech-support" className="hover:text-kits-blue transition">
                  Tech Support & FAQs
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-gray-900 transition">
                  Terms & Conditions
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-gray-900 transition">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={openCookiePreferencesModal}
                  className="hover:text-kits-blue transition text-left cursor-pointer"
                >
                  Cookie Preferences
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Copyright */}
        <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <div>
            &copy; {new Date().getFullYear()} <strong className="text-gray-900">KITS Akshar Institute of Technology</strong>. All rights reserved.
          </div>
          <div className="text-[11px] text-gray-400 font-medium">
            Student Event Operations & Registration Ecosystem
          </div>
        </div>
      </div>

      {/* Campus Location Map Modal */}
      <CampusLocationModal
        isOpen={isMapModalOpen}
        onClose={() => setIsMapModalOpen(false)}
      />
    </footer>
  );
}
