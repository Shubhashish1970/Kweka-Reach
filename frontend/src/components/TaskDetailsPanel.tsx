import React from 'react';
import { MapPin, User, Layout, Phone, UserCircle, Clock, CheckCircle, XCircle, MessageSquare, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface CallLog {
  timestamp?: string;
  callStatus?: string;
  callDurationSeconds?: number;
  didAttend?: string | null;
  didRecall?: boolean | null;
  cropsDiscussed?: string[];
  productsDiscussed?: string[];
  hasPurchased?: boolean | null;
  willingToPurchase?: boolean | null;
  likelyPurchaseDate?: string;
  nonPurchaseReason?: string;
  purchasedProducts?: Array<{ product: string; quantity: string; unit: string }>;
  farmerComments?: string;
  sentiment?: 'Positive' | 'Negative' | 'Neutral' | 'N/A';
  activityQuality?: number;
}

interface TaskDetailsPanelProps {
  taskData: {
    taskId: string;
    farmer: {
      name: string;
      location: string;
      preferredLanguage: string;
      mobileNumber?: string;
      photoUrl?: string;
    };
    activity: {
      type: string;
      date: string;
      officer: string;
      location: string; // village
      territory: string;
      state?: string;
    };
    status?: string;
    callStartedAt?: string;
    callLog?: CallLog | null;
    updatedAt?: string;
  } | null;
  isActive: boolean;
}

const TaskDetailsPanel: React.FC<TaskDetailsPanelProps> = ({ taskData, isActive }) => {
  return (
    <section className={`${isActive ? 'flex' : 'hidden'} lg:flex w-full lg:w-80 bg-white border-r border-slate-200 p-4 lg:p-5 flex-col gap-3 shrink-0 overflow-y-auto`}>
      {taskData ? (
        <>
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
              Farmer Document
            </label>
            <div className="p-3 bg-green-50/50 rounded-xl border border-green-100 shadow-inner">
              <div className="flex items-center gap-2 mb-2">
                <div className="relative w-8 h-8 shrink-0">
                  {taskData.farmer.photoUrl ? (
                    <img
                      src={taskData.farmer.photoUrl}
                      alt={taskData.farmer.name}
                      className="w-8 h-8 rounded-lg object-cover shadow border border-green-200 bg-green-100"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div 
                    className={`w-8 h-8 rounded-lg bg-green-100 border border-green-200 shadow flex items-center justify-center ${taskData.farmer.photoUrl ? 'hidden' : ''}`}
                  >
                    <UserCircle className="w-6 h-6 text-green-700" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-slate-900 truncate">{taskData.farmer.name}</h4>
                  {taskData.farmer.mobileNumber && (
                    <a
                      href={`tel:${taskData.farmer.mobileNumber.replace(/\s/g, '')}`}
                      className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-wide text-emerald-800 tabular-nums hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-1 rounded-sm"
                    >
                      <Phone size={20} className="text-lime-600 shrink-0" strokeWidth={2.25} aria-hidden />
                      <span>{taskData.farmer.mobileNumber}</span>
                    </a>
                  )}
                </div>
              </div>
              {taskData.farmer.preferredLanguage ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                  <span className="text-slate-400 font-bold">Language:</span>
                  <span className="text-slate-700 font-medium">{taskData.farmer.preferredLanguage}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
              Activity Reference
            </label>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[8px] font-black bg-indigo-700 text-white px-2 py-0.5 rounded-full uppercase">
                  {taskData.activity.type}
                </span>
                {(() => {
                  try {
                    const dateObj = new Date(taskData.activity.date);
                    const dateStr = dateObj.toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    });
                    const timeStr = dateObj.toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit',
                      hour12: true 
                    });
                    return (
                      <span className="text-[9px] font-bold text-slate-400">
                        {dateStr} • {timeStr}
                      </span>
                    );
                  } catch {
                    return (
                      <span className="text-[9px] font-bold text-slate-400">
                        {taskData.activity.date}
                      </span>
                    );
                  }
                })()}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <User size={10} className="text-slate-400" />
                  <span className="text-slate-400 font-bold">FDA:</span>
                  <span className="text-slate-700 font-medium truncate">{taskData.activity.officer}</span>
                </div>
                {taskData.activity.tm && (
                  <div className="flex items-center gap-1.5">
                    <User size={10} className="text-slate-400" />
                    <span className="text-slate-400 font-bold">TM:</span>
                    <span className="text-slate-700 font-medium truncate">{taskData.activity.tm}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <MapPin size={10} className="text-slate-400" />
                  <span className="text-slate-400 font-bold">Village:</span>
                  <span className="text-slate-700 font-medium truncate">{taskData.activity.location}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Layout size={10} className="text-slate-400" />
                  <span className="text-slate-400 font-bold">Territory:</span>
                  <span className="text-slate-700 font-medium truncate">{taskData.activity.territory || 'N/A'}</span>
                </div>
                {taskData.activity.state && (
                  <div className="flex items-center gap-1.5 col-span-2">
                    <MapPin size={10} className="text-slate-400" />
                    <span className="text-slate-400 font-bold">State:</span>
                    <span className="text-slate-700 font-medium">{taskData.activity.state}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Call Information - Show ALL fields for completed tasks */}
          {taskData.callLog && (
            <>
              {/* Call Status & Duration - Always show */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  Call Information
                </label>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  {/* Outbound Status - Always show */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] text-slate-400 font-bold uppercase">Status:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      taskData.callLog.callStatus === 'Connected'
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-slate-200 text-slate-700 border border-slate-300'
                    }`}>
                      {taskData.callLog.callStatus || '-'}
                    </span>
                    {taskData.callStartedAt && (
                      <>
                        <span className="text-slate-300">•</span>
                        <Clock size={10} className="text-slate-400" />
                        <span className="text-[10px] text-slate-600">
                          {new Date(taskData.callStartedAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </span>
                      </>
                    )}
                    {taskData.callLog.callDurationSeconds !== undefined && taskData.callLog.callDurationSeconds > 0 && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-[10px] text-slate-600">
                          {Math.floor(taskData.callLog.callDurationSeconds / 60)}:{(taskData.callLog.callDurationSeconds % 60).toString().padStart(2, '0')}
                        </span>
                      </>
                    )}
                  </div>
                  
                  {/* Meeting Attendance - Always show if call was Connected */}
                  {taskData.callLog.callStatus === 'Connected' && (
                    <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-slate-200">
                      <span className="text-slate-400 font-bold uppercase">Attendance:</span>
                      <span className="text-slate-700 font-medium">{taskData.callLog.didAttend || '-'}</span>
                    </div>
                  )}
                  
                  {/* Recall Content - Always show if call was Connected and didAttend was answered */}
                  {taskData.callLog.callStatus === 'Connected' && taskData.callLog.didAttend && 
                   (taskData.callLog.didAttend === 'Yes, I attended' || taskData.callLog.didAttend === "Don't recall") && (
                    <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-slate-200">
                      <span className="text-slate-400 font-bold uppercase">Recall:</span>
                      <span className="text-slate-700 font-medium">
                        {taskData.callLog.didRecall !== null && taskData.callLog.didRecall !== undefined 
                          ? (taskData.callLog.didRecall ? 'Yes' : 'No')
                          : '-'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Products & Crops Discussed - Always show if recall was answered (Yes) */}
              {taskData.callLog.callStatus === 'Connected' && 
               taskData.callLog.didAttend && 
               (taskData.callLog.didAttend === 'Yes, I attended' || taskData.callLog.didAttend === "Don't recall") &&
               taskData.callLog.didRecall === true && (
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    4. Products & Crops Discussed
                  </label>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div>
                      <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Crops:</p>
                      {taskData.callLog.cropsDiscussed && taskData.callLog.cropsDiscussed.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {taskData.callLog.cropsDiscussed.map((crop, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium border border-green-200"
                            >
                              {crop}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-500">-</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Products:</p>
                      {taskData.callLog.productsDiscussed && taskData.callLog.productsDiscussed.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {taskData.callLog.productsDiscussed.map((product, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-medium border border-indigo-200"
                            >
                              {product}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-500">-</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 4B. Activity Quality - FDA holistic crop solution */}
              {taskData.callLog.callStatus === 'Connected' && taskData.callLog.didRecall === true && taskData.callLog.activityQuality != null && taskData.callLog.activityQuality >= 1 && taskData.callLog.activityQuality <= 5 && (
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    4B. Activity Quality
                  </label>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">FDA holistic crop solution</p>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        taskData.callLog.activityQuality <= 2
                          ? 'bg-red-600 text-white border-red-600'
                          : taskData.callLog.activityQuality === 3
                            ? 'bg-amber-500 text-white border-amber-500'
                            : taskData.callLog.activityQuality === 4
                              ? 'bg-green-400 text-white border-green-400'
                              : 'bg-green-700 text-white border-green-700'
                      }`}
                    >
                      {'⭐'.repeat(taskData.callLog.activityQuality)} {(['', 'Did not understand or provide a solution', 'Limited understanding; partial solution', 'Understood problem, basic solution', 'Good understanding; mostly holistic solution', 'Excellent understanding; complete holistic solution'] as const)[taskData.callLog.activityQuality]}
                    </span>
                  </div>
                </div>
              )}

              {/* Commercial Conversion - Always show if crops/products were discussed */}
              {taskData.callLog.callStatus === 'Connected' && 
               taskData.callLog.didRecall === true &&
               ((taskData.callLog.cropsDiscussed && taskData.callLog.cropsDiscussed.length > 0) || 
                (taskData.callLog.productsDiscussed && taskData.callLog.productsDiscussed.length > 0)) && (
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    5. Commercial Conversion
                  </label>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Purchased:</span>
                      {taskData.callLog.hasPurchased !== null && taskData.callLog.hasPurchased !== undefined ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          taskData.callLog.hasPurchased
                            ? 'bg-green-100 text-green-700 border border-green-200'
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {taskData.callLog.hasPurchased ? 'Yes' : 'No'}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">-</span>
                      )}
                    </div>
                    {taskData.callLog.hasPurchased === true && taskData.callLog.purchasedProducts && taskData.callLog.purchasedProducts.length > 0 && (
                      <div className="pt-1 border-t border-slate-200">
                        <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Products:</p>
                        <div className="space-y-1">
                          {taskData.callLog.purchasedProducts.map((item, idx) => (
                            <div key={idx} className="text-[10px] text-slate-700">
                              <span className="font-bold">{item.product}</span>
                              {item.quantity && (
                                <>
                                  <span className="text-slate-400 mx-1">•</span>
                                  <span>{item.quantity} {item.unit}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {taskData.callLog.hasPurchased === false && (
                      <>
                        {taskData.callLog.willingToPurchase !== null && taskData.callLog.willingToPurchase !== undefined && (
                          <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                            <span className="text-[9px] text-slate-400 font-bold uppercase">Future Buy:</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              taskData.callLog.willingToPurchase
                                ? 'bg-green-100 text-green-700 border border-green-200'
                                : 'bg-red-100 text-red-700 border border-red-200'
                            }`}>
                              {taskData.callLog.willingToPurchase ? 'Yes' : 'No'}
                            </span>
                            {taskData.callLog.willingToPurchase === true && taskData.callLog.likelyPurchaseDate && (
                              <span className="text-[10px] text-slate-600">
                                ({new Date(taskData.callLog.likelyPurchaseDate).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })})
                              </span>
                            )}
                          </div>
                        )}
                        {taskData.callLog.nonPurchaseReason && (
                          <div className="pt-1 border-t border-slate-200">
                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Reason:</p>
                            <p className="text-[10px] font-medium text-slate-800">{taskData.callLog.nonPurchaseReason}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Farmer Comments & Sentiment - Always show if callLog exists */}
              {taskData.callLog && (
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    6. Farmer Feedback
                  </label>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare size={10} className="text-slate-400" />
                        <p className="text-[9px] text-slate-400 font-bold uppercase">Comments:</p>
                      </div>
                      {taskData.callLog.farmerComments ? (
                        <p className="text-[10px] text-slate-700 whitespace-pre-wrap leading-relaxed">{taskData.callLog.farmerComments}</p>
                      ) : (
                        <p className="text-[10px] text-slate-500">-</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                      {taskData.callLog.sentiment === 'Positive' && <TrendingUp size={10} className="text-green-600" />}
                      {taskData.callLog.sentiment === 'Negative' && <TrendingDown size={10} className="text-red-600" />}
                      {taskData.callLog.sentiment === 'Neutral' && <Minus size={10} className="text-slate-600" />}
                      {!taskData.callLog.sentiment || taskData.callLog.sentiment === 'N/A' ? (
                        <Minus size={10} className="text-slate-400" />
                      ) : null}
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Sentiment:</span>
                      {taskData.callLog.sentiment && taskData.callLog.sentiment !== 'N/A' ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          taskData.callLog.sentiment === 'Positive'
                            ? 'bg-green-100 text-green-700 border border-green-200'
                            : taskData.callLog.sentiment === 'Negative'
                            ? 'bg-red-100 text-red-700 border border-red-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          {taskData.callLog.sentiment}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">-</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full border-4 border-green-200 border-t-green-700 mx-auto flex items-center justify-center">
              <User className="text-green-700" size={32} />
            </div>
            <p className="font-bold text-green-800 text-lg">No Task Loaded</p>
            <p className="text-sm text-slate-500">Click "Load Tasks" in the header to fetch a task</p>
          </div>
        </div>
      )}
    </section>
  );
};

export default TaskDetailsPanel;

