import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  X, 
  ChevronRight, 
  ExternalLink, 
  RotateCcw,
  Search
} from 'lucide-react';

interface FaqItem {
  id: number;
  question: string;
  category: 'REGISTRATION' | 'ATTENDANCE' | 'CERTIFICATES' | 'PAYMENT' | 'SUPPORT' | 'INSTITUTION';
  answer: string;
  actionLink?: {
    to: string;
    label: string;
    isExternal?: boolean;
  };
}

const PREDEFINED_QUESTIONS: FaqItem[] = [
  {
    id: 1,
    question: "How do I register for an event?",
    category: 'REGISTRATION',
    answer: "Browse available symposium events under the 'Events' catalog. Select your preferred technical or cultural event, choose Solo or Team participation, fill in required participant details (name, roll number, college), and submit. If a fee applies, you can pay via UPI or Cash on Desk (COD).",
    actionLink: { to: '/events', label: 'Explore Events' }
  },
  {
    id: 2,
    question: "How do I download my Attendance QR Pass?",
    category: 'ATTENDANCE',
    answer: "Go to 'My Passes' (/my-registrations) from the navigation bar. For any confirmed event, click the 'QR Pass' button. You can show this QR token on your screen or download it as a high-resolution PNG document for check-in at the venue desk.",
    actionLink: { to: '/my-registrations', label: 'Go to My Passes' }
  },
  {
    id: 3,
    question: "How do I get my Digital Event ID Card?",
    category: 'REGISTRATION',
    answer: "On the 'My Passes' page, click 'View ID Card' next to your registration entry. Your official digital card contains your roll number, institution name, registered category, and an embedded QR badge. You can save it as PDF or PNG.",
    actionLink: { to: '/my-registrations', label: 'View ID Cards' }
  },
  {
    id: 4,
    question: "Where can I view competition results and winners?",
    category: 'CERTIFICATES',
    answer: "Navigate to 'Results' (/certificates) in the top navbar. Once the coordinator jury evaluates a round and publishes the scores, 1st, 2nd, and 3rd place podium winners along with their official certificate codes will be listed there.",
    actionLink: { to: '/certificates', label: 'View Results' }
  },
  {
    id: 5,
    question: "How do I download and verify my Certificate?",
    category: 'CERTIFICATES',
    answer: "Under 'Results' (/certificates), locate your event card. Once attendance and feedback are completed, click 'View & Download Certificate'. You can download the certificate as a vector-grade PDF or high-resolution PNG, and verify its authenticity online using the unique 16-character code.",
    actionLink: { to: '/verify-certificate', label: 'Verify Certificate' }
  },
  {
    id: 6,
    question: "Why is my certificate locked?",
    category: 'CERTIFICATES',
    answer: "Certificates require two mandatory milestones: 1) Your attendance must be checked in by an authorized coordinator with your QR pass, and 2) You must submit brief feedback on the event experience. Once both criteria are met, your certificate unlocks instantly.",
    actionLink: { to: '/my-registrations', label: 'Submit Feedback' }
  },
  {
    id: 7,
    question: "What is Cash on Desk (COD) payment and how do I complete it?",
    category: 'PAYMENT',
    answer: "If you chose Cash on Desk (COD) during registration, your pass status remains 'PAYMENT PENDING'. Visit the central event operations desk or meet your assigned sub-event coordinator listed under 'Payment Instructions' in My Passes to pay in cash and get your receipt.",
    actionLink: { to: '/contact-coordinators', label: 'Contact Coordinators' }
  },
  {
    id: 8,
    question: "How does team registration work?",
    category: 'REGISTRATION',
    answer: "The team leader registers first and enters the names, roll numbers, departments, and colleges of all team members. All team members receive individual attendance QR passes and personalized digital certificates once registered.",
    actionLink: { to: '/events', label: 'Browse Team Events' }
  },
  {
    id: 9,
    question: "How do coordinators mark my attendance at the venue?",
    category: 'ATTENDANCE',
    answer: "Coordinators use their dedicated K-EOS scanner terminal to scan the QR pass on your phone or printed pass. Once scanned, your attendance is cryptographically verified in the database in real time.",
    actionLink: { to: '/attendance', label: 'Check Attendance Status' }
  },
  {
    id: 10,
    question: "What should I do if I have an attendance conflict?",
    category: 'ATTENDANCE',
    answer: "If your check-in was missed or there was a technical glitch at the venue desk, visit the Central Control Room (Admin Block Ground Floor) or submit an Attendance Grievance Ticket via the Helpdesk.",
    actionLink: { to: '/complaints', label: 'Log Attendance Ticket' }
  },
  {
    id: 11,
    question: "Who can I contact for technical issues or portal bugs?",
    category: 'SUPPORT',
    answer: "Reach out to Team KEOS directly or email principalkitsakshar@gmail.com / principal@kitsakshar.ac.in. You can also call the campus technical helpline at 0863-2288887 or 0863-2288886.",
    actionLink: { to: '/tech-support#team-keos', label: 'Team KEOS Contact' }
  },
  {
    id: 12,
    question: "Who are the core developers of Team KEOS?",
    category: 'SUPPORT',
    answer: "Team KEOS was architected and engineered by:\n1. PRASANTH VIPPARLA (+91 7013884363, prasanthv865@gmail.com)\n2. MANOJ HRUTHVIK BANDLAMUDI (+91 8019043388, hruthvikmanoj4608@gmail.com)\n3. SAI DEEPAK ABBU (+91 9247231179, saideepak4408@gmail.com).",
    actionLink: { to: '/tech-support#team-keos', label: 'View Developer Profiles' }
  },
  {
    id: 13,
    question: "How do I submit a grievance or support ticket?",
    category: 'SUPPORT',
    answer: "Click 'Help & Grievances' under Services in the top navigation or go to /complaints. Select the category (Schedule, Attendance, Payment, or Certificate), describe the issue, and our operations team will resolve it within 24 hours.",
    actionLink: { to: '/complaints', label: 'Open Support Desk' }
  },
  {
    id: 14,
    question: "What is the official campus helpline and college address?",
    category: 'INSTITUTION',
    answer: "Campus Address: KITS Akshar Institute of Technology, NH16, Opposite Katuri Medical College, Yanamadala, Guntur, Andhra Pradesh 522019.\nPhone Helplines: 0863-2288887, 0863-2288886.\nOfficial Emails: principalkitsakshar@gmail.com, principal@kitsakshar.ac.in.",
    actionLink: { to: '/tech-support', label: 'View Campus Info' }
  },
  {
    id: 15,
    question: "How do I access the official KITS College Portal?",
    category: 'INSTITUTION',
    answer: "The official institutional website of KITS Akshar Institute of Technology is https://www.kitsakshar.ac.in/. You can find college academic schedules, departmental faculties, NAAC credentials, and circulars there.",
    actionLink: { to: 'https://www.kitsakshar.ac.in/', label: 'Open kitsakshar.ac.in', isExternal: true }
  }
];

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  actionLink?: {
    to: string;
    label: string;
    isExternal?: boolean;
  };
  timestamp: string;
}

