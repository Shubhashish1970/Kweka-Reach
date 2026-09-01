import crypto from 'crypto';
import mongoose from 'mongoose';
import { CallTask } from '../models/CallTask.js';
import { Farmer } from '../models/Farmer.js';
import { Activity } from '../models/Activity.js';
import { User, IUser } from '../models/User.js';
import { MasterLanguage } from '../models/MasterData.js';
import { VoiceWebhookReceipt } from '../models/VoiceWebhookReceipt.js';
import { ICallLog } from '../models/CallTask.js';
import logger from '../config/logger.js';
import { getNextTaskForAgent } from './taskService.js';
import {
  agentHasActiveVoiceCall,
  markTaskInProgressForAgent,
  submitCallInteractionForTask,
  SubmitCallInteractionInput,
} from './taskSubmitService.js';
import { toIndianE164, triggerVoiceOutboundCall } from './voiceApiClient.js';

const STUCK_MINUTES = Number(process.env.VOICE_STUCK_TASK_MINUTES || 15);

export interface VoiceInitialContext {
  task_id: string;
  attempt_id: string;
  farmer_name: string;
  agent_name: string;
  village_name: string;
  mdo_name: string;
  event_date: string;
  product_name: string;
  preferred_language: string;
}

function formatActivityEventDate(date: Date | string | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${year} ${pad(hours)}:${minutes} ${ampm}`;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
      } catch {
        /* fall through */
      }
    }
    return trimmed.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase().trim();
  if (['true', 'yes', '1'].includes(s)) return true;
  if (['false', 'no', '0'].includes(s)) return false;
  return null;
}

function mapVoiceCallStatus(payload: Record<string, unknown>): ICallLog['callStatus'] {
  const raw =
    payload.call_status ||
    payload.callStatus ||
    payload.telephony_status ||
    payload.end_reason ||
    '';
  const s = String(raw).toLowerCase().replace(/_/g, ' ');

  if (s.includes('invalid')) return 'Invalid';
  if (s.includes('no answer') || s === 'no-answer' || s.includes('not reachable')) return 'No Answer';
  if (s.includes('busy') || s.includes('disconnected')) return 'Disconnected';
  if (s.includes('voicemail')) return 'No Answer';
  if (s.includes('connect') || s.includes('completed') || s.includes('end call') || s.includes('bot hangup')) {
    return 'Connected';
  }
  if (s.includes('failed') || s.includes('error') || s.includes('canceled')) return 'Not Reachable';
  return 'Connected';
}

function mapDidAttend(value: unknown): ICallLog['didAttend'] {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const allowed: ICallLog['didAttend'][] = [
    'Yes, I attended',
    'No, I missed',
    "Don't recall",
    'Identity Wrong',
    'Not a Farmer',
  ];
  if (allowed.includes(s as ICallLog['didAttend'])) return s as ICallLog['didAttend'];
  const lower = s.toLowerCase();
  if (lower.includes('yes') || lower.includes('attended')) return 'Yes, I attended';
  if (lower.includes('missed') || lower.includes('no')) return 'No, I missed';
  if (lower.includes("don't") || lower.includes('recall')) return "Don't recall";
  if (lower.includes('wrong') || lower.includes('identity')) return 'Identity Wrong';
  if (lower.includes('not a farmer')) return 'Not a Farmer';
  return null;
}

function mapSentiment(value: unknown): ICallLog['sentiment'] {
  const s = String(value || 'N/A').trim();
  if (['Positive', 'Negative', 'Neutral', 'N/A'].includes(s)) return s as ICallLog['sentiment'];
  const lower = s.toLowerCase();
  if (lower.includes('pos')) return 'Positive';
  if (lower.includes('neg')) return 'Negative';
  if (lower.includes('neut')) return 'Neutral';
  return 'N/A';
}

export function mapVoiceWebhookToSubmitInput(body: Record<string, unknown>): SubmitCallInteractionInput {
  return {
    callStatus: mapVoiceCallStatus(body),
    callDurationSeconds: Number(body.call_duration_seconds ?? body.callDurationSeconds ?? 0),
    didAttend: mapDidAttend(body.did_attend ?? body.didAttend),
    didRecall: parseBoolean(body.did_recall ?? body.didRecall),
    cropsDiscussed: parseStringArray(body.crops_discussed ?? body.cropsDiscussed),
    productsDiscussed: parseStringArray(body.products_discussed ?? body.productsDiscussed),
    hasPurchased: parseBoolean(body.has_purchased ?? body.hasPurchased),
    willingToPurchase: parseBoolean(body.willing_to_purchase ?? body.willingToPurchase),
    likelyPurchaseDate: String(body.likely_purchase_date ?? body.likelyPurchaseDate ?? ''),
    nonPurchaseReason: String(body.non_purchase_reason ?? body.nonPurchaseReason ?? ''),
    farmerComments: String(body.farmer_comments ?? body.farmerComments ?? ''),
    sentiment: mapSentiment(body.sentiment),
    activityQuality:
      body.activity_quality != null && body.activity_quality !== ''
        ? Number(body.activity_quality)
        : body.activityQuality != null && body.activityQuality !== ''
          ? Number(body.activityQuality)
          : null,
  };
}

export async function resolveVoiceTriggerUuid(preferredLanguage: string): Promise<string | null> {
  const lang = await MasterLanguage.findOne({
    name: { $regex: new RegExp(`^${preferredLanguage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    isActive: true,
  })
    .select('voiceTriggerUuid')
    .lean();

  if (lang?.voiceTriggerUuid?.trim()) {
    return lang.voiceTriggerUuid.trim();
  }

  const fallback = process.env.VOICE_TRIGGER_UUID?.trim();
  return fallback || null;
}

