import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { tasksAPI } from '../../services/api';

const mapBulkCancelError = (message: string): string => {
  if (message.includes('activityDateFrom and activityDateTo are required')) {
    return 'Please select both start and end dates for activity supersede.';
  }
  if (message.includes('activityDateFrom must be on or before activityDateTo')) {
    return 'Start date must be on or before end date.';
  }
  return message;
};

export interface BulkCancelPreview {
  tasksToCancel: number;
  tasksSkippedInProgress: number;
  tasksSkippedOther: number;
  activitiesToSupersede: number;
}

interface BulkCancelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancelled: (result: { cancelled: number; supersededActivities: number }) => void;
  agentId?: string;
  agentName?: string;
  taskIds?: string[];
}

const BulkCancelModal: React.FC<BulkCancelModalProps> = ({
  isOpen,
  onClose,
  onCancelled,
  agentId,
  agentName,
  taskIds,
}) => {
  const [preview, setPreview] = useState<BulkCancelPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supersedeActivities, setSupersedeActivities] = useState(false);
  const [activityDateFrom, setActivityDateFrom] = useState('');
  const [activityDateTo, setActivityDateTo] = useState('');

  const isAgentQueueCancel = Boolean(agentId);
  const hasSupersedeDateRange = Boolean(activityDateFrom && activityDateTo);
  const includeSupersedeInRequest =
    !isAgentQueueCancel && supersedeActivities && hasSupersedeDateRange;

  const loadPreview = async () => {
    setIsLoadingPreview(true);
    setError(null);
    try {
      const res: any = await tasksAPI.previewBulkCancel({
        agentId,
        taskIds,
        supersedeActivities: includeSupersedeInRequest,
        activityDateFrom: includeSupersedeInRequest ? activityDateFrom : undefined,
        activityDateTo: includeSupersedeInRequest ? activityDateTo : undefined,
      });
      setPreview(res?.data || null);
    } catch (e: any) {
      setError(mapBulkCancelError(e?.message || 'Failed to load preview'));
      setPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setSupersedeActivities(false);
    setActivityDateFrom('');
    setActivityDateTo('');
    setPreview(null);
    setError(null);
  }, [isOpen, agentId, taskIds?.join(',')]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      loadPreview();
    }, supersedeActivities ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agentId, taskIds?.join(','), supersedeActivities, activityDateFrom, activityDateTo]);

  const handleConfirm = async () => {
    if (supersedeActivities && (!activityDateFrom || !activityDateTo)) {
      setError('Please select both start and end dates for activity supersede.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res: any = await tasksAPI.bulkCancel({
        agentId,
        taskIds,
        supersedeActivities: includeSupersedeInRequest,
        activityDateFrom: includeSupersedeInRequest ? activityDateFrom : undefined,
        activityDateTo: includeSupersedeInRequest ? activityDateTo : undefined,
      });
      onCancelled({
        cancelled: res?.data?.cancelled || 0,
        supersededActivities: res?.data?.supersededActivities || 0,
      });
      onClose();
    } catch (e: any) {
      setError(mapBulkCancelError(e?.message || 'Failed to cancel tasks'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = agentId
    ? `Cancel Queue${agentName ? ` — ${agentName}` : ''}`
    : `Cancel Selected Tasks`;

  const scopeLabel = agentId
    ? `All sampled-in-queue tasks for this agent`
    : `${taskIds?.length || 0} selected task(s)`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="text-red-600" size={20} />
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm text-slate-700">
              {scopeLabel} will be moved to <span className="font-black">Cancelled</span>.
              Tasks currently <span className="font-black">In Progress</span> will be skipped.
            </p>
            {isLoadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading preview…
              </div>
            ) : preview ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm space-y-1">
                <p><span className="font-black text-red-700">{preview.tasksToCancel}</span> task(s) to cancel</p>
                <p><span className="font-black text-blue-700">{preview.tasksSkippedInProgress}</span> in-progress task(s) will be skipped</p>
                {preview.tasksSkippedOther > 0 && (
                  <p><span className="font-black text-slate-600">{preview.tasksSkippedOther}</span> other task(s) in scope will not change</p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {!isAgentQueueCancel && (
          <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={supersedeActivities}
                onChange={(e) => setSupersedeActivities(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-400"
              />
              <span className="text-sm text-slate-700">
                Also supersede unsampled (<span className="font-bold">active</span>) activities in a date range so they are excluded from future sampling.
              </span>
            </label>

            {supersedeActivities && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-7">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">From</label>
                  <input
                    type="date"
                    value={activityDateFrom}
                    onChange={(e) => setActivityDateFrom(e.target.value)}
                    className="w-full min-h-10 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">To</label>
                  <input
                    type="date"
                    value={activityDateTo}
                    onChange={(e) => setActivityDateTo(e.target.value)}
                    className="w-full min-h-10 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                {preview && hasSupersedeDateRange && (
                  <p className="md:col-span-2 text-xs font-bold text-slate-600 pl-0">
                    {preview.activitiesToSupersede} active activit{preview.activitiesToSupersede === 1 ? 'y' : 'ies'} will be superseded in this range.
                  </p>
                )}
                {!hasSupersedeDateRange && (
                  <p className="md:col-span-2 text-xs text-slate-500 pl-0">
                    Select a date range to preview how many activities will be superseded.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 font-medium">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={isSubmitting || isLoadingPreview || !preview || preview.tasksToCancel === 0}
            loading={isSubmitting}
          >
            Confirm Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default BulkCancelModal;
