import { Printer, Receipt, CheckCircle2, ShieldCheck } from 'lucide-react';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { printDocument } from '../../utils/credentialExport';

export interface TransactionReceiptProps {
  transactionId: string;
  paymentStatus: string;
  paymentMethod?: string; // 'UPI' | 'COD' | 'FREE'
  registrationId: string;
  studentName: string;
  rollNumber: string;
  department: string;
  year: number | string;
  college: string;
  eventName: string;
  categoryName?: string;
  subEventName: string;
  participationType: string;
  amount: number;
  timestamp?: string;
}

export function TransactionReceipt(props: TransactionReceiptProps) {
  const {
    transactionId,
    paymentStatus,
    paymentMethod = 'UPI',
    registrationId,
    studentName,
    rollNumber,
    department,
    year,
    college,
    eventName,
    categoryName,
    subEventName,
    participationType,
    amount,
    timestamp = new Date().toISOString(),
  } = props;

  const receiptId = `transaction-receipt-${registrationId.slice(0, 8)}`;
  const isCod = paymentMethod === 'COD' || transactionId.startsWith('COD-');
  const isFree = amount === 0 || transactionId.startsWith('FREE-');

  const handlePrint = () => {
    printDocument(receiptId);
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Official Printable Receipt Container */}
      <div 
        id={receiptId} 
        className="bg-white rounded-2xl sm:rounded-3xl border border-gray-300 shadow-xl overflow-hidden font-sans p-4 sm:p-8 space-y-5 sm:space-y-6"
      >
        {/* Institutional Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4 sm:pb-5 gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <img 
              src="/college_logo.png" 
              alt="KITS Logo" 
              className="h-10 w-10 sm:h-12 sm:w-12 object-contain shrink-0" 
            />
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-black text-gray-900 uppercase tracking-tight truncate">
                KITS Akshar Institute of Technology
              </h2>
              <div className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate">
                Event Operations System (KITS-EOS)
              </div>
            </div>
          </div>
          <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold shrink-0 border border-emerald-200">
            <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>

        {/* Title & Status Badge */}
        <div className="flex flex-col xs:flex-row xs:items-center justify-between bg-gray-50 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-gray-200 gap-2">
          <div>
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block">
              Official Document
            </span>
            <h3 className="text-sm sm:text-base font-black text-gray-900 tracking-tight">
              TRANSACTION RECEIPT
            </h3>
          </div>
          <div className="self-start xs:self-auto">
            <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{paymentStatus === 'SUCCESS' ? 'PAID / CONFIRMED' : paymentStatus}</span>
            </span>
          </div>
        </div>

        {/* Reference Grid */}
        <div className="grid grid-cols-1 xs:grid-cols-2 gap-2.5 sm:gap-3 text-xs">
          <div className="p-2.5 sm:p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-0.5 min-w-0">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400 block">
              Transaction / Receipt ID
            </span>
            <span className="font-mono font-bold text-gray-900 truncate block text-[11px] sm:text-xs">
              {transactionId}
            </span>
          </div>

          <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400 block">
              Registration ID
            </span>
            <span className="font-mono font-bold text-gray-900 truncate block">
              {registrationId}
            </span>
          </div>

          <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400 block">
              Payment Method
            </span>
            <span className="font-mono font-bold text-gray-900 text-xs block">
              {isFree ? 'FREE / WAIVED' : isCod ? 'COD / IN-PERSON' : 'UPI (SIMULATED)'}
            </span>
          </div>

          <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400 block">
              Date & Time
            </span>
            <span className="font-mono font-bold text-gray-900 text-[11px] block">
              {formatDateTime12h(timestamp)}
            </span>
          </div>
        </div>

        {/* Participant & Academic Details */}
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-400">
            Participant Details
          </h4>
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Student Name:</span>
              <span className="font-black text-gray-900">{studentName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Roll Number:</span>
              <span className="font-mono font-bold text-kits-blue">{rollNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Department & Year:</span>
              <span className="font-bold text-gray-800">{department} • Year {year}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Institution:</span>
              <span className="font-bold text-gray-800">{college}</span>
            </div>
          </div>
        </div>

        {/* Event Breakdown */}
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-400">
            Event Information
          </h4>
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Event Name:</span>
              <span className="font-bold text-gray-900">{eventName}</span>
            </div>
            {categoryName && (
              <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Category:</span>
                <span className="font-bold text-gray-800">{categoryName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Sub-Event:</span>
              <span className="font-black text-kits-red">{subEventName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Participation Format:</span>
              <span className="font-bold text-gray-900">{participationType}</span>
            </div>
          </div>
        </div>

        {/* Fee Total Box */}
        <div className="p-4 bg-gray-900 text-white rounded-2xl flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
              Total Amount Paid
            </span>
            <span className="text-xs text-gray-300">Registration Status: CONFIRMED</span>
          </div>
          <span className="text-2xl font-black font-mono text-emerald-400">
            {amount > 0 ? `₹${amount}` : 'FREE'}
          </span>
        </div>

        {/* Payment Disclaimer / Notice */}
        {isCod ? (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-800 block">
              PAYMENT RECEIVED
            </span>
            <p className="text-[10px] text-emerald-700 font-bold">
              OFFICIAL IN-PERSON RECEIPT • PAYMENT CONFIRMED BY COORDINATOR / ADMIN
            </p>
          </div>
        ) : isFree ? (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-center space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-kits-blue block">
              COMPLIMENTARY REGISTRATION
            </span>
            <p className="text-[10px] text-kits-blue font-bold">
              ZERO FEE EVENT • OFFICIALLY REGISTERED
            </p>
          </div>
        ) : (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-800 block">
              DEMO PAYMENT NOTICE
            </span>
            <p className="text-[10px] text-amber-700 font-bold">
              DEMO PAYMENT • NO REAL MONEY WAS CHARGED
            </p>
          </div>
        )}

        {/* Footer Verification */}
        <div className="flex items-center justify-between text-[10px] text-gray-400 pt-2 border-t border-gray-100">
          <span>KITS-EOS System Generated Receipt</span>
          <span className="flex items-center gap-1 text-emerald-700 font-bold">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            Verified Record
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 w-full pt-1">
        <button
          type="button"
          onClick={handlePrint}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 bg-kits-blue text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-blue-800 transition shadow-2xs cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>Print / Save Receipt (PDF)</span>
        </button>
      </div>
    </div>
  );
}