export async function buildVoiceInitialContext(
  task: any,
  agent: IUser
): Promise<VoiceInitialContext> {
  const farmer = task.farmerId?._id ? task.farmerId : await Farmer.findById(task.farmerId).lean();
  const activity = task.activityId?._id ? task.activityId : await Activity.findById(task.activityId).lean();
  const attemptId = crypto.randomUUID();

  const farmerName = farmer?.name || '';
  const villageName = farmer?.location || activity?.location || activity?.territoryName || activity?.territory || '';
  const mdoName = activity?.officerName || '';
  const products = Array.isArray(activity?.products) ? activity.products : [];
  const productName = products.length > 0 ? String(products[0]) : '';

  return {
    task_id: task._id.toString(),
    attempt_id: attemptId,
    farmer_name: farmerName,
    agent_name: agent.name,
    village_name: villageName,
    mdo_name: mdoName,
    event_date: formatActivityEventDate(activity?.date),
    product_name: productName,
    preferred_language: farmer?.preferredLanguage || '',
  };
}

export async function releaseStuckVoiceTasks(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000);
  const stuck = await CallTask.find({
    status: 'in_progress',
    callLog: { $exists: false },
    callStartedAt: { $lt: cutoff },
    voiceWorkflowRunId: { $ne: null },
  });

  let count = 0;
  for (const task of stuck) {
    task.status = 'sampled_in_queue';
    task.voiceWorkflowRunId = null;
    task.voiceAttemptId = null;
    task.callStartedAt = null;
    task.interactionHistory.push({
      timestamp: new Date(),
      status: 'in_progress',
      notes: `Voice call timed out after ${STUCK_MINUTES} minutes — returned to queue`,
    });
    await task.save();
    count += 1;
  }
  if (count > 0) {
    logger.warn(`Released ${count} stuck voice task(s) to queue`);
  }
  return count;
}

