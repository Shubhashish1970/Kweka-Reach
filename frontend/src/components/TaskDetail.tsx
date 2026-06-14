import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { tasksAPI, usersAPI } from '../services/api';
import { ArrowLeft, User as UserIcon, Phone, MapPin, Calendar, Clock, CheckCircle, XCircle, AlertCircle, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import Button from './shared/Button';
import StyledSelect from './shared/StyledSelect';
import ReassignModal from './ReassignModal';
import { getTaskStatusLabel } from '../utils/taskStatusLabels';
import { formatDateIST, formatDateTimeIST } from '../utils/dateRangeUtils';

interface Task {
  _id: string;
  status: 'sampled_in_queue' | 'in_progress' | 'completed' | 'not_reachable' | 'invalid_number';
  scheduledDate: string;
  farmerId: {
    name: string;
    mobileNumber: string;
    location: string;
    preferredLanguage: string;
    photoUrl?: string;
    territory?: string;
  };
  activityId: {
    type: string;
    date: string;
    officerName: string;
    location: string;
    territory: string;
    tmName?: string;
    state?: string;
    zoneName?: string;
    buName?: string;
    crops?: string[];
    products?: string[];
  };
  assignedAgentId: {
    _id: string;
    name: string;
    email: string;
    employeeId: string;
  };
  callLog?: {
    timestamp: string;
    callStatus: string;
    didAttend?: string | null;
    didRecall?: boolean | null;
    cropsDiscussed?: string[];
    productsDiscussed?: string[];
    activityQuality?: number;
    hasPurchased?: boolean | null;
    willingToPurchase?: boolean | null;
    nonPurchaseReason?: string;
    farmerComments?: string;
    sentiment?: 'Positive' | 'Negative' | 'Neutral' | 'N/A';
  };
  interactionHistory?: Array<{
    timestamp: string;
    status: string;
    notes?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface TaskDetailProps {
  task: Task;
  onBack: () => void;
  onTaskUpdated: () => void;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, onBack, onTaskUpdated }) => {
  const { user, activeRole } = useAuth();
  
  // Use activeRole for permission checks, fallback to user.role
  const currentRole = activeRole || user?.role;
  const { showSuccess, showError } = useToast();
  const [fullTask, setFullTask] = useState<Task | null>(task);
  const [isLoading, setIsLoading] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Fetch full task details
  React.useEffect(() => {
    const fetchFullTask = async () => {
      setIsLoading(true);
      try {
        const response = await tasksAPI.getTaskById(task._id) as any;
        if (response.success && response.data?.task) {
          setFullTask(response.data.task);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load task details');
      } finally {
        setIsLoading(false);
      }
    };
    fetchFullTask();
  }, [task._id]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      sampled_in_queue: { icon: Clock, color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
      in_progress: { icon: Loader2, color: 'bg-blue-100 text-blue-800 border-blue-200' },
      completed: { icon: CheckCircle, color: 'bg-green-100 text-green-800 border-green-200' },
      not_reachable: { icon: XCircle, color: 'bg-orange-100 text-orange-800 border-orange-200' },
      invalid_number: { icon: AlertCircle, color: 'bg-red-100 text-red-800 border-red-200' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.sampled_in_queue;
    const Icon = config.icon;
    const label = getTaskStatusLabel(status);

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${config.color}`}>
        <Icon size={14} className={status === 'in_progress' ? 'animate-spin' : ''} />
        {label}
      </span>
    );
  };

  const formatDate = (dateString: string) => formatDateIST(dateString);

  const formatDateTime = (dateString: string) => formatDateTimeIST(dateString);

  const canReassign = user && (currentRole === 'team_lead' || currentRole === 'mis_admin');
  const canChangeStatus = user && (currentRole === 'team_lead' || currentRole === 'mis_admin');

  const handleStatusUpdate = async (newStatus: string, notes?: string) => {
    setIsUpdatingStatus(true);
    try {
      const response = await tasksAPI.updateTaskStatus(fullTask._id, newStatus, notes) as any;
      if (response.success) {
        setShowStatusModal(false);
        showSuccess('Task status updated successfully');
        onTaskUpdated();
      } else {
        const errorMsg = 'Failed to update task status';
        setError(errorMsg);
        showError(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to update task status';
      setError(errorMsg);
      showError(errorMsg);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f1f5f1] p-6 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto mb-4 text-green-700" size={32} />
          <p className="text-sm text-slate-600 font-medium">Loading task details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f1f5f1] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center">
            <AlertCircle className="mx-auto mb-4 text-red-500" size={32} />
            <p className="text-sm text-red-600 font-medium mb-4">{error}</p>
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft size={16} /> Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!fullTask) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#f1f5f1] p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-3xl p-6 mb-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft size={16} /> Back to List
            </Button>
            <div className="flex items-center gap-3">
              {canChangeStatus && (
                <Button variant="secondary" size="sm" onClick={() => setShowStatusModal(true)}>
                  Change Status
                </Button>
              )}
              {canReassign && (
                <Button variant="secondary" size="sm" onClick={() => setShowReassignModal(true)}>
                  Reassign Task
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-start gap-4">
            {/* Farmer Avatar */}
            <div className="flex-shrink-0">
              {fullTask.farmerId.photoUrl ? (
                <img
                  src={fullTask.farmerId.photoUrl}
                  alt={fullTask.farmerId.name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-slate-200"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = '/images/farmer-default-logo.png';
                  }}
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
                  <UserIcon className="text-slate-400" size={32} />
                </div>
              )}
            </div>

            {/* Farmer Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-black text-slate-900">{fullTask.farmerId.name}</h1>
                {getStatusBadge(fullTask.status)}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-600 mb-4">
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-slate-400" />
                  <span className="font-medium">{fullTask.farmerId.mobileNumber}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin size={16} className="text-slate-400" />
                  <span>{fullTask.farmerId.location}</span>
                </div>
                <div className="flex items-center gap-2">
                  <UserIcon size={16} className="text-slate-400" />
                  <span>Language: {fullTask.farmerId.preferredLanguage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-slate-400" />
                  <span>Scheduled: {formatDate(fullTask.scheduledDate)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Activity Details */}
        <div className="bg-white rounded-3xl p-6 mb-6 border border-slate-200 shadow-sm">
          <h2 className="text-lg font-black text-slate-900 mb-4">Activity Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Activity Type</p>
              <p className="text-sm font-medium text-slate-700">{fullTask.activityId.type}</p>
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Date</p>
              <p className="text-sm font-medium text-slate-700">{formatDate(fullTask.activityId.date)}</p>
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">FDA</p>
              <p className="text-sm font-medium text-slate-700">{fullTask.activityId.officerName}</p>
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">TM</p>
              <p className="text-sm font-medium text-slate-700">{fullTask.activityId.tmName || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Location</p>
              <p className="text-sm font-medium text-slate-700">{fullTask.activityId.location}</p>
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Territory</p>
              <p className="text-sm font-medium text-slate-700">{fullTask.activityId.territory}</p>
            </div>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">State</p>
              <p className="text-sm font-medium text-slate-700">{fullTask.activityId.state || 'N/A'}</p>
            </div>
            {fullTask.activityId.crops && fullTask.activityId.crops.length > 0 && (
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Crops Discussed</p>
                <div className="flex flex-wrap gap-2">
                  {fullTask.activityId.crops.map((crop, idx) => (
                    <span key={idx} className="px-3 py-1 bg-green-50 text-green-700 rounded-xl text-xs font-medium border border-green-200">
                      {crop}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {fullTask.activityId.products && fullTask.activityId.products.length > 0 && (
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Products Discussed</p>
                <div className="flex flex-wrap gap-2">
                  {fullTask.activityId.products.map((product, idx) => (
                    <span key={idx} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium border border-blue-200">
                      {product}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Assigned Agent */}
        <div className="bg-white rounded-3xl p-6 mb-6 border border-slate-200 shadow-sm">
          <h2 className="text-lg font-black text-slate-900 mb-4">Assigned Agent</h2>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
              <UserIcon className="text-slate-400" size={20} />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{fullTask.assignedAgentId.name}</p>
              <p className="text-xs text-slate-600">{fullTask.assignedAgentId.email}</p>
              <p className="text-xs text-slate-500">ID: {fullTask.assignedAgentId.employeeId}</p>
            </div>
          </div>
        </div>

        {/* Call Log */}
        {fullTask.callLog && (
          <div className="bg-white rounded-3xl p-6 mb-6 border border-slate-200 shadow-sm">
            <h2 className="text-lg font-black text-slate-900 mb-4">Call Interaction</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Call Status</p>
                <p className="text-sm font-medium text-slate-700">{fullTask.callLog.callStatus}</p>
              </div>
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Call Date & Time</p>
                <p className="text-sm font-medium text-slate-700">{formatDateTime(fullTask.callLog.timestamp)}</p>
              </div>
              {fullTask.callLog.didAttend !== null && fullTask.callLog.didAttend !== undefined && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Did Attend Meeting</p>
                  <p className="text-sm font-medium text-slate-700">{fullTask.callLog.didAttend ? 'Yes' : 'No'}</p>
                </div>
              )}
              {fullTask.callLog.didRecall !== null && fullTask.callLog.didRecall !== undefined && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Did Recall Content</p>
                  <p className="text-sm font-medium text-slate-700">{fullTask.callLog.didRecall ? 'Yes' : 'No'}</p>
                </div>
              )}
              {fullTask.callLog.cropsDiscussed && fullTask.callLog.cropsDiscussed.length > 0 && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Crops Discussed</p>
                  <div className="flex flex-wrap gap-2">
                    {fullTask.callLog.cropsDiscussed.map((crop, idx) => (
                      <span key={idx} className="px-3 py-1 bg-green-50 text-green-700 rounded-xl text-xs font-medium border border-green-200">
                        {crop}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {fullTask.callLog.productsDiscussed && fullTask.callLog.productsDiscussed.length > 0 && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Products Discussed</p>
                  <div className="flex flex-wrap gap-2">
                    {fullTask.callLog.productsDiscussed.map((product, idx) => (
                      <span key={idx} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium border border-blue-200">
                        {product}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {fullTask.callLog.activityQuality != null && fullTask.callLog.activityQuality >= 1 && fullTask.callLog.activityQuality <= 5 && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">4B. Activity Quality – FDA holistic crop solution</p>
                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold border ${
                      fullTask.callLog.activityQuality <= 2
                        ? 'bg-red-600 text-white border-red-600'
                        : fullTask.callLog.activityQuality === 3
                          ? 'bg-amber-500 text-white border-amber-500'
                          : fullTask.callLog.activityQuality === 4
                            ? 'bg-green-400 text-white border-green-400'
                            : 'bg-green-700 text-white border-green-700'
                    }`}
                  >
                    {'⭐'.repeat(fullTask.callLog.activityQuality)} {(['', 'Did not understand or provide a solution', 'Limited understanding; partial solution', 'Understood problem, basic solution', 'Good understanding; mostly holistic solution', 'Excellent understanding; complete holistic solution'] as const)[fullTask.callLog.activityQuality]}
                  </span>
                </div>
              )}
              {fullTask.callLog.farmerComments && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Farmer Comments</p>
                    {fullTask.callLog.sentiment && fullTask.callLog.sentiment !== 'N/A' && (
                      <div className="flex items-center gap-1">
                        {fullTask.callLog.sentiment === 'Positive' && <TrendingUp size={12} className="text-green-600" />}
                        {fullTask.callLog.sentiment === 'Negative' && <TrendingDown size={12} className="text-red-600" />}
                        {fullTask.callLog.sentiment === 'Neutral' && <Minus size={12} className="text-slate-600" />}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          fullTask.callLog.sentiment === 'Positive' ? 'bg-green-100 text-green-700' :
                          fullTask.callLog.sentiment === 'Negative' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {fullTask.callLog.sentiment}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{fullTask.callLog.farmerComments}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Interaction History */}
        {fullTask.interactionHistory && fullTask.interactionHistory.length > 0 && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
            <h2 className="text-lg font-black text-slate-900 mb-4">Interaction History</h2>
            <div className="space-y-3">
              {fullTask.interactionHistory.map((history, idx) => (
                <div key={idx} className="flex items-start gap-3 pb-3 border-b border-slate-100 last:border-0">
                  <Clock size={16} className="text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-900">{getStatusBadge(history.status)}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(history.timestamp)}</span>
                    </div>
                    {history.notes && (
                      <p className="text-xs text-slate-600">{history.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reassign Modal */}
        {showReassignModal && (
          <ReassignModal
            isOpen={showReassignModal}
            onClose={() => setShowReassignModal(false)}
            task={fullTask}
            onReassigned={() => {
              setShowReassignModal(false);
              onTaskUpdated();
            }}
          />
        )}

        {/* Status Change Modal */}
        {showStatusModal && (
          <StatusChangeModal
            isOpen={showStatusModal}
            onClose={() => setShowStatusModal(false)}
            currentStatus={fullTask.status}
            onUpdate={handleStatusUpdate}
            isProcessing={isUpdatingStatus}
          />
        )}
      </div>
    </div>
  );
};

// Status Change Modal Component
interface StatusChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStatus: string;
  onUpdate: (status: string, notes?: string) => void;
  isProcessing: boolean;
}

const StatusChangeModal: React.FC<StatusChangeModalProps> = ({ isOpen, onClose, currentStatus, onUpdate, isProcessing }) => {
  const [status, setStatus] = useState<string>(currentStatus);
  const [notes, setNotes] = useState<string>('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    onUpdate(status, notes || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-3xl p-6 max-w-md w-full mx-4 border border-slate-200 shadow-xl">
        <h2 className="text-xl font-black text-slate-900 mb-4">Change Task Status</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              New Status
            </label>
            <StyledSelect
              value={status}
              onChange={(value) => setStatus(value)}
              options={[
                { value: 'sampled_in_queue', label: 'Sampled - in queue' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed', label: 'Completed' },
                { value: 'not_reachable', label: 'Not Reachable' },
                { value: 'invalid_number', label: 'Invalid Number' },
              ]}
              placeholder="Select status"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              placeholder="Add notes about this status change..."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={isProcessing}>
            {isProcessing ? 'Updating...' : 'Update Status'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TaskDetail;
