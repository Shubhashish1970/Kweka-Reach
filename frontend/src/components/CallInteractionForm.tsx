import React, { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle } from 'lucide-react';
import BinaryToggle from './BinaryToggle';
import MultiTagSelect from './MultiTagSelect';
import PurchasedProductsInput from './PurchasedProductsInput';
import { masterDataAPI } from '../services/api';
import Button from './shared/Button';

interface CallInteractionFormProps {
  taskData: any;
  formData: {
    callStatus: string;
    didAttend: string | null;
    didRecall: boolean | null;
    cropsDiscussed: string[];
    productsDiscussed: string[];
    activityQuality?: number; // 1-5 (4B. Activity Quality)
    hasPurchased: boolean | null;
    willingToPurchase: boolean | null;
    likelyPurchaseDate?: string;
    nonPurchaseReason: string;
    purchasedProducts?: Array<{ product: string; quantity: string; unit: string }>;
    farmerComments: string;
    sentiment: 'Positive' | 'Negative' | 'Neutral' | 'N/A';
  };
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  toggleList: (field: 'cropsDiscussed' | 'productsDiscussed', item: string) => void;
  handleFinalSubmit: () => Promise<void>;
  isSubmitting: boolean;
  isActive: boolean;
  IndianCrops: string[]; // Activity crops (for highlighting)
  AgriProducts: string[]; // Activity products (for highlighting)
  NonPurchaseReasons: string[];
  isAIPanelExpanded?: boolean;
  onOutboundStatusSelected?: (status: string) => void;
}

