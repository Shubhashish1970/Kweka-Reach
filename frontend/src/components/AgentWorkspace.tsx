import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { tasksAPI } from '../services/api';
import {
  Phone, User, CheckCircle, Zap, LogOut, Globe, Loader2,
  TrendingUp, MapPin, History, X, PhoneOff, PhoneCall
} from 'lucide-react';
import BinaryToggle from './BinaryToggle';
import MultiTagSelect from './MultiTagSelect';
import CallTimer from './CallTimer';
import TaskDetailsPanel from './TaskDetailsPanel';
import CallInteractionForm from './CallInteractionForm';
import AICopilotPanel from './AICopilotPanel';
import CallReviewModal from './CallReviewModal';
import TaskSelectionModal from './TaskSelectionModal';
import Button from './shared/Button';
import HeaderRoleSwitcher from './shared/HeaderRoleSwitcher';
import AgentHistoryView from './AgentHistoryView';
import AgentAnalyticsView from './AgentAnalyticsView';

// Business Constants
const IndianCrops = ['Paddy', 'Cotton', 'Chilli', 'Soybean', 'Maize', 'Wheat', 'Sugarcane'];
const AgriProducts = ['Nagarjuna Urea', 'Specialty Fungicide', 'Bio-Stimulant X', 'Insecticide Pro', 'Root Booster'];
const NonPurchaseReasons = ['Price', 'Availability', 'Brand preference', 'No requirement', 'Not convinced', 'Other'];

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
  activityQuality?: number; // 1-5 (4B. Activity Quality)
}

interface TaskData {
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
    tm?: string;
    location: string; // village
    territory?: string;
    state?: string;
    crops?: string[];
    products?: string[];
  };
  status?: string;
  callStartedAt?: string;
  callLog?: CallLog | null;
  updatedAt?: string;
}

