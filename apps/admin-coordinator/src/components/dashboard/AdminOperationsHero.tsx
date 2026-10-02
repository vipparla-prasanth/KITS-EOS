import { Link } from 'react-router-dom';
import { OperationsLottiePlayer } from '../ui/OperationsLottiePlayer';
import { Calendar, Users, Plus, ShieldCheck } from 'lucide-react';

export function AdminOperationsHero() {
  return (
    <div className="bg-white rounded-3xl border border-gray-200/90 shadow-2xs p-5 sm:p-7 lg:p-8 relative overflow-hidden page-enter">
      
      {/* Ambient background glow accents */}
      <div className="absolute -top-12 -right-12 w-64 h-64 bg-blue-50/60 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute -bottom-12 left-1/3 w-64 h-64 bg-red-50/40 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 sm:gap-8">
        
        {/* Context & Quick Operational Actions */}
        <div className="flex-1 space-y-4 text-left">
          
          {/* 1. Institutional Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-kits-blue text-[10px] sm:text-[11px] font-black uppercase tracking-wider shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-kits-red animate-pulse" />
            <span>KITS-EOS CENTRAL OPERATIONS</span>
          </div>

          {/* 2. Hero Heading & Description */}
          <div className="space-y-1.5">
            <h1 className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-black text-gray-900 tracking-tight leading-tight">
              Central Event Operations
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 leading-relaxed max-w-xl font-medium">
              Manage flagship events, student registrations, attendance check-ins, fee collections, 
              coordinators, and institutional operations from one place.
            </p>
          </div>

          {/* 3. Operational Action Buttons (Touch Target >= 44px) */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-1">
            <Link
              to="/admin/events"
              className="w-full sm:w-auto inline-flex items-center justify-center px-4.5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 shadow-2xs active:scale-95 transition min-h-[44px] cursor-pointer"
            >
              <Calendar className="mr-1.5 h-4 w-4" />
              <span>View Events</span>
            </Link>

            <Link
              to="/admin/students"
              className="w-full sm:w-auto inline-flex items-center justify-center px-4.5 py-2.5 rounded-xl bg-white border border-gray-300 text-gray-700 hover:text-kits-blue hover:border-kits-blue hover:bg-blue-50/40 text-xs font-black uppercase tracking-wider shadow-2xs active:scale-95 transition min-h-[44px] cursor-pointer"
            >
              <Users className="mr-1.5 h-4 w-4" />
              <span>Manage Students</span>
            </Link>

            <Link
              to="/admin/events/new"
              className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-bold uppercase tracking-wider transition min-h-[44px] cursor-pointer"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              <span>New Event</span>
            </Link>
          </div>

          {/* 4. Live Status Strip */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-[10px] sm:text-[11px] font-bold text-gray-400 pt-2 border-t border-gray-100">
            <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live Database Sync Active
            </span>
            <span className="hidden sm:inline">•</span>
            <span className="flex items-center gap-1 text-gray-500">
              <ShieldCheck className="h-3.5 w-3.5 text-kits-blue" />
              Administrative Privileges Confirmed
            </span>
          </div>

        </div>

        {/* 5. Compact Operations Analyst Lottie Animation */}
        {/* On mobile: Compact width 160-190px, height 120-142px, centered, zero vertical stretching */}
        {/* On desktop: 260px width, 195px height */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 flex items-center justify-center relative pt-1 lg:pt-0">
          <div className="w-[160px] sm:w-[190px] lg:w-[260px] h-[120px] sm:h-[142px] lg:h-[195px] flex items-center justify-center relative">
            {/* Subtle backdrop disc */}
            <div className="absolute inset-0 bg-radial from-blue-100/50 to-transparent rounded-full blur-xl -z-10" />
            <OperationsLottiePlayer
              className="w-full h-full"
              altText="KITS-EOS Operations Analyst Reviewing Real-Time Dashboard"
            />
          </div>
        </div>

      </div>

    </div>
  );
}
export default AdminOperationsHero;
