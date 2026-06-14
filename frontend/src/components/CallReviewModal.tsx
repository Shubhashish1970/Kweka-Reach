import React from 'react';
import { X, ArrowLeft, CheckCircle, Phone, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import Button from './shared/Button';
import { formatDateIST } from '../utils/dateRangeUtils';

interface CallReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  formData: {
    callStatus: string;
    didAttend: string | null;
    didRecall: boolean | null;
    cropsDiscussed: string[];
    productsDiscussed: string[];
    activityQuality?: number;
    hasPurchased: boolean | null;
    willingToPurchase: boolean | null;
    likelyPurchaseDate?: string;
    nonPurchaseReason: string;
    purchasedProducts?: Array<{ product: string; quantity: string; unit: string }>;
    farmerComments: string;
    sentiment: 'Positive' | 'Negative' | 'Neutral' | 'N/A';
  };
  onFinalSubmit: () => Promise<void>;
  isSubmitting: boolean;
  callDuration: number;
  farmerName: string;
}

const CallReviewModal: React.FC<CallReviewModalProps> = ({
  isOpen,
  onClose,
  formData,
  onFinalSubmit,
  isSubmitting,
  callDuration,
  farmerName,
}) => {
  const { showWarning } = useToast();
  
  if (!isOpen) return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not specified';
    return formatDateIST(dateString) || dateString;
  };

  const handleSubmit = async () => {
    // Review modal is for verification only - no validation needed
    // All required fields should have been answered in the form before opening review
    if (!formData.callStatus) {
      showWarning('Please select call status');
      return;
    }

    await onFinalSubmit();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-green-700 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Phone size={24} />
            <div>
              <h2 className="text-lg font-black">Review Call Data</h2>
              <p className="text-xs text-green-100">Farmer: {farmerName} • Duration: {formatDuration(callDuration)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-xl transition-all"
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Call Status */}
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <CheckCircle size={14} />
              1. Outbound Status
            </h3>
            <div className="flex items-center gap-2">
              <span className={`px-4 py-2 rounded-xl text-sm font-bold ${
                formData.callStatus === 'Connected' 
                  ? 'bg-green-700 text-white' 
                  : 'bg-slate-900 text-white'
              }`}>
                {formData.callStatus || 'Not selected'}
              </span>
            </div>
          </div>

          {/* Show detailed fields only for Connected calls */}
          {formData.callStatus === 'Connected' ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              {/* Meeting Attendance Details - Only show if answered */}
              {formData.didAttend !== null && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                    2. Meeting Attendance Details
                  </h3>
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <span className={`px-4 py-2 rounded-lg text-sm font-bold inline-block ${
                      formData.didAttend === 'Yes, I attended'
                        ? 'bg-green-700 text-white'
                        : formData.didAttend === "Don't recall"
                        ? 'bg-green-400 text-white'
                        : formData.didAttend
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}>
                      {formData.didAttend}
                    </span>
                  </div>
                </div>
              )}

              {/* Recall Toggle - Only show if didAttend was "Yes, I attended" or "Don't recall" */}
              {(formData.didAttend === 'Yes, I attended' || formData.didAttend === "Don't recall") && formData.didRecall !== null && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                    3. Do they recall the content?
                  </h3>
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <span className={`px-4 py-2 rounded-lg text-sm font-bold inline-block ${
                      formData.didRecall === true
                        ? 'bg-green-700 text-white'
                        : formData.didRecall === false
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}>
                      {formData.didRecall === true ? 'Yes' : formData.didRecall === false ? 'No' : 'Not selected'}
                    </span>
                  </div>
                </div>
              )}

              {/* 4A. Product & Crop Recall */}
              {(formData.didRecall === true) && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                    4A. Product & Crop Recall
                  </h3>
                  <div className="space-y-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <label className="text-xs font-bold text-slate-600 mb-2 block">Crops Identified</label>
                      {formData.cropsDiscussed.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {formData.cropsDiscussed.map((crop, idx) => (
                            <span
                              key={idx}
                              className="px-3 py-1.5 bg-green-700 text-white rounded-full text-xs font-medium"
                            >
                              {crop}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400 italic">None selected</span>
                      )}
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <label className="text-xs font-bold text-slate-600 mb-2 block">Products Recalled</label>
                      {formData.productsDiscussed.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {formData.productsDiscussed.map((product, idx) => (
                            <span
                              key={idx}
                              className="px-3 py-1.5 bg-indigo-700 text-white rounded-full text-xs font-medium"
                            >
                              {product}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400 italic">None selected</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 4B. Activity Quality - FDA holistic crop solution */}
              {formData.didRecall === true && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                    4B. Activity Quality
                  </h3>
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <label className="text-xs font-bold text-slate-600 mb-2 block">Did the FDA understand your problem and offer a holistic crop solution?</label>
                    {formData.activityQuality != null && formData.activityQuality >= 1 && formData.activityQuality <= 5 ? (
                      <span
                        className={`px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 border shadow-sm ${
                          formData.activityQuality <= 2
                            ? 'bg-red-600 text-white border-red-600'
                            : formData.activityQuality === 3
                              ? 'bg-amber-500 text-white border-amber-500'
                              : formData.activityQuality === 4
                                ? 'bg-green-400 text-white border-green-400'
                                : 'bg-green-700 text-white border-green-700'
                        }`}
                      >
                        {'⭐'.repeat(formData.activityQuality)} {(['', 'Did not understand or provide a solution', 'Limited understanding; partial solution', 'Understood problem, basic solution', 'Good understanding; mostly holistic solution', 'Excellent understanding; complete holistic solution'] as const)[formData.activityQuality]}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400 italic">Not selected</span>
                    )}
                  </div>
                </div>
              )}

              {/* Commercial Conversion - Only show if crops/products were discussed AND hasPurchased was answered */}
              {(formData.cropsDiscussed.length > 0 || formData.productsDiscussed.length > 0) && formData.hasPurchased !== null && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                    5. Commercial Conversion
                  </h3>
                  <div className="space-y-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                      <label className="text-xs font-bold text-slate-600 mb-2 block">Have they purchased?</label>
                      <span className={`px-4 py-2 rounded-lg text-sm font-bold inline-block ${
                        formData.hasPurchased === true
                          ? 'bg-green-700 text-white'
                          : formData.hasPurchased === false
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}>
                        {formData.hasPurchased === true ? 'Yes' : formData.hasPurchased === false ? 'No' : 'Not selected'}
                      </span>
                    </div>

                    {formData.hasPurchased === true && formData.purchasedProducts && formData.purchasedProducts.length > 0 && (
                      <div className="bg-white p-4 rounded-xl border border-slate-200">
                        <label className="text-xs font-bold text-slate-600 mb-2 block">What did they purchase?</label>
                        <div className="space-y-2">
                          {formData.purchasedProducts.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-sm">
                              <span className="font-medium text-slate-700">{item.product}</span>
                              {item.quantity && (
                                <>
                                  <span className="text-slate-400">•</span>
                                  <span className="text-slate-600">{item.quantity} {item.unit}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {formData.hasPurchased === false && formData.willingToPurchase !== null && (
                      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                        <div>
                          <label className="text-xs font-bold text-slate-600 mb-2 block">Likely to buy in future?</label>
                          <span className={`px-4 py-2 rounded-lg text-sm font-bold inline-block ${
                            formData.willingToPurchase === true
                              ? 'bg-green-700 text-white'
                              : formData.willingToPurchase === false
                              ? 'bg-red-600 text-white'
                              : 'bg-slate-200 text-slate-600'
                          }`}>
                            {formData.willingToPurchase === true ? 'Yes' : formData.willingToPurchase === false ? 'No' : 'Not selected'}
                          </span>
                        </div>
                        {formData.willingToPurchase === true && formData.likelyPurchaseDate && (
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-2 block">Likely Date of Purchase</label>
                            <span className="text-sm text-slate-700">{formatDate(formData.likelyPurchaseDate)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {(formData.hasPurchased === false || formData.willingToPurchase === false) && formData.nonPurchaseReason && (
                      <div className="bg-white p-4 rounded-xl border border-slate-200">
                        <label className="text-xs font-bold text-slate-600 mb-2 block">Reason for non-purchase</label>
                        <span className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold inline-block">
                          {formData.nonPurchaseReason}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Farmer Comments */}
              {formData.farmerComments && (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                      Farmer Comments
                    </h3>
                    {/* Sentiment Indicator */}
                    {formData.sentiment && formData.sentiment !== 'N/A' && (
                      <div className="flex items-center gap-2">
                        {formData.sentiment === 'Positive' && <TrendingUp size={14} className="text-green-600" />}
                        {formData.sentiment === 'Negative' && <TrendingDown size={14} className="text-red-600" />}
                        {formData.sentiment === 'Neutral' && <Minus size={14} className="text-slate-600" />}
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          formData.sentiment === 'Positive' ? 'bg-green-100 text-green-700' :
                          formData.sentiment === 'Negative' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {formData.sentiment}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{formData.farmerComments}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* For non-connected calls, show minimal information */
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <p className="text-sm text-slate-600">
                Call status: <span className="font-bold text-slate-900">{formData.callStatus}</span>
              </p>
              {formData.farmerComments && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Farmer Comments</h4>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{formData.farmerComments}</p>
                  {formData.sentiment && formData.sentiment !== 'N/A' && (
                    <div className="mt-2 flex items-center gap-2">
                      {formData.sentiment === 'Positive' && <TrendingUp size={12} className="text-green-600" />}
                      {formData.sentiment === 'Negative' && <TrendingDown size={12} className="text-red-600" />}
                      {formData.sentiment === 'Neutral' && <Minus size={12} className="text-slate-600" />}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        formData.sentiment === 'Positive' ? 'bg-green-100 text-green-700' :
                        formData.sentiment === 'Negative' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {formData.sentiment}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 flex items-center justify-between gap-4 shrink-0 border-t border-slate-200">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            size="md"
          >
            <ArrowLeft size={16} />
            Go Back to Edit
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            loading={isSubmitting}
            size="md"
          >
            {!isSubmitting && <CheckCircle size={16} />}
            Final Submit
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CallReviewModal;