const AgentWorkspace: React.FC = () => {
  const { user, logout, activeRole } = useAuth();
  const { showError, showWarning } = useToast();
  const [callDuration, setCallDuration] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'flow' | 'ai'>('flow');
  const [activeSection, setActiveSection] = useState<'dialer' | 'history' | 'analytics'>('dialer');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showTaskSelectionModal, setShowTaskSelectionModal] = useState(false);
  const [isAIPanelExpanded, setIsAIPanelExpanded] = useState(false);
  const aiPanelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMarkedInProgressRef = useRef(false);

  const openAIPanel = () => {
    if (aiPanelCloseTimerRef.current) {
      clearTimeout(aiPanelCloseTimerRef.current);
      aiPanelCloseTimerRef.current = null;
    }
    setIsAIPanelExpanded(true);
  };

  const scheduleCloseAIPanel = () => {
    if (aiPanelCloseTimerRef.current) clearTimeout(aiPanelCloseTimerRef.current);
    aiPanelCloseTimerRef.current = setTimeout(() => {
      setIsAIPanelExpanded(false);
      aiPanelCloseTimerRef.current = null;
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (aiPanelCloseTimerRef.current) clearTimeout(aiPanelCloseTimerRef.current);
    };
  }, []);
  const [formData, setFormData] = useState({
    callStatus: '',
    didAttend: null as string | null,
    didRecall: null as boolean | null,
    cropsDiscussed: [] as string[],
    productsDiscussed: [] as string[],
    hasPurchased: null as boolean | null,
    willingToPurchase: null as boolean | null,
    likelyPurchaseDate: undefined as string | undefined,
    nonPurchaseReason: '',
    purchasedProducts: [] as Array<{ product: string; quantity: string; unit: string }>,
    farmerComments: '',
    sentiment: 'N/A' as 'Positive' | 'Negative' | 'Neutral' | 'N/A',
    activityQuality: undefined as number | undefined,
  });

  // Timer for call duration (only when call status is "Connected")
  useEffect(() => {
    if (!taskData || formData.callStatus !== 'Connected') {
      if (formData.callStatus !== 'Connected') {
        setCallDuration(0); // Reset timer if status changes away from Connected
      }
      return;
    }
    
    const timer = setInterval(() => {
      setCallDuration(p => p + 1);
    }, 1000);
    
    return () => clearInterval(timer);
  }, [taskData, formData.callStatus]);


  const handleLoadTasks = () => {
    // Show task selection modal instead of directly loading
    setShowTaskSelectionModal(true);
    setError(null);
  };

  const handleTaskSelected = (selectedTask: any) => {
    // Task is already loaded by the modal, format it for display
    try {
      const formattedTask: TaskData = {
        taskId: selectedTask.taskId,
        farmer: {
          name: selectedTask.farmer.name,
          location: selectedTask.farmer.location,
          preferredLanguage: selectedTask.farmer.preferredLanguage,
          mobileNumber: selectedTask.farmer.mobileNumber,
          photoUrl: selectedTask.farmer.photoUrl,
        },
        activity: {
          type: selectedTask.activity.type,
          date: selectedTask.activity.date,
          officer: selectedTask.activity.officerName,
          tm: selectedTask.activity.tmName || '',
          location: selectedTask.activity.location,
          territory: selectedTask.activity.territory,
          state: selectedTask.activity.state,
          crops: selectedTask.activity.crops || [],
          products: selectedTask.activity.products || [],
        },
      };
      setTaskData(formattedTask);
      setActiveSection('dialer');
      hasMarkedInProgressRef.current = false;
      setError(null);
      
      // Reset form when new task is loaded
      setFormData({
        callStatus: '',
        didAttend: null,
        didRecall: null,
        cropsDiscussed: [],
        productsDiscussed: [],
        hasPurchased: null,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
        purchasedProducts: [],
        farmerComments: '',
        sentiment: 'N/A',
        activityQuality: undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load selected task');
      setTaskData(null);
    }
  };

  const openTaskById = async (taskId: string) => {
    try {
      const res: any = await tasksAPI.loadTask(taskId);
      if (!res?.success || !res?.data) throw new Error(res?.error?.message || 'Failed to load task');
      const d = res.data;
      const formattedTask: TaskData = {
        taskId: String(d.taskId),
        farmer: {
          name: d.farmer?.name,
          location: d.farmer?.location,
          preferredLanguage: d.farmer?.preferredLanguage,
          mobileNumber: d.farmer?.mobileNumber,
          photoUrl: d.farmer?.photoUrl,
        },
        activity: {
          type: d.activity?.type,
          date: d.activity?.date,
          officer: d.activity?.officerName,
          tm: d.activity?.tmName || '',
          location: d.activity?.location,
          territory: d.activity?.territory,
          state: d.activity?.state,
          crops: d.activity?.crops || [],
          products: d.activity?.products || [],
        },
        status: d.status,
        callStartedAt: d.callStartedAt,
        callLog: d.callLog || null,
        updatedAt: d.updatedAt,
      };
      setTaskData(formattedTask);
      setActiveSection('dialer');
      setActiveTab('flow');
      hasMarkedInProgressRef.current = false;
      setError(null);
      setCallDuration(0);
      setFormData({
        callStatus: '',
        didAttend: null,
        didRecall: null,
        cropsDiscussed: [],
        productsDiscussed: [],
        hasPurchased: null,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
        purchasedProducts: [],
        farmerComments: '',
        sentiment: 'N/A',
        activityQuality: undefined,
      });
    } catch (e: any) {
      showError(e?.message || 'Failed to open task');
    }
  };

  const handleOutboundStatusSelected = async () => {
    if (!taskData) return;
    if (hasMarkedInProgressRef.current) return;
    try {
      await tasksAPI.markInProgress(taskData.taskId);
      hasMarkedInProgressRef.current = true;
    } catch {
      // do not block agent workflow
    }
  };

  const handleStopLoading = () => {
    if (abortController) {
      abortController.abort();
    }
    setIsLoading(false);
    setAbortController(null);
  };

  const fetchActiveTask = async (abortSignal?: AbortSignal) => {
    // Check if already aborted
    if (abortSignal?.aborted) {
      console.log('fetchActiveTask: Already aborted, returning');
      return;
    }

    try {
      console.log('fetchActiveTask: Calling API...');
      const response = await tasksAPI.fetchActiveTask(abortSignal);
      console.log('fetchActiveTask: API response received:', response);
      
      // Check if aborted during the call
      if (abortSignal?.aborted) {
        return;
      }
      
      // Handle both response formats: 
      // - No task: { success: true, data: { task: null, message: "..." } }
      // - Task found: { success: true, data: { taskId: "...", farmer: {...}, activity: {...} } }
      console.log('fetchActiveTask: Full response:', JSON.stringify(response, null, 2));
      console.log('fetchActiveTask: response.success:', response.success);
      console.log('fetchActiveTask: response.data exists?', !!response.data);
      
      if (response.success && response.data) {
        console.log('fetchActiveTask: Response data keys:', Object.keys(response.data));
        console.log('fetchActiveTask: taskId value:', response.data.taskId);
        console.log('fetchActiveTask: taskId type:', typeof response.data.taskId);
        console.log('fetchActiveTask: taskId truthy?', !!response.data.taskId);
        console.log('fetchActiveTask: task value:', response.data.task);
        
        // Check if taskId exists (task found) - handle both string and object ID
        const taskId = response.data.taskId;
        const hasTaskId = taskId !== null && taskId !== undefined && taskId !== '';
        
        console.log('fetchActiveTask: hasTaskId check result:', hasTaskId);
        
        if (hasTaskId) {
          console.log('fetchActiveTask: ✅ TaskId found! Processing task data...');
          // Task found - ensure farmer and activity are properly formatted
          const farmer = response.data.farmer;
          const activity = response.data.activity;
          
          console.log('fetchActiveTask: Farmer:', farmer);
          console.log('fetchActiveTask: Activity:', activity);
          console.log('fetchActiveTask: Activity crops:', activity?.crops);
          console.log('fetchActiveTask: Activity products:', activity?.products);
          console.log('fetchActiveTask: Activity crops type:', typeof activity?.crops);
          console.log('fetchActiveTask: Activity crops is array:', Array.isArray(activity?.crops));
          
          if (!farmer || !activity) {
            console.error('fetchActiveTask: ❌ Missing farmer or activity');
            throw new Error('Task data is incomplete. Please try again.');
          }
          
          if (!taskId) {
            console.error('fetchActiveTask: ❌ Missing taskId');
            throw new Error('Task ID is missing');
          }
          
          // Convert taskId to string if it's an object (taskId is guaranteed to be non-null after check above)
          // Store in a const to help TypeScript understand it's non-null
          const safeTaskId: string | { toString(): string } = taskId;
          const taskIdString = typeof safeTaskId === 'object' && 'toString' in safeTaskId && typeof safeTaskId.toString === 'function' 
            ? safeTaskId.toString() 
            : String(safeTaskId);
          
          // Ensure crops and products are arrays
          const activityCrops = Array.isArray(activity.crops) 
            ? activity.crops 
            : (activity.crops ? [activity.crops] : []);
          const activityProducts = Array.isArray(activity.products) 
            ? activity.products 
            : (activity.products ? [activity.products] : []);
          
          // Task found - set task data (map backend field names to frontend format)
          const taskDataToSet = {
            taskId: taskIdString,
            farmer: {
              name: farmer.name || 'Unknown',
              location: farmer.location || 'Unknown',
              preferredLanguage: farmer.preferredLanguage || 'English',
              mobileNumber: farmer.mobileNumber || '',
              photoUrl: farmer.photoUrl || undefined,
            },
            activity: {
              type: activity.type || 'Unknown',
              date: activity.date || new Date().toISOString(),
              officer: activity.officerName || activity.officer || 'Unknown',
              location: activity.location || 'Unknown',
              territory: activity.territory,
              state: activity.state,
              crops: activityCrops, // Crops from activity data
              products: activityProducts, // Products from activity data
            },
          };
          
          console.log('fetchActiveTask: ✅ Prepared taskData:', taskDataToSet);
          console.log('fetchActiveTask: ✅ Activity crops in taskData:', taskDataToSet.activity.crops);
          console.log('fetchActiveTask: ✅ Activity products in taskData:', taskDataToSet.activity.products);
          console.log('fetchActiveTask: Calling setTaskData...');
          setTaskData(taskDataToSet);
          console.log('fetchActiveTask: setTaskData called successfully');
          
          // Reset form when new task is loaded
          setFormData({
            callStatus: '',
            didAttend: null,
            didRecall: null,
            cropsDiscussed: [],
            productsDiscussed: [],
            hasPurchased: null,
            willingToPurchase: null,
            likelyPurchaseDate: undefined,
            nonPurchaseReason: '',
            purchasedProducts: [],
            farmerComments: '',
            sentiment: 'N/A',
            activityQuality: undefined,
          });
          setCallDuration(0);
          // Clear any previous errors
          setError(null);
          console.log('fetchActiveTask: ✅ Task data set successfully!');
        } else {
          // No task available - explicitly set to null
          console.log('fetchActiveTask: ⚠️ No taskId found in response');
          console.log('fetchActiveTask: Response data:', JSON.stringify(response.data, null, 2));
          setTaskData(null);
          setError(null);
        }
      } else {
        // Invalid response or no data
        console.error('fetchActiveTask: ❌ Invalid response structure');
        throw new Error('Invalid response from server. Please try again.');
      }
    } catch (error) {
      // Check if aborted
      if (abortSignal?.aborted) {
        return;
      }
      
      // Log error
      console.error('Error fetching active task:', error);
      // Always set taskData to null on error
      setTaskData(null);
      // Re-throw to let caller handle
      throw error;
    }
  };

  // Backend now accepts raw outbound statuses for accurate reporting.

  const handleFinalSubmit = async () => {
    if (!taskData) return;

    setIsSubmitting(true);
    try {
      const submissionData = {
        ...formData,
        // Persist raw outbound status for reporting; backend will map to task status.
        callStatus: formData.callStatus,
        callDurationSeconds: callDuration,
      };
      
      await tasksAPI.submitInteraction(taskData.taskId, submissionData);
      
      // Clear form and task data
      setFormData({
        callStatus: '',
        didAttend: null,
        didRecall: null,
        cropsDiscussed: [],
        productsDiscussed: [],
        hasPurchased: null,
        willingToPurchase: null,
        likelyPurchaseDate: undefined,
        nonPurchaseReason: '',
        purchasedProducts: [],
        farmerComments: '',
        sentiment: 'N/A',
        activityQuality: undefined,
      });
      setTaskData(null);
      setCallDuration(0);
      
      // Fetch next task
      await handleLoadTasks();
    } catch (error) {
      console.error('Error submitting interaction:', error);
      showError('Failed to submit interaction. Please try again.');
      throw error; // Re-throw to let modal handle it
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinishCall = () => {
    if (!taskData) return;
    
    // Check if call status is selected
    if (!formData.callStatus) {
      showWarning('Please select call status before finishing the call');
      return;
    }
    
    setShowReviewModal(true);
  };

  const toggleList = (field: 'cropsDiscussed' | 'productsDiscussed', item: string) => {
    setFormData(prev => {
      const exists = prev[field].includes(item);
      const updated = exists ? prev[field].filter(i => i !== item) : [...prev[field], item];
      return { ...prev, [field]: updated };
    });
  };

  // Always show the Agent Workspace interface - no conditional rendering

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden relative">
      
      {/* Loading Overlay - Only shows when loading */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center gap-4 shadow-xl">
            <Loader2 className="animate-spin text-lime-600" size={32} />
            <p className="font-bold text-slate-800">Loading tasks...</p>
            <Button 
              variant="secondary" 
              onClick={handleStopLoading}
              size="sm"
            >
              Stop Loading
            </Button>
          </div>
        </div>
      )}

      {/* Error Banner - Shows at top when there's an error */}
      {error && !isLoading && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 shadow-lg max-w-md">
          <X className="text-red-700" size={20} />
          <div className="flex-1">
            <p className="font-bold text-red-800 text-sm">Error Loading Tasks</p>
            <p className="text-xs text-red-600">{error}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={handleLoadTasks} size="sm">
              Retry
            </Button>
            <Button variant="secondary" onClick={() => setError(null)} size="sm">
              Dismiss
            </Button>
          </div>
        </div>
      )}
      
      {/* Global Navigation (Desktop) - Dark Slate Theme */}
      <aside className="hidden lg:flex w-20 flex-col items-center py-8 bg-slate-900 text-white shadow-2xl z-30">
        <nav className="flex flex-col gap-8">
          <button
            onClick={() => setActiveSection('dialer')}
            className={`p-3 rounded-2xl border transition-all ${
              activeSection === 'dialer'
                ? 'bg-lime-500/20 text-lime-400 border-lime-500/30 shadow-lg'
                : 'bg-transparent text-slate-400 border-transparent hover:text-white hover:bg-slate-800'
            }`}
            title="Dialer"
          >
            <Phone size={24} />
          </button>
          <button
            onClick={() => setActiveSection('history')}
            className={`p-3 rounded-2xl transition-all ${
              activeSection === 'history' 
                ? 'text-lime-400 bg-lime-500/20' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="History"
          >
            <History size={24} />
          </button>
          <button
            onClick={() => setActiveSection('analytics')}
            className={`p-3 rounded-2xl transition-all ${
              activeSection === 'analytics' 
                ? 'text-lime-400 bg-lime-500/20' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Performance"
          >
            <TrendingUp size={24} />
          </button>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* Unified Task Header - Dark Slate Theme */}
        <header className="h-20 bg-slate-900 px-4 lg:px-8 flex items-center justify-between shrink-0 shadow-lg z-20">
          <div className="flex items-center gap-4 lg:gap-8">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-lime-400 uppercase tracking-[0.2em]">Kweka Reach</span>
              <h1 className="text-base lg:text-xl font-black text-white tracking-tight">Agent Workspace</h1>
            </div>
            <div className="h-10 w-px bg-slate-700 hidden md:block" />
            {taskData && formData.callStatus === 'Connected' && (
              <div className="hidden sm:flex items-center gap-3">
                <CallTimer duration={callDuration} />
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-2xl text-[11px] font-bold text-slate-300 uppercase">
                  <Globe size={14} className="text-lime-400" />
                  {taskData.farmer.preferredLanguage}
                </div>
              </div>
            )}
            {activeSection === 'dialer' && !taskData && (
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Load Tasks button clicked!');
                    handleLoadTasks().catch(err => {
                      console.error('Error in handleLoadTasks:', err);
                    });
                  }}
                  disabled={isLoading}
                  type="button"
                  className="px-4 py-2 bg-lime-500 text-slate-900 rounded-2xl text-xs font-bold hover:bg-lime-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Phone size={16} />
                      Load Tasks
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* User Info */}
            {user && (
              <div className="hidden sm:flex items-center gap-2 text-sm text-slate-300">
                <User size={16} className="text-slate-400" />
                <span className="font-medium">{user.name}</span>
                <span className="text-slate-500">•</span>
                <HeaderRoleSwitcher />
              </div>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all"
              title="Logout"
            >
              <LogOut size={18} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {activeSection !== 'dialer' ? (
          <div className="flex-1 min-w-0 overflow-hidden relative">
            {activeSection === 'history' && <AgentHistoryView onOpenTask={openTaskById} />}
            {activeSection === 'analytics' && <AgentAnalyticsView />}
          </div>
        ) : (
          /* Main Three-Pane Interface */
          <div className="flex-1 flex overflow-hidden relative">
          
          {/* Document Context (Details) */}
          <TaskDetailsPanel 
            taskData={taskData}
            isActive={activeTab === 'details'}
          />

          {/* Structured Submission (Flow) */}
              <CallInteractionForm
                taskData={taskData}
                formData={formData}
                setFormData={setFormData}
                toggleList={toggleList}
                handleFinalSubmit={handleFinalSubmit}
                isSubmitting={isSubmitting}
                isActive={activeTab === 'flow'}
                IndianCrops={taskData?.activity?.crops || IndianCrops}
                AgriProducts={taskData?.activity?.products || AgriProducts}
                NonPurchaseReasons={NonPurchaseReasons}
                isAIPanelExpanded={isAIPanelExpanded}
                onOutboundStatusSelected={handleOutboundStatusSelected}
              />

          {/* Edge-only hover strip: opens Notetaker only when cursor reaches the viewport edge (not a wide margin). */}
          <div
            className="hidden lg:block fixed right-0 top-20 bottom-0 w-1.5 z-[45] pointer-events-auto"
            onMouseEnter={openAIPanel}
            onMouseLeave={scheduleCloseAIPanel}
            title="Show Notetaker"
            aria-hidden
          />

          {/* AI Copilot (AI) - Slides in from the right; stays open while pointer is on panel or edge strip */}
          <div
            className={`hidden lg:block fixed right-0 top-20 bottom-0 z-50 transition-transform duration-300 ease-in-out ${
              isAIPanelExpanded ? 'translate-x-0' : 'translate-x-full pointer-events-none'
            }`}
            onMouseEnter={openAIPanel}
            onMouseLeave={scheduleCloseAIPanel}
            aria-hidden={!isAIPanelExpanded}
          >
            <AICopilotPanel
              formData={formData}
              setFormData={setFormData}
              isActive={activeTab === 'ai'}
              taskData={taskData}
              onFarmerCommentsAutoFilled={() => {}}
            />
          </div>

          {/* Mobile: Always show AI panel in tab view */}
          <div className="lg:hidden">
            <AICopilotPanel
              formData={formData}
              setFormData={setFormData}
              isActive={activeTab === 'ai'}
              taskData={taskData}
              onFarmerCommentsAutoFilled={() => {}}
            />
          </div>

        </div>
        )}

        {/* Mobile Interaction Navigation */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 h-20 bg-slate-900 border-t border-slate-800 flex items-center justify-around z-50 shadow-[0_-10px_30px_rgba(0,0,0,0.2)] px-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex flex-col items-center gap-1.5 px-6 py-2 rounded-2xl transition-all ${activeTab === 'details' ? 'text-lime-400 bg-lime-500/20' : 'text-slate-400'}`}
          >
            <User size={22} fill={activeTab === 'details' ? 'currentColor' : 'none'} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Details</span>
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            className={`flex flex-col items-center gap-1.5 px-6 py-2 rounded-2xl transition-all ${activeTab === 'flow' ? 'text-lime-400 bg-lime-500/20' : 'text-slate-400'}`}
          >
            <CheckCircle size={22} fill={activeTab === 'flow' ? 'currentColor' : 'none'} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Flow</span>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex flex-col items-center gap-1.5 px-6 py-2 rounded-2xl transition-all ${activeTab === 'ai' ? 'text-lime-400 bg-lime-500/20' : 'text-slate-400'}`}
          >
            <Zap size={22} fill={activeTab === 'ai' ? 'currentColor' : 'none'} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Notetaker</span>
          </button>
        </div>
      </main>

      {/* Floating action: open contact list, or finish/save call when a task is active on the dialer */}
      {(() => {
        const fabIsFinish = activeSection === 'dialer' && !!taskData;
        const finishLabel =
          formData.callStatus === 'Connected' ? 'Finish call' : 'Save call attempt';
        return (
          <button
            type="button"
            onClick={() => {
              if (fabIsFinish) handleFinishCall();
              else setShowTaskSelectionModal(true);
            }}
            disabled={fabIsFinish && (isSubmitting || !formData.callStatus)}
            className={`fixed bottom-6 right-6 w-16 h-16 rounded-full shadow-2xl flex items-center justify-center z-40 transition-all border-4 border-white ${
              fabIsFinish
                ? 'bg-rose-500 hover:bg-rose-400 text-white disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:scale-100 hover:scale-110 active:scale-95'
                : 'bg-lime-500 hover:bg-lime-400 text-slate-900 hover:scale-110 active:scale-95 disabled:opacity-50'
            }`}
            title={
              fabIsFinish
                ? !formData.callStatus
                  ? 'Select outbound status first'
                  : finishLabel
                : 'Switch farmer / load task'
            }
            aria-label={fabIsFinish ? finishLabel : 'Open contact dialer'}
          >
            {fabIsFinish ? <PhoneOff size={28} className="text-white" strokeWidth={2.25} /> : <PhoneCall size={28} className="text-slate-900" />}
          </button>
        );
      })()}

      {/* Task Selection Modal */}
      <TaskSelectionModal
        isOpen={showTaskSelectionModal}
        onClose={() => setShowTaskSelectionModal(false)}
        onSelectTask={handleTaskSelected}
      />

      {/* Call Review Modal */}
      {taskData && (
        <CallReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          formData={formData}
          onFinalSubmit={handleFinalSubmit}
          isSubmitting={isSubmitting}
          callDuration={callDuration}
          farmerName={taskData.farmer.name}
        />
      )}
    </div>
  );
};

export default AgentWorkspace;
