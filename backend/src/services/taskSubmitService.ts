import { CallTask, ICallLog, ICallTask, TaskStatus } from '../models/CallTask.js';
import { getOutcomeFromStatus } from '../utils/outcomeHelper.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';

export interface SubmitCallInteractionInput {
  callStatus: ICallLog['callStatus'];
  callDurationSeconds?: number;
  didAttend?: ICallLog['didAttend'];
  didRecall?: boolean | null;
  cropsDiscussed?: string[];
  productsDiscussed?: string[];
  hasPurchased?: boolean | null;
  willingToPurchase?: boolean | null;
  likelyPurchaseDate?: string;
  nonPurchaseReason?: string;
  purchasedProducts?: ICallLog['purchasedProducts'];
  farmerComments?: string;
  sentiment?: ICallLog['sentiment'];
  activityQuality?: number | null;
  recordingUrl?: string;
  transcriptUrl?: string;
}

export interface SubmitCallInteractionOptions {
  /** Skip assigned-agent check (voice webhook after orchestrator assignment). */
  skipAgentCheck?: boolean;
  historyNotes?: string;
}

/**
 * Persist call interaction on a task (shared by human submit API and voice webhook).
 */
export async function submitCallInteractionForTask(
  taskId: string,
  agentId: string,
  input: SubmitCallInteractionInput,
  options: SubmitCallInteractionOptions = {}
): Promise<ICallTask> {
  const task = await CallTask.findById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (!options.skipAgentCheck) {
    if (!task.assignedAgentId || task.assignedAgentId.toString() !== agentId) {
      const err = new Error('Task not assigned to you');
      (err as any).statusCode = 403;
      throw err;
    }
  } else if (task.assignedAgentId && task.assignedAgentId.toString() !== agentId) {
    const err = new Error('Task not assigned to this agent');
    (err as any).statusCode = 403;
    throw err;
  }

  const callLog: ICallLog = {
    timestamp: new Date(),
    callStatus: input.callStatus,
    callDurationSeconds: Number(input.callDurationSeconds || 0),
    didAttend: input.didAttend ?? null,
    didRecall: input.didRecall ?? null,
    cropsDiscussed: input.cropsDiscussed || [],
    productsDiscussed: input.productsDiscussed || [],
    hasPurchased: input.hasPurchased ?? null,
    willingToPurchase: input.willingToPurchase ?? null,
    likelyPurchaseDate: input.likelyPurchaseDate || '',
    nonPurchaseReason: input.nonPurchaseReason || '',
    purchasedProducts: input.purchasedProducts || [],
    farmerComments: input.farmerComments || '',
    sentiment: input.sentiment || 'N/A',
    ...(input.activityQuality != null && { activityQuality: Number(input.activityQuality) }),
    ...(input.recordingUrl && { recordingUrl: input.recordingUrl }),
    ...(input.transcriptUrl && { transcriptUrl: input.transcriptUrl }),
  };

  task.callLog = callLog;

  let finalStatus: TaskStatus = 'completed';
  if (['Incoming N/A', 'No Answer', 'Disconnected', 'Not Reachable'].includes(input.callStatus)) {
    finalStatus = 'not_reachable';
  } else if (['Invalid', 'Invalid Number'].includes(input.callStatus)) {
    finalStatus = 'invalid_number';
  }

  const previousStatus = task.status;
  task.interactionHistory.push({
    timestamp: new Date(),
    status: previousStatus,
    notes: options.historyNotes || 'Call interaction submitted',
  });

  task.status = finalStatus;
  task.outcome = getOutcomeFromStatus(finalStatus);
  await task.save();

  logger.info(`Task ${taskId} call interaction saved (status=${finalStatus})`);
  return task;
}

export async function markTaskInProgressForAgent(
  taskId: string,
  agentId: string,
  notes: string
): Promise<ICallTask> {
  const task = await CallTask.findById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (!task.assignedAgentId || task.assignedAgentId.toString() !== agentId) {
    const err = new Error('Task not assigned to agent');
    (err as any).statusCode = 403;
    throw err;
  }

  if (task.status === 'sampled_in_queue') {
    if (!task.callStartedAt) {
      task.callStartedAt = new Date();
    }
    task.status = 'in_progress';
    task.outcome = getOutcomeFromStatus('in_progress');
    task.interactionHistory.push({
      timestamp: new Date(),
      status: 'in_progress',
      notes,
    });
    await task.save();
  } else if (['not_reachable', 'invalid_number', 'completed'].includes(task.status)) {
    task.status = 'in_progress';
    task.outcome = getOutcomeFromStatus('in_progress');
    task.interactionHistory.push({
      timestamp: new Date(),
      status: 'in_progress',
      notes,
    });
    await task.save();
  }

  return task;
}

export async function agentHasActiveVoiceCall(agentId: string): Promise<boolean> {
  const active = await CallTask.findOne({
    assignedAgentId: new mongoose.Types.ObjectId(agentId),
    status: 'in_progress',
    $or: [{ callLog: { $exists: false } }, { callLog: null }],
  }).select('_id');
  return !!active;
}