export function KeosAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-welcome',
      sender: 'assistant',
      text: "Hello! I am your K-EOS Assistant 🤖. How can I assist you today? Click any question below to get verified institutional guidance.",
      timestamp: 'Just now'
    }
  ]);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Handle Escape key to close panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSelectQuestion = (item: FaqItem) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: item.question,
      timestamp: timeStr
    };

    const assistantMsg: ChatMessage = {
      id: `asst-${Date.now() + 1}`,
      sender: 'assistant',
      text: item.answer,
      actionLink: item.actionLink,
      timestamp: timeStr
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'assistant',
        text: "Chat cleared! How can I assist you with KITS-EOS? Pick a topic below.",
        timestamp: 'Just now'
      }
    ]);
  };

  const filteredQuestions = PREDEFINED_QUESTIONS.filter(q => 
    q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {/* =========================================================================
          FLOATING TRIGGER BUTTON (Always visible at bottom-right)
          ========================================================================= */}
      <aside aria-label="KEOS AI Assistant trigger" className="fixed bottom-5 right-5 z-40">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`group flex items-center gap-2.5 px-4 py-3 rounded-full shadow-2xl transition-all duration-300 cursor-pointer border ${
            isOpen
              ? 'bg-gray-900 text-white border-gray-700 ring-2 ring-gray-400/20 scale-95'
              : 'bg-white text-gray-900 border-gray-200 hover:border-kits-red/50 hover:shadow-red-500/10 hover:scale-105'
          }`}
          aria-label={isOpen ? "Close Assistant" : "Need assistance with K-EOS? Click me"}
        >
          <span className="text-xl" role="img" aria-label="robot">🤖</span>
          <div className="text-left hidden xs:block sm:block">
            <p className="text-xs font-black text-gray-900 group-hover:text-kits-red leading-none transition">
              Need assistance with K-EOS?
            </p>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mt-0.5">
              {isOpen ? 'Close Chat' : 'Click me'}
            </span>
          </div>
          {!isOpen && (
            <span className="h-2 w-2 rounded-full bg-kits-red animate-ping shrink-0" />
          )}
        </button>
      </aside>

      {/* =========================================================================
          SIDE CHAT PANEL ONLY (Strictly 360-420px width, NEVER fullscreen)
          ========================================================================= */}
      {isOpen && (
        <aside
          aria-label="KEOS AI Assistant Panel"
          className="fixed bottom-20 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] max-w-[400px] h-[550px] max-h-[82vh] bg-white rounded-3xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          {/* Header */}
          <div className="px-5 py-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-kits-red/90 text-white flex items-center justify-center font-bold text-lg shadow-2xs">
                🤖
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-black tracking-tight text-white">KEOS Assistant</h3>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Live Desk
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 font-medium">
                  Campus Event Operations Helpdesk
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleResetChat}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Reset conversation"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                aria-label="Close Assistant"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Quick Search */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 shrink-0">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search topics (e.g., QR pass, certificate, team)..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs placeholder:text-gray-400 focus:outline-hidden focus:border-kits-blue font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Chat Conversation Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-kits-red text-white font-bold rounded-tr-xs shadow-2xs'
                      : 'bg-white text-gray-800 border border-gray-200 shadow-2xs rounded-tl-xs whitespace-pre-line'
                  }`}
                >
                  {msg.text}

                  {/* Optional Action CTA */}
                  {msg.actionLink && (
                    <div className="mt-2.5 pt-2 border-t border-gray-100">
                      {msg.actionLink.isExternal ? (
                        <a
                          href={msg.actionLink.to}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-kits-blue font-bold text-[11px] transition"
                        >
                          <span>{msg.actionLink.label}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <Link
                          to={msg.actionLink.to}
                          onClick={() => setIsOpen(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-kits-red font-black text-[11px] transition"
                        >
                          <span>{msg.actionLink.label}</span>
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-gray-400 mt-1 px-1 font-mono">
                  {msg.timestamp}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Predefined Questions Tray */}
          <div className="p-3 bg-white border-t border-gray-100 space-y-2 shrink-0 max-h-44 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
                {searchQuery ? `Matching Questions (${filteredQuestions.length})` : 'Frequently Asked Questions (15)'}
              </span>
              <span className="text-[10px] text-gray-400 font-bold">
                Tap to ask
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {filteredQuestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectQuestion(item)}
                  className="w-full text-left p-2 rounded-xl text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-blue-50 hover:text-kits-blue border border-gray-200/80 transition flex items-center justify-between gap-2 group cursor-pointer"
                >
                  <span className="truncate">{item.question}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-kits-blue shrink-0" />
                </button>
              ))}

              {filteredQuestions.length === 0 && (
                <p className="text-xs text-gray-400 py-2 text-center">
                  No matching topic. Try searching "passes", "team", "COD", or "contacts".
                </p>
              )}
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
