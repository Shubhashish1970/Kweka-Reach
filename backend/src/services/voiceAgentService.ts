import crypto from 'crypto';
import mongoose from 'mongoose';
import { CallTask, ICallLog, ICallTask } from '../models/CallTask.js';
import { Farmer } from '../models/Farmer.js';
import { Activity } from '../models/Activity.js';
import { User, IUser } from '../models/User.js';
import { VoiceWebhookReceipt } from '../models/VoiceWebhookReceipt.js';
import logger from '../config/logger.js';
import { getNextVoiceTaskForAgent } from './taskService.js';
import {
  markTaskInProgressForAgent,
  submitCallInteractionForTask,
  getActiveVoiceCall,
} from './taskSubmitService.js';
import { ingestVoiceWebhookCallResult, loadVoiceCallContext, mapVoiceWebhookToSubmitInput } from './voiceWebhookIngestion.js';
import { triggerVoiceOutboundCall, fetchVoiceWorkflowRun, isVoiceWorkflowRunCompleted, resolveVoiceWorkflowId, type VoiceWorkflowRun } from './voiceApiClient.js';
import { getOutcomeFromStatus } from '../utils/outcomeHelper.js';
import { resolveVoiceDialNumber } from '../utils/voiceDialNumber.js';
import { explainRuntimeBlock, formatVoiceDebugLine, voiceDebugInfo } from '../utils/voiceDebugCodes.js';
import { VoicePipelineTracer, advancePipelineOnWebhook } from './voicePipelineService.js';
import { VoiceCallPipeline } from '../models/VoiceCallPipeline.js';
import {
  getOrCreateVoicePlatformSettings,
  resolveAgentVoiceTriggerUuid,
  resolveEffectiveLimits,
  deriveAgentRuntimeState,
  recordAgentTriggerResult,
  recordAgentWebhook,
  resolveVoiceTriggerOptions,
  isVirtualAgentLive,
} from './voiceAgentAdminService.js';

async function getStuckCallTimeoutMs(): Promise<number> {
  const platform = await getOrCreateVoicePlatformSettings();
  const minutes = platform.stuckCallTimeoutMinutes || 1;
  return Math.max(1, minutes) * 60 * 1000;
}

const VOICE_MAX_TRIES = 2;
const MAX_BLANK_MOBILE_SKIPS_PER_TICK = 20;
/** Safety cap if Dograh never reports the run completed (API down). */
export const LIVE_CALL_HOLD_MINUTES = 10;

export type VoiceRunLookup = (
  workflowId: string | number,
  runId: string | number
) => Promise<VoiceWorkflowRun | null>;

function isSyntheticTimeoutResult(task: ICallTask): boolean {
  if (task.voiceResultSource === 'timeout') return true;
  const reason = task.callLog?.nonPurchaseReason || '';
  return /no webhook|timed out/i.test(reason);
}

