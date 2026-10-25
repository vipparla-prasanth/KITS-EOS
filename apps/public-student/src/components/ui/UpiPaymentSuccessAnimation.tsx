import { useState, useEffect } from 'react';
import { 
  Check, 
  Copy, 
  IdCard, 
  Receipt, 
  Info 
} from 'lucide-react';
import { playRegistrationSuccessSound } from '../../utils/registrationSound';

export interface UpiPaymentSuccessProps {
  feeAmount: number;
  eventName: string;
  categoryName?: string;
  subEventName: string;
  participationType: string;
  registrationId: string;
  transactionId: string;
  paymentMethod: string;
  manualToken?: string;
  leaderName?: string;
  leaderRoll?: string;
  leaderDept?: string;
  leaderYear?: string | number;
  leaderCollege?: string;
  teamName?: string;
  qrIdentity?: string;
  qrPayload?: string;
  activeTab?: 'IDCARD' | 'QRPASS' | 'RECEIPT' | 'TOKEN' | null;
  onSelectTab?: (tab: 'IDCARD' | 'QRPASS' | 'RECEIPT' | 'TOKEN') => void;
  onAnimationComplete?: () => void;
  onViewPass?: () => void;
  onDownloadReceipt?: () => void;
}

export function UpiPaymentSuccessAnimation(props: UpiPaymentSuccessProps) {
  const {
    feeAmount,
    transactionId,
    paymentMethod,
    onSelectTab,
    onAnimationComplete,
    onViewPass,
    onDownloadReceipt,
  } = props;

  const [copiedRef, setCopiedRef] = useState(false);

  // Play registration success sound on verified payment animation mount (deduplicated)
  useEffect(() => {
    const dedupeKey = `payment-${props.registrationId || props.transactionId || 'online'}`;
    playRegistrationSuccessSound({ dedupeKey });
    onAnimationComplete?.();
  }, [props.registrationId, props.transactionId, onAnimationComplete]);

  const handleCopyRef = () => {
    if (!transactionId) return;
    navigator.clipboard.writeText(transactionId);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const handleViewPass = () => {
    if (onViewPass) {
      onViewPass();
    } else if (onSelectTab) {
      onSelectTab('IDCARD');
      const elem = document.getElementById('credentials-suite-section');
      if (elem) elem.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleDownloadReceipt = () => {
    if (onDownloadReceipt) {
      onDownloadReceipt();
    } else if (onSelectTab) {
      onSelectTab('RECEIPT');
      const elem = document.getElementById('credentials-suite-section');
      if (elem) elem.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const safeTxId = transactionId || '';
  const isDemoPayment = 
    paymentMethod === 'UPI' || 
    safeTxId.includes('DEMO') || 
    safeTxId.startsWith('KITS-EOS-DEMO') ||
    safeTxId.startsWith('UPI-DEMO');

  return (
    <div className="w-full max-w-lg mx-auto py-2">
      {/* =========================================================================
          COMPACT CENTERED SUCCESS CARD
          ========================================================================= */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-6 sm:p-8 text-center space-y-4 sm:space-y-5">
        
        {/* Animated Green Success Checkmark Badge */}
        <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-20" />
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border-2 border-emerald-500 shadow-sm animate-pop-success">
            <Check className="h-8 w-8 stroke-[3] text-emerald-600" />
          </div>
        </div>

        {/* Primary Confirmation Header */}
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
            Payment Successful
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 font-medium">
            Payment completed successfully.
          </p>
          {feeAmount > 0 && (
            <div className="text-2xl sm:text-3xl font-black font-mono text-gray-900 pt-1">
              ₹{feeAmount}
            </div>
          )}
        </div>

        {/* Dynamic Transaction Reference Box */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-3.5 max-w-sm mx-auto space-y-1 text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
            Transaction Reference
          </span>
          <div className="flex items-center justify-center gap-2">
            <span className="font-mono font-black text-xs sm:text-sm text-gray-900 select-all break-all">
              {transactionId}
            </span>
            {transactionId && (
              <button
                type="button"
                onClick={handleCopyRef}
                className="text-gray-400 hover:text-gray-700 p-0.5 transition shrink-0 cursor-pointer"
                title="Copy Transaction Reference"
              >
                {copiedRef ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Demo Payment Notice Banner */}
        {isDemoPayment && (
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-[10px] sm:text-[11px] font-bold shadow-2xs max-w-full">
            <Info className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span className="break-words text-center">
              DEMO PAYMENT • NO REAL MONEY WAS CHARGED
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3 pt-2 w-full">
          <button
            type="button"
            onClick={handleViewPass}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
          >
            <IdCard className="h-4 w-4" />
            <span>View My Pass</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadReceipt}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer"
          >
            <Receipt className="h-4 w-4 text-kits-blue" />
            <span>Download Receipt</span>
          </button>
        </div>

      </div>
    </div>
  );
}