const CallInteractionForm: React.FC<CallInteractionFormProps> = ({
  taskData,
  formData,
  setFormData,
  toggleList,
  handleFinalSubmit,
  isSubmitting,
  isActive,
  IndianCrops, // Activity crops
  AgriProducts, // Activity products
  NonPurchaseReasons,
  isAIPanelExpanded = false,
  onOutboundStatusSelected,
}) => {
  const [masterCrops, setMasterCrops] = useState<string[]>([]);
  const [masterProducts, setMasterProducts] = useState<string[]>([]);
  const [loadingMasterData, setLoadingMasterData] = useState(true);

  // Refs for sections that appear conditionally
  const meetingAttendanceRef = useRef<HTMLDivElement>(null);
  const recallContentRef = useRef<HTMLDivElement>(null);
  const productCropRecallRef = useRef<HTMLDivElement>(null);
  const commercialConversionRef = useRef<HTMLDivElement>(null);
  const purchasedProductsRef = useRef<HTMLDivElement>(null);
  const likelyDateRef = useRef<HTMLDivElement>(null);

  // Fetch master data on component mount
  useEffect(() => {
    const fetchMasterData = async () => {
      try {
        setLoadingMasterData(true);
        const [cropsRes, productsRes] = await Promise.all([
          masterDataAPI.getCrops(),
          masterDataAPI.getProducts(),
        ]);
        
        if (cropsRes.success && cropsRes.data.crops) {
          setMasterCrops(cropsRes.data.crops.map((c: any) => c.name));
        }
        
        if (productsRes.success && productsRes.data.products) {
          setMasterProducts(productsRes.data.products.map((p: any) => p.name));
        }
      } catch (error) {
        console.error('Error fetching master data:', error);
        // Fallback to activity data if master data fails
        setMasterCrops(IndianCrops);
        setMasterProducts(AgriProducts);
      } finally {
        setLoadingMasterData(false);
      }
    };

    fetchMasterData();
  }, [IndianCrops, AgriProducts]);

  // Auto-scroll to sections when they appear (scrolls within the container)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const scrollToRef = (ref: React.RefObject<HTMLDivElement>) => {
    if (ref.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = ref.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const relativeTop = elementRect.top - containerRect.top + container.scrollTop;

      // Scroll with 20px offset from top
      container.scrollTo({
        top: relativeTop - 20,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (formData.callStatus === 'Connected' && meetingAttendanceRef.current) {
      setTimeout(() => scrollToRef(meetingAttendanceRef), 150);
    }
  }, [formData.callStatus]);

  useEffect(() => {
    if ((formData.didAttend === 'Yes, I attended' || formData.didAttend === "Don't recall") && recallContentRef.current) {
      setTimeout(() => scrollToRef(recallContentRef), 150);
    }
  }, [formData.didAttend]);

  useEffect(() => {
    if (formData.didRecall === true && productCropRecallRef.current) {
      setTimeout(() => scrollToRef(productCropRecallRef), 150);
    }
  }, [formData.didRecall]);

  useEffect(() => {
    if ((formData.cropsDiscussed.length > 0 || formData.productsDiscussed.length > 0) && commercialConversionRef.current) {
      setTimeout(() => scrollToRef(commercialConversionRef), 150);
    }
  }, [formData.cropsDiscussed.length, formData.productsDiscussed.length]);

  useEffect(() => {
    if (formData.hasPurchased === true && purchasedProductsRef.current) {
      setTimeout(() => scrollToRef(purchasedProductsRef), 150);
    }
  }, [formData.hasPurchased]);

  useEffect(() => {
    if (formData.willingToPurchase === true && likelyDateRef.current) {
      setTimeout(() => scrollToRef(likelyDateRef), 150);
    }
  }, [formData.willingToPurchase]);

  // Reset dependent fields when parent selections change
  const prevCallStatusRef = useRef<string>('');
  const prevDidAttendRef = useRef<string | null>(null);
  const prevDidRecallRef = useRef<boolean | null>(null);
  const prevHasPurchasedRef = useRef<boolean | null>(null);
  const prevWillingToPurchaseRef = useRef<boolean | null>(null);

  useEffect(() => {
    // If callStatus changes from "Connected" to something else, reset all dependent fields
    if (prevCallStatusRef.current === 'Connected' && formData.callStatus !== 'Connected') {
      setFormData((p: any) => ({
        ...p,
        didAttend: null,
        didRecall: null,
        cropsDiscussed: [],
        productsDiscussed: [],
        activityQuality: undefined,
        hasPurchased: null,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
        purchasedProducts: [],
      }));
    }
    prevCallStatusRef.current = formData.callStatus;
  }, [formData.callStatus]);

  useEffect(() => {
    // If didAttend changes from valid option to invalid, reset dependent fields
    const wasValid = prevDidAttendRef.current === 'Yes, I attended' || prevDidAttendRef.current === "Don't recall";
    const isValid = formData.didAttend === 'Yes, I attended' || formData.didAttend === "Don't recall";
    
    if (wasValid && !isValid) {
      setFormData((p: any) => ({
        ...p,
        didRecall: null,
        cropsDiscussed: [],
        productsDiscussed: [],
        activityQuality: undefined,
        hasPurchased: null,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
        purchasedProducts: [],
      }));
    }
    prevDidAttendRef.current = formData.didAttend;
  }, [formData.didAttend]);

  useEffect(() => {
    // If didRecall changes from true to false/null, reset dependent fields
    if (prevDidRecallRef.current === true && formData.didRecall !== true) {
      setFormData((p: any) => ({
        ...p,
        cropsDiscussed: [],
        productsDiscussed: [],
        activityQuality: undefined,
        hasPurchased: null,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
        purchasedProducts: [],
      }));
    }
    prevDidRecallRef.current = formData.didRecall;
  }, [formData.didRecall]);

  useEffect(() => {
    // If hasPurchased changes from true to false/null, reset purchasedProducts
    if (prevHasPurchasedRef.current === true && formData.hasPurchased !== true) {
      setFormData((p: any) => ({
        ...p,
        purchasedProducts: [],
      }));
    }
    // If hasPurchased changes from false to true/null, reset future purchase fields
    if (prevHasPurchasedRef.current === false && formData.hasPurchased !== false) {
      setFormData((p: any) => ({
        ...p,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
      }));
    }
    prevHasPurchasedRef.current = formData.hasPurchased;
  }, [formData.hasPurchased]);

  useEffect(() => {
    // If willingToPurchase changes from true to false/null, reset likelyPurchaseDate
    if (prevWillingToPurchaseRef.current === true && formData.willingToPurchase !== true) {
      setFormData((p: any) => ({
        ...p,
        likelyPurchaseDate: undefined,
      }));
    }
    prevWillingToPurchaseRef.current = formData.willingToPurchase;
  }, [formData.willingToPurchase]);

  return (
    <section className={`${isActive ? 'block' : 'hidden lg:block'} flex-1 overflow-hidden bg-gradient-to-br from-slate-50 to-white transition-all duration-300 ${isAIPanelExpanded ? 'lg:mr-96' : 'lg:mr-0'}`}>
      {taskData ? (
        <div className="h-full overflow-y-auto p-4 lg:p-6" ref={scrollContainerRef}>
          <div className="max-w-4xl mx-auto space-y-4">
        
            {/* Call Status (PRD 7.4.1) */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">1. Outbound Status</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {['Connected', 'Disconnected', 'Incoming N/A', 'Invalid', 'No Answer'].map(status => {
                    const isSelected = formData.callStatus === status;
                    const isConnected = status === 'Connected';
                    return (
                      <button
                        key={status}
                        onClick={() => {
                          const nextStatus = isSelected ? '' : status;
                          setFormData((p: any) => ({ ...p, callStatus: nextStatus }));
                          if (nextStatus) {
                            onOutboundStatusSelected?.(nextStatus);
                          }
                        }}
                        className={`py-2 px-2.5 rounded-lg border text-[9px] font-black uppercase tracking-tighter transition-all min-h-[32px] flex items-center justify-center ${
                          isSelected
                            ? isConnected
                              ? 'bg-green-700 text-white border-green-700 shadow-sm'
                              : 'bg-slate-950 text-white border-slate-950 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {status}
                      </button>
                    );
                  })}
                </div>
            </div>

            {formData.callStatus === 'Connected' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500" ref={meetingAttendanceRef}>
                
                {/* Meeting Attendance Details */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">2. Meeting Attendance Details</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {['Identity Wrong', 'Not a Farmer', 'Yes, I attended', 'No, I missed', "Don't recall"].map(option => {
                      const isSelected = formData.didAttend === option;
                      const isYes = option === 'Yes, I attended';
                      const isMaybe = option === "Don't recall";
                      return (
                        <button
                          key={option}
                          onClick={() => setFormData((p: any) => ({ 
                            ...p, 
                            didAttend: isSelected ? null : option 
                          }))}
                          className={`py-2 px-2.5 rounded-lg border text-[9px] font-black uppercase tracking-tighter transition-all min-h-[32px] flex items-center justify-center ${
                            isSelected
                              ? isYes
                                ? 'bg-green-700 text-white border-green-700 shadow-sm'
                                : isMaybe
                                ? 'bg-green-400 text-white border-green-400 shadow-sm'
                                : 'bg-red-600 text-white border-red-600 shadow-sm'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Show next section only when "Yes, I attended" or "Don't recall" is selected */}
                {(formData.didAttend === 'Yes, I attended' || formData.didAttend === "Don't recall") && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500" ref={recallContentRef}>
                    {/* Recall Toggles (PRD 7.4.2) */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">3. Do they recall the content?</h3>
                      <div className="flex justify-center">
                        <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                          {([
                            { value: true, label: 'Yes / Reminded' },
                            { value: false, label: 'No' },
                          ] as const).map(({ value, label }) => {
                            const isSelected = formData.didRecall === value;
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => setFormData((p: any) => ({ ...p, didRecall: isSelected ? null : value }))}
                                className={`py-2 px-2.5 rounded-lg border text-[9px] font-black tracking-tighter transition-all min-h-[32px] flex items-center justify-center ${
                                  isSelected
                                    ? value
                                      ? 'bg-green-700 text-white border-green-700 shadow-sm'
                                      : 'bg-red-600 text-white border-red-600 shadow-sm'
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Show Product & Crop Recall only when "Yes" is selected in recall */}
                    {formData.didRecall === true && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500" ref={productCropRecallRef}>
                        {/* Product Matrix (PRD 7.4.3) */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            4A. Product & Crop Recall
                          </h3>
                          <div className="space-y-4">
                            {loadingMasterData ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="animate-spin text-lime-600" size={24} />
                              </div>
                            ) : (
                              <>
                                <MultiTagSelect
                                  label="Crops Identified"
                                  items={masterCrops}
                                  selected={formData.cropsDiscussed}
                                  onToggle={(i: string) => toggleList('cropsDiscussed', i)}
                                  color="green"
                                  activityItems={IndianCrops}
                                />
                                <MultiTagSelect
                                  label="Products Recalled"
                                  items={masterProducts}
                                  selected={formData.productsDiscussed}
                                  onToggle={(i: string) => toggleList('productsDiscussed', i)}
                                  color="indigo"
                                  activityItems={AgriProducts}
                                />
                              </>
                            )}
                          </div>
                        </div>

                        {/* 4B. Activity Quality - MDO holistic crop solution (after 4A, before Commercial Conversion) */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            4B. Activity Quality
                          </h3>
                          <p className="text-sm font-medium text-slate-700">
                            Did the MDO understand your problem and offer a holistic crop solution?
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { value: 1, label: 'Did not understand or provide a solution', stars: '⭐' },
                              { value: 2, label: 'Limited understanding; partial solution', stars: '⭐⭐' },
                              { value: 3, label: 'Understood problem, basic solution', stars: '⭐⭐⭐' },
                              { value: 4, label: 'Good understanding; mostly holistic solution', stars: '⭐⭐⭐⭐' },
                              { value: 5, label: 'Excellent understanding; complete holistic solution', stars: '⭐⭐⭐⭐⭐' },
                            ].map(({ value, label, stars }) => {
                              const isSelected = formData.activityQuality === value;
                              const selectedStyle =
                                value <= 2
                                  ? 'bg-red-600 text-white border-red-600 shadow-sm'
                                  : value === 3
                                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                                    : value === 4
                                      ? 'bg-green-400 text-white border-green-400 shadow-sm'
                                      : 'bg-green-700 text-white border-green-700 shadow-sm';
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => setFormData((p: any) => ({ ...p, activityQuality: isSelected ? undefined : value }))}
                                  className={`py-2.5 px-3 rounded-xl border text-left text-[10px] font-bold transition-all min-h-[40px] flex items-center gap-2 ${
                                    isSelected
                                      ? selectedStyle
                                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  <span className="text-sm">{stars}</span>
                                  <span className="hidden sm:inline">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Show Commercial Conversion when Product & Crop Recall is completed */}
                        {(formData.cropsDiscussed.length > 0 || formData.productsDiscussed.length > 0) && (
                          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500" ref={commercialConversionRef}>
                            {/* Commercial Conversion (PRD 7.4.4) */}
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                5. Commercial Conversion
                              </h3>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">
                                    Have they purchased?
                                  </label>
                                  <div className="flex justify-center">
                                    <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                                      {['Yes', 'No'].map(option => {
                                        const isSelected = formData.hasPurchased === (option === 'Yes');
                                        return (
                                          <button
                                            key={option}
                                            onClick={() => setFormData((p: any) => ({ ...p, hasPurchased: isSelected ? null : (option === 'Yes') }))}
                                            className={`py-2 px-2.5 rounded-lg border text-[9px] font-black uppercase tracking-tighter transition-all min-h-[32px] flex items-center justify-center ${
                                              isSelected
                                                ? option === 'Yes'
                                                  ? 'bg-green-700 text-white border-green-700 shadow-sm'
                                                  : 'bg-red-600 text-white border-red-600 shadow-sm'
                                                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                            }`}
                                          >
                                            {option}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>

                                {formData.hasPurchased === true && (
                                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-visible" ref={purchasedProductsRef}>
                                    <div className="overflow-visible">
                                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">
                                        What did they purchase?
                                      </label>
                                      <PurchasedProductsInput
                                        products={masterProducts}
                                        activityProducts={AgriProducts}
                                        suggestedProducts={formData.productsDiscussed}
                                        selectedProducts={formData.purchasedProducts || []}
                                        onUpdate={(products) => setFormData((p: any) => ({ ...p, purchasedProducts: products }))}
                                      />
                                    </div>
                                  </div>
                                )}

                                {formData.hasPurchased === false && (
                                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                  <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">
                                      Likely to buy in future?
                                    </label>
                                    <div className="flex justify-center">
                                      <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                                        {['Yes', 'No'].map(option => {
                                          const isSelected = formData.willingToPurchase === (option === 'Yes');
                                          return (
                                            <button
                                              key={option}
                                              onClick={() => setFormData((p: any) => ({ 
                                                ...p, 
                                                willingToPurchase: isSelected ? null : (option === 'Yes'),
                                                likelyPurchaseDate: isSelected ? undefined : (option === 'Yes' ? p.likelyPurchaseDate || '' : undefined)
                                              }))}
                                              className={`py-2 px-2.5 rounded-lg border text-[9px] font-black uppercase tracking-tighter transition-all min-h-[32px] flex items-center justify-center ${
                                                isSelected
                                                  ? option === 'Yes'
                                                    ? 'bg-green-700 text-white border-green-700 shadow-sm'
                                                    : 'bg-red-600 text-white border-red-600 shadow-sm'
                                                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                              }`}
                                            >
                                              {option}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>

                                  {formData.willingToPurchase === true && (
                                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" ref={likelyDateRef}>
                                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                                        Likely Date of Purchase
                                      </label>
                                      <div className="flex justify-center">
                                        <input
                                          type="date"
                                          value={formData.likelyPurchaseDate || ''}
                                          onChange={(e) => setFormData((p: any) => ({ ...p, likelyPurchaseDate: e.target.value }))}
                                          className="min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 w-auto max-w-[200px]"
                                          min={new Date().toISOString().split('T')[0]}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {(formData.willingToPurchase === false || formData.willingToPurchase === null) && (
                                    <div className="space-y-2">
                                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                                        Reason for non-purchase
                                      </label>
                                      <div className="flex flex-wrap gap-2">
                                        {NonPurchaseReasons.map(reason => {
                                          const isSelected = formData.nonPurchaseReason === reason;
                                          return (
                                            <button
                                              key={reason}
                                              onClick={() => setFormData((p: any) => ({
                                                ...p,
                                                nonPurchaseReason: isSelected ? '' : reason,
                                                willingToPurchase: isSelected
                                                  ? (p.willingToPurchase === true ? true : null)
                                                  : (p.willingToPurchase === true ? true : false),
                                              }))}
                                              className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-tighter transition-all min-h-[32px] ${
                                                isSelected
                                                  ? 'bg-slate-950 text-white border-slate-950 shadow-sm'
                                                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                              }`}
                                            >
                                              {reason}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Farmer Comments Section - Only visible after AI processing (Process & Submit Notes clicked) */}
                        {(formData.cropsDiscussed.length > 0 || formData.productsDiscussed.length > 0) && formData.farmerComments && formData.farmerComments.trim() && (
                          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                              <label className="text-sm font-black text-slate-900">
                                Farmer Comments
                              </label>
                              
                              <textarea
                                value={formData.farmerComments}
                                onChange={(e) => {
                                  setFormData(prev => ({ ...prev, farmerComments: e.target.value }));
                                }}
                                className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 resize-none"
                                placeholder="3 bullet points summarizing the conversation (20-25 words each)"
                                rows={6}
                              />
                              
                              {/* Sentiment Indicator */}
                              {formData.sentiment && formData.sentiment !== 'N/A' && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500">Sentiment:</span>
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
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full border-4 border-indigo-200 border-t-indigo-700 mx-auto flex items-center justify-center">
              <CheckCircle className="text-indigo-700" size={32} />
            </div>
            <p className="font-bold text-indigo-800 text-lg">No Task Loaded</p>
            <p className="text-sm text-slate-500">Load a task to start capturing call interactions</p>
          </div>
        </div>
      )}
      <div className="h-24 lg:hidden" /> {/* Spacer for mobile nav */}
    </section>
  );
};

export default CallInteractionForm;