async function observeDograhCallEnded(
  task: ICallTask,
  fetchRun: VoiceRunLookup
): Promise<Date | null> {
  if (task.voiceDograhEndedAt) return task.voiceDograhEndedAt;
  if (task.voiceWorkflowRunId == null) return null;
  const workflowId = resolveVoiceWorkflowId(task.voiceWorkflowId);
  if (workflowId == null) return null;
  try {
    const run = await fetchRun(workflowId, task.voiceWorkflowRunId);
    if (!isVoiceWorkflowRunCompleted(run)) return null;
    task.voiceDograhEndedAt = new Date();
    await task.save();
    return task.voiceDograhEndedAt;
  } catch (error) {
    logger.warn('Voice run completion lookup skipped', {
      taskId: String(task._id),
      runId: task.voiceWorkflowRunId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function shouldReleaseVoiceTask(
  task: ICallTask,
  baseTimeoutMs: number,
  fetchRun: VoiceRunLookup
): Promise<boolean> {
  const startedAt = task.callStartedAt || task.updatedAt;
  if (!startedAt) return false;
  const ageMs = Date.now() - new Date(startedAt).getTime();

  if (task.voiceWorkflowRunId == null) {
    return ageMs >= baseTimeoutMs;
  }

  const endedAt = await observeDograhCallEnded(task, fetchRun);
  if (endedAt) {
    return Date.now() - new Date(endedAt).getTime() >= baseTimeoutMs;
  }

  return ageMs >= LIVE_CALL_HOLD_MINUTES * 60_000;
}

function blankCallLog(callStatus: ICallLog['callStatus'], nonPurchaseReason: string): ICallLog {
  return {
    timestamp: new Date(),
    callStatus,
    didAttend: null,
    didRecall: false,
    cropsDiscussed: [],
    productsDiscussed: [],
    hasPurchased: null,
    willingToPurchase: null,
    likelyPurchaseDate: '',
    nonPurchaseReason,
    purchasedProducts: [],
    farmerComments: '',
    sentiment: 'N/A',
  };
}

export function isFarmerMobileBlank(farmer: { mobileNumber?: string | null } | null | undefined): boolean {
  if (!farmer) return true;
  return !String(farmer.mobileNumber || '').trim();
}

export async function skipVoiceTaskMissingMobile(
  taskId: string,
  farmerName?: string
): Promise<void> {
  const task = await CallTask.findById(taskId);
  if (!task) return;
  if (['invalid_number', 'completed', 'cancelled'].includes(task.status)) return;

  const name = farmerName?.trim() || 'farmer';
  task.status = 'invalid_number';
  task.outcome = getOutcomeFromStatus('invalid_number');
  task.voiceWorkflowRunId = null;
  task.voiceAttemptId = null;
  task.callStartedAt = null;
  task.callLog = blankCallLog(
    'Invalid',
    'Skipped by voice orchestrator — farmer mobile number is blank'
  );
  task.interactionHistory.push({
    timestamp: new Date(),
    status: 'invalid_number',
    notes: `Skipped ${name} — blank mobile; moved to next queue item`,
  });
  await task.save();
  logger.warn(`Skipped voice task ${task._id} — blank farmer mobile`);
}

export async function deferOrFinalizeVoiceNoResponse(
  task: ICallTask,
  reason: string
): Promise<'deferred' | 'finalized'> {
  const used = Math.min(VOICE_MAX_TRIES, (task.voiceHangRetryCount || 0) + 1);
  task.voiceHangRetryCount = used;
  task.callStartedAt = null;
  task.voiceDograhEndedAt = null;
  task.voiceResultSource = 'timeout';

  if (used >= VOICE_MAX_TRIES) {
    task.status = 'not_reachable';
    task.outcome = getOutcomeFromStatus('not_reachable');
    task.voiceWorkflowRunId = null;
    task.voiceAttemptId = null;
    task.callLog = blankCallLog('No Answer', reason);
    task.interactionHistory.push({
      timestamp: new Date(),
      status: 'not_reachable',
      notes: `${reason} — max ${VOICE_MAX_TRIES} tries reached; marking not reachable`,
    });
    await task.save();
    return 'finalized';
  }

  task.status = 'sampled_in_queue';
  task.outcome = getOutcomeFromStatus('sampled_in_queue');
  task.interactionHistory.push({
    timestamp: new Date(),
    status: 'sampled_in_queue',
    notes: `${reason} — disconnected; will retry once after remaining queue items (try ${used}/${VOICE_MAX_TRIES})`,
  });
  await task.save();
  return 'deferred';
}

async function finalizeExhaustedVoiceTries(agentId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(agentId)) return;
  const exhausted = await CallTask.find({
    assignedAgentId: new mongoose.Types.ObjectId(agentId),
    status: 'sampled_in_queue',
    voiceHangRetryCount: { $gte: VOICE_MAX_TRIES },
  });
  for (const task of exhausted) {
    await deferOrFinalizeVoiceNoResponse(task, `Voice max ${VOICE_MAX_TRIES} tries already used`);
  }
}

/** Peek next queued farmer for pipeline debug (does not claim the task). */
async function peekNextQueuedFarmer(agentId: string): Promise<{ taskId: string; farmerName: string } | null> {
  const task = await getNextVoiceTaskForAgent(agentId);
  if (!task) return null;
  const farmer = task.farmerId as { name?: string } | null;
  const farmerName = farmer?.name?.trim() || 'Unknown farmer';
  return { taskId: String(task._id), farmerName };
}

function maskDialForTrace(dialNumber: string): string {
  const digits = dialNumber.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `***${digits.slice(-4)}`;
}

export interface VoiceInitialContext {
  task_id: string;
  attempt_id: string;
  farmer_name: string;
  agent_name: string;
  village_name: string;
  mdo_name: string;
  event_date: string;
  product_name: string;
  product_names: string;
  crop_names: string;
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

export {
  mapVoiceWebhookToSubmitInput,
  ingestVoiceWebhookCallResult,
  hasStructuredCallResult,
} from './voiceWebhookIngestion.js';

export async function resolveVoiceTriggerUuid(_preferredLanguage: string, agent?: IUser): Promise<string | null> {
  if (agent) {
    return resolveAgentVoiceTriggerUuid(agent);
  }
  const envFallback = process.env.VOICE_TRIGGER_UUID?.trim();
  return envFallback || null;
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
  const products = Array.isArray(activity?.products)
    ? activity.products.map((value: unknown) => String(value).trim()).filter(Boolean)
    : [];
  const crops = Array.isArray(activity?.crops)
    ? activity.crops.map((value: unknown) => String(value).trim()).filter(Boolean)
    : [];
  const productName = products[0] || '';

  return {
    task_id: task._id.toString(),
    attempt_id: attemptId,
    farmer_name: farmerName,
    agent_name: agent.name,
    village_name: villageName,
    mdo_name: mdoName,
    event_date: formatActivityEventDate(activity?.date),
    product_name: productName,
    product_names: products.join(', '),
    crop_names: crops.join(', '),
    preferred_language: farmer?.preferredLanguage || '',
  };
}

export async function releaseStuckVoiceTasks(
  agentId?: string,
  fetchRun: VoiceRunLookup = fetchVoiceWorkflowRun
): Promise<number> {
  const baseTimeoutMs = await getStuckCallTimeoutMs();

  const query: Record<string, unknown> = {
    status: 'in_progress',
    $or: [{ callLog: { $exists: false } }, { callLog: null }],
    $and: [
      {
        $or: [
          { voiceWorkflowRunId: { $ne: null } },
          { voiceAttemptId: { $nin: [null, ''] } },
        ],
      },
    ],
  };

  if (agentId && mongoose.Types.ObjectId.isValid(agentId)) {
    query.assignedAgentId = new mongoose.Types.ObjectId(agentId);
  }

  const stuck = await CallTask.find(query);

  let count = 0;
  for (const task of stuck) {
    if (!(await shouldReleaseVoiceTask(task, baseTimeoutMs, fetchRun))) continue;

    const endedAt = task.voiceDograhEndedAt;
    const holdLabel = endedAt
      ? `${Math.round(baseTimeoutMs / 60_000)} min after Dograh closed the call`
      : task.voiceWorkflowRunId != null
        ? `${LIVE_CALL_HOLD_MINUTES} min safety hold`
        : `${Math.round(baseTimeoutMs / 60_000)} min`;
    const result = await deferOrFinalizeVoiceNoResponse(
      task,
      `Voice call timed out after ${holdLabel} — no webhook received`
    );
    count += 1;
    logger.warn(
      `Released stuck voice task ${task._id} for agent ${task.assignedAgentId} after ${holdLabel} (${result})`
    );
  }

  if (count > 0) {
    logger.warn(`Released ${count} stuck voice task(s) — deferred or finalized`);
  }
  return count;
}

export async function processVirtualAgentQueueOnce(): Promise<void> {
  const platform = await getOrCreateVoicePlatformSettings();
  const envEnabled = process.env.VOICE_ORCHESTRATOR_ENABLED === 'true';
  if (!platform.orchestratorEnabled && !envEnabled) {
    return;
  }

  await releaseStuckVoiceTasks();

  const virtualAgents = await User.find({
    role: 'cc_agent',
    agentKind: 'virtual',
    isActive: true,
  }).select('_id name isActive languageCapabilities voiceAgentConfig');

  for (const agent of virtualAgents) {
    if (!isVirtualAgentLive(agent)) continue;
    const agentId = agent._id.toString();
    let tracer: VoicePipelineTracer | null = null;

    try {
      await releaseStuckVoiceTasks(agentId);
      await finalizeExhaustedVoiceTries(agentId);

      const activeCall = await getActiveVoiceCall(agentId);
      if (activeCall) {
        logger.debug(
          `Voice orchestrator: ${agent.name} waiting on ${activeCall.farmerName} (run ${activeCall.workflowRunId ?? 'n/a'}) — skip tick`
        );
        continue;
      }

      const limits = resolveEffectiveLimits(agent, platform);
      const nextDialAt = agent.voiceAgentConfig?.voiceNextDialAt
        ? new Date(agent.voiceAgentConfig.voiceNextDialAt)
        : limits.minGapBetweenCallsSec > 0 && agent.voiceAgentConfig?.lastTriggerAt
          ? new Date(
              new Date(agent.voiceAgentConfig.lastTriggerAt).getTime() +
                limits.minGapBetweenCallsSec * 1000
            )
          : null;
      if (nextDialAt && nextDialAt.getTime() > Date.now()) {
        logger.debug(
          `Voice orchestrator: ${agent.name} cooling down until ${nextDialAt.toISOString()} — skip tick`
        );
        continue;
      }

      const tracerStarted = await VoicePipelineTracer.start(agentId, 'orchestrator_tick');
      tracer = tracerStarted;
      await tracer.pass('orchestrator_enabled', 'Platform orchestrator is on');

      const nextQueued = await peekNextQueuedFarmer(agentId);
      if (nextQueued) {
        await tracer.setFarmerName(nextQueued.farmerName);
        await tracer.setTaskId(nextQueued.taskId);
        await tracer.setOutboundPayload({
          sent: false,
          reason: 'Peek only — not posted until a queue call starts',
          initial_context: { task_id: nextQueued.taskId },
        });
        await tracer.pass(
          'queue_peek',
          `${nextQueued.farmerName} (task_id ${nextQueued.taskId})`
        );
      } else {
        await tracer.pass('queue_peek', 'Queue is empty — no farmer to dial');
      }

      const runtimeState = await deriveAgentRuntimeState(agent, platform);

      if (runtimeState !== 'idle') {
        if (runtimeState === 'not_configured') {
          logger.warn(`Voice agent ${agent.name} not configured (missing trigger UUID)`);
        } else {
          logger.debug(`Voice orchestrator: agent ${agent.name} skipped (state=${runtimeState})`);
        }
        const debug = explainRuntimeBlock(agent, runtimeState);
        await tracer.block('agent_runtime', formatVoiceDebugLine(debug), debug.code);
        continue;
      }
      await tracer.pass('agent_runtime', 'Agent is ready');
      await tracer.pass('min_gap', 'Gap satisfied');

      let dialedThisTick = false;
      for (let skip = 0; skip < MAX_BLANK_MOBILE_SKIPS_PER_TICK && !dialedThisTick; skip++) {
        const task = await getNextVoiceTaskForAgent(agentId);
        if (!task) {
          const queued = await CallTask.countDocuments({
            assignedAgentId: agent._id,
            status: 'sampled_in_queue',
          });
          const debug =
            queued > 0
              ? voiceDebugInfo('VA-009', `${queued} task(s) queued but none dequeued`)
              : voiceDebugInfo('VA-009');
          if (queued > 0) {
            logger.debug(`Voice orchestrator: agent ${agent.name} has ${queued} queued task(s) but none available to dequeue`);
          }
          await tracer.block('queue_pickup', formatVoiceDebugLine(debug), debug.code);
          break;
        }

        const farmer = task.farmerId as any;
        const farmerName = farmer?.name?.trim() || 'Unknown farmer';
        await VoiceCallPipeline.findByIdAndUpdate(tracer.id, {
          traceKind: 'queue_call',
          taskId: task._id,
          farmerName,
        });
        await tracer.pass('queue_pickup', `Picked ${farmerName} (task ${String(task._id).slice(-6)})`);

        const triggerUuid = resolveAgentVoiceTriggerUuid(agent);
        if (!triggerUuid) {
          logger.warn(`No voice trigger UUID for agent ${agent.name}`);
          const debug = voiceDebugInfo('VA-004');
          await tracer.fail('trigger_uuid', formatVoiceDebugLine(debug), debug.code);
          break;
        }
        await tracer.pass('trigger_uuid', triggerUuid.slice(0, 8) + '…');

        if (isFarmerMobileBlank(farmer)) {
          logger.warn(`Task ${task._id} missing farmer mobile number`);
          const debug = voiceDebugInfo('VA-010', farmerName);
          await skipVoiceTaskMissingMobile(task._id.toString(), farmerName);
          await tracer.pass('farmer_mobile', formatVoiceDebugLine(debug));
          continue;
        }
        await tracer.pass('farmer_mobile', `${farmerName} mobile present`);

        if ((task.voiceHangRetryCount || 0) >= VOICE_MAX_TRIES) {
          const doc = await CallTask.findById(task._id);
          if (doc) {
            await deferOrFinalizeVoiceNoResponse(
              doc,
              `Voice max ${VOICE_MAX_TRIES} tries already used`
            );
          }
          continue;
        }

        await markTaskInProgressForAgent(task._id.toString(), agentId, 'Voice orchestrator started call');
        await tracer.pass('mark_in_progress', `${farmerName} → in progress`);

        const initialContext = await buildVoiceInitialContext(task, agent);
        await VoiceCallPipeline.findByIdAndUpdate(tracer.id, { attemptId: initialContext.attempt_id });

        const { dialNumber, overridden } = resolveVoiceDialNumber(farmer.mobileNumber, {
          taskId: task._id.toString(),
          source: 'orchestrator',
          agentDialOverride: agent.voiceAgentConfig,
        });
        await tracer.setDialNumber(dialNumber);
        await tracer.pass(
          'safe_dial',
          overridden
            ? `Calling ${farmerName} via safe dial override`
            : `Dialing ${farmerName}`
        );

        const triggerOptions = resolveVoiceTriggerOptions(agent, platform);
        const triggerPayload = {
          phone_number: dialNumber,
          initial_context: { ...initialContext },
          telephony_configuration_id: agent.voiceAgentConfig?.telephonyConfigurationId ?? null,
        };
        await tracer.setOutboundPayload({
          sent: true,
          phone_number: maskDialForTrace(dialNumber),
          initial_context: { ...initialContext },
          telephony_configuration_id: triggerPayload.telephony_configuration_id,
        });

        try {
          const result = await triggerVoiceOutboundCall(
            triggerUuid,
            triggerPayload,
            triggerOptions
          );

          await CallTask.findByIdAndUpdate(task._id, {
            voiceWorkflowRunId: result.workflow_run_id,
            ...(result.workflow_id != null ? { voiceWorkflowId: result.workflow_id } : {}),
            voiceAttemptId: initialContext.attempt_id,
            voiceDograhEndedAt: null,
            voiceResultSource: null,
          });

          await tracer.setWorkflowRunId(result.workflow_run_id);
          await tracer.pass('dograh_api', `Workflow run ${result.workflow_run_id} for ${farmerName}`);
          await tracer.running('awaiting_webhook', `Waiting for Dograh webhook (${farmerName})`);

          await recordAgentTriggerResult(agentId, true);

          logger.info(
            `Voice call initiated: task=${task._id} farmer=${farmerName} run=${result.workflow_run_id} agent=${agent.name}` +
              (overridden ? ` (dial override → ${dialNumber})` : '')
          );
          dialedThisTick = true;
        } catch (callError) {
          const msg = callError instanceof Error ? callError.message : 'Trigger failed';
          logger.error(`Voice trigger failed for task ${task._id}:`, callError);
          const debug = voiceDebugInfo('VA-011', `${farmerName}: ${msg}`);
          await tracer.fail('dograh_api', formatVoiceDebugLine(debug), debug.code);
          await recordAgentTriggerResult(agentId, false, msg);
          await CallTask.findByIdAndUpdate(task._id, {
            status: 'sampled_in_queue',
            voiceWorkflowRunId: null,
            voiceAttemptId: null,
            callStartedAt: null,
          });
          break;
        }
      }
    } catch (agentError) {
      const msg = agentError instanceof Error ? agentError.message : 'Orchestrator error';
      logger.error(`Voice orchestrator error for agent ${agent._id}:`, agentError);
      if (tracer) {
        await tracer.fail('agent_runtime', msg);
      }
    }
  }
}

export async function getVoiceTaskContext(taskId: string): Promise<VoiceInitialContext | null> {
  if (!mongoose.Types.ObjectId.isValid(taskId)) return null;
  const task = await CallTask.findById(taskId)
    .populate('farmerId')
    .populate('activityId')
    .lean();
  if (!task?.assignedAgentId) return null;

  const agent = await User.findById(task.assignedAgentId).lean();
  if (!agent || agent.agentKind !== 'virtual') return null;

  return buildVoiceInitialContext(task, agent as unknown as IUser);
}

export async function handleVoiceWebhook(body: Record<string, unknown>): Promise<{
  duplicate: boolean;
  taskId: string;
  staleAttempt?: boolean;
  deferredRetry?: boolean;
}> {
  const taskId = String(body.task_id || body.taskId || '').trim();
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    const err = new Error('Invalid or missing task_id');
    (err as any).statusCode = 400;
    throw err;
  }

  const workflowRunIdRaw = body.workflow_run_id ?? body.workflowRunId;
  const workflowRunId =
    workflowRunIdRaw != null && workflowRunIdRaw !== '' ? Number(workflowRunIdRaw) : null;

  const incomingAttemptId = String(body.attempt_id || body.attemptId || '').trim();

  if (workflowRunId != null && !Number.isNaN(workflowRunId)) {
    const existing = await VoiceWebhookReceipt.findOne({ workflowRunId }).lean();
    if (existing) {
      return { duplicate: true, taskId };
    }
  }

  if (incomingAttemptId) {
    const attemptReceipt = await VoiceWebhookReceipt.findOne({
      taskId: new mongoose.Types.ObjectId(taskId),
      attemptId: incomingAttemptId,
    }).lean();
    if (attemptReceipt) {
      return { duplicate: true, taskId };
    }
  }

  const task = await CallTask.findById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const effectiveRunId =
    workflowRunId != null && !Number.isNaN(workflowRunId)
      ? workflowRunId
      : task.voiceWorkflowRunId ?? null;

  if (
    incomingAttemptId &&
    task.voiceAttemptId &&
    incomingAttemptId !== task.voiceAttemptId
  ) {
    logger.warn(
      `Ignoring stale voice webhook attempt_id for task ${taskId}: expected ${task.voiceAttemptId}, got ${incomingAttemptId}`
    );
    return { duplicate: true, taskId, staleAttempt: true };
  }

  const timeoutPlaceholder = isSyntheticTimeoutResult(task);

  if (task.callLog && !timeoutPlaceholder) {
    if (effectiveRunId != null) {
      await VoiceWebhookReceipt.findOneAndUpdate(
        { workflowRunId: effectiveRunId },
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

  const submitInput = await ingestVoiceWebhookCallResult(body, {
    callContext: await loadVoiceCallContext(task),
  });

  if (
    !timeoutPlaceholder &&
    incomingAttemptId &&
    task.voiceAttemptId === incomingAttemptId &&
    task.status === 'sampled_in_queue' &&
    (task.voiceHangRetryCount || 0) >= 1 &&
    (task.voiceHangRetryCount || 0) < VOICE_MAX_TRIES &&
    !task.callLog &&
    submitInput.callStatus === 'No Answer'
  ) {
    return { duplicate: true, taskId, deferredRetry: true };
  }

  if (submitInput.callStatus === 'No Answer' && timeoutPlaceholder) {
    await recordAgentWebhook(agentId);
    await advancePipelineOnWebhook(
      taskId,
      String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
      effectiveRunId,
      body,
      { complete: true }
    );
    if (effectiveRunId != null) {
      await VoiceWebhookReceipt.findOneAndUpdate(
        { workflowRunId: effectiveRunId },
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

  if (submitInput.callStatus === 'No Answer') {
    const result = await deferOrFinalizeVoiceNoResponse(
      task,
      'No answer / no response from farmer'
    );
    await recordAgentWebhook(agentId);
    if (result === 'finalized') {
      await advancePipelineOnWebhook(
        taskId,
        String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
        effectiveRunId,
        body,
        { complete: true }
      );
    } else {
      await advancePipelineOnWebhook(
        taskId,
        String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
        effectiveRunId,
        body,
        { complete: false }
      );
    }
    if (effectiveRunId != null) {
      await VoiceWebhookReceipt.findOneAndUpdate(
        { workflowRunId: effectiveRunId },
        {
          taskId: task._id,
          attemptId: String(body.attempt_id || body.attemptId || ''),
          processedAt: new Date(),
        },
        { upsert: true }
      );
    }
    return { duplicate: false, taskId, deferredRetry: result === 'deferred' };
  }

  await submitCallInteractionForTask(taskId, agentId, submitInput, {
    skipAgentCheck: true,
    historyNotes: timeoutPlaceholder
      ? 'Voice webhook replaced timeout placeholder'
      : 'Voice agent webhook submitted call interaction',
  });

  await CallTask.findByIdAndUpdate(taskId, {
    $set: {
      voiceResultSource: 'webhook',
      voiceDograhEndedAt: null,
    },
  });

  await recordAgentWebhook(agentId);

  await advancePipelineOnWebhook(
    taskId,
    String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
    effectiveRunId,
    body,
    { complete: true }
  );

  if (effectiveRunId != null) {
    await VoiceWebhookReceipt.findOneAndUpdate(
      { workflowRunId: effectiveRunId },
      {
        taskId: task._id,
        attemptId: String(body.attempt_id || body.attemptId || task.voiceAttemptId || ''),
        processedAt: new Date(),
      },
      { upsert: true }
    );
  }

  return { duplicate: false, taskId };
}