export async function processVirtualAgentQueueOnce(): Promise<void> {
  if (process.env.VOICE_ORCHESTRATOR_ENABLED !== 'true') {
    return;
  }

  await releaseStuckVoiceTasks();

  const virtualAgents = await User.find({
    role: 'cc_agent',
    agentKind: 'virtual',
    isActive: true,
  }).select('_id name languageCapabilities');

  for (const agent of virtualAgents) {
    try {
      const agentId = agent._id.toString();

      if (await agentHasActiveVoiceCall(agentId)) {
        continue;
      }

      const task = await getNextTaskForAgent(agentId);
      if (!task) continue;

      const farmer = task.farmerId as any;
      const preferredLanguage = farmer?.preferredLanguage || '';
      const triggerUuid = await resolveVoiceTriggerUuid(preferredLanguage);
      if (!triggerUuid) {
        logger.warn(`No voice trigger UUID for language "${preferredLanguage}" (agent ${agent.name})`);
        continue;
      }

      if (!farmer?.mobileNumber) {
        logger.warn(`Task ${task._id} missing farmer mobile number`);
        continue;
      }

      await markTaskInProgressForAgent(task._id.toString(), agentId, 'Voice orchestrator started call');

      const initialContext = await buildVoiceInitialContext(task, agent);
      const phone = toIndianE164(farmer.mobileNumber);

      try {
        const result = await triggerVoiceOutboundCall(triggerUuid, {
          phone_number: phone,
          initial_context: { ...initialContext },
        });

        await CallTask.findByIdAndUpdate(task._id, {
          voiceWorkflowRunId: result.workflow_run_id,
          voiceAttemptId: initialContext.attempt_id,
        });

        logger.info(
          `Voice call initiated: task=${task._id} run=${result.workflow_run_id} agent=${agent.name}`
        );
      } catch (callError) {
        logger.error(`Voice trigger failed for task ${task._id}:`, callError);
        await CallTask.findByIdAndUpdate(task._id, {
          status: 'sampled_in_queue',
          voiceWorkflowRunId: null,
          voiceAttemptId: null,
          callStartedAt: null,
        });
      }
    } catch (agentError) {
      logger.error(`Voice orchestrator error for agent ${agent._id}:`, agentError);
    }
  }
}

export async function handleVoiceWebhook(body: Record<string, unknown>): Promise<{ duplicate: boolean; taskId: string }> {
  const taskId = String(body.task_id || body.taskId || '').trim();
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    const err = new Error('Invalid or missing task_id');
    (err as any).statusCode = 400;
    throw err;
  }

  const workflowRunIdRaw = body.workflow_run_id ?? body.workflowRunId;
  const workflowRunId =
    workflowRunIdRaw != null && workflowRunIdRaw !== '' ? Number(workflowRunIdRaw) : null;

  if (workflowRunId != null && !Number.isNaN(workflowRunId)) {
    const existing = await VoiceWebhookReceipt.findOne({ workflowRunId }).lean();
    if (existing) {
      return { duplicate: true, taskId };
    }
  }

  const task = await CallTask.findById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (task.callLog) {
    if (workflowRunId != null && !Number.isNaN(workflowRunId)) {
      await VoiceWebhookReceipt.findOneAndUpdate(
        { workflowRunId },
        {
          taskId: task._id,
          attemptId: String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
          processedAt: new Date(),
        },
        { upsert: true }
      );
    }
    return { duplicate: true, taskId };
  }

  const agentId = task.assignedAgentId?.toString();
  if (!agentId) {
    const err = new Error('Task has no assigned agent');
    (err as any).statusCode = 400;
    throw err;
  }

  const submitInput = mapVoiceWebhookToSubmitInput(body);
  await submitCallInteractionForTask(taskId, agentId, submitInput, {
    skipAgentCheck: true,
    historyNotes: 'Voice agent webhook submitted call interaction',
  });

  if (workflowRunId != null && !Number.isNaN(workflowRunId)) {
    await VoiceWebhookReceipt.create({
      workflowRunId,
      taskId: task._id,
      attemptId: String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
      processedAt: new Date(),
    });
  }

  return { duplicate: false, taskId };
}
