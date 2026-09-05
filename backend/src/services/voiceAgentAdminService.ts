import mongoose from 'mongoose';
import crypto from 'crypto';
import { User, IUser, IVoiceAgentConfig } from '../models/User.js';
import { VoicePlatformSettings, IVoicePlatformSettings } from '../models/VoicePlatformSettings.js';
import { VoiceConfigAuditLog } from '../models/VoiceConfigAuditLog.js';
import { VoiceWebhookReceipt } from '../models/VoiceWebhookReceipt.js';
import { CallTask } from '../models/CallTask.js';
import { isWithinCallingWindow } from '../utils/voiceCallingWindow.js';
import { agentHasActiveVoiceCall } from './taskSubmitService.js';
import { toIndianE164, triggerVoiceOutboundCall, VoiceTriggerOptions } from './voiceApiClient.js';
import { isAgentDialOverrideActive } from '../utils/voiceDialNumber.js';
import logger from '../config/logger.js';
import { VoicePipelineTracer, getRecentPipelineTraces } from './voicePipelineService.js';
import { getVoiceOrchestratorDiagnostics } from '../config/voiceOrchestrator.js';

export const DEFAULT_VOICE_AGENT_CONFIG = (): IVoiceAgentConfig => ({
  voiceTriggerUuid: null,
  triggerRouteType: 'api_trigger',
  telephonyConfigurationId: null,
  contextAgentName: null,
  voiceStatus: 'paused',
  inheritGlobalCallingWindow: true,
  inheritGlobalLimits: true,
  consecutiveApiFailures: 0,
  voiceDialOverrideEnabled: false,
  voiceDialOverrideNumber: null,
});

function seedPlatformFromEnv(): Partial<IVoicePlatformSettings> {
  return {
    orchestratorEnabled: process.env.VOICE_ORCHESTRATOR_ENABLED === 'true',
    pollIntervalSec: Math.max(15, Number(process.env.VOICE_ORCHESTRATOR_INTERVAL_SEC || 30)),
    defaultTimezone: 'Asia/Kolkata',
    defaultCallingDaysOfWeek: [1, 2, 3, 4, 5, 6],
    defaultCallingStartTime: '09:00',
    defaultCallingEndTime: '19:00',
    defaultMinGapBetweenCallsSec: 45,
    defaultMaxCallsPerDay: 50,
    defaultMaxConcurrentCalls: 1,
    stuckCallTimeoutMinutes: Math.max(1, Number(process.env.VOICE_STUCK_TASK_MINUTES || 1)),
    autoPauseAfterConsecutiveFailures: 5,
    useTestEndpoint: process.env.VOICE_USE_TEST_ENDPOINT !== 'false',
  };
}

export async function getOrCreateVoicePlatformSettings(): Promise<IVoicePlatformSettings> {
  let doc = await VoicePlatformSettings.findOne({ key: 'default' });
  if (!doc) {
    doc = await VoicePlatformSettings.create({ key: 'default', ...seedPlatformFromEnv() });
  }
  return doc;
}

export function getVoiceSecretsStatus() {
  return {
    apiBaseUrlConfigured: Boolean(process.env.VOICE_API_BASE_URL?.trim()),
    apiKeyConfigured: Boolean(process.env.VOICE_API_KEY?.trim()),
    webhookKeyConfigured: Boolean(process.env.VOICE_WEBHOOK_API_KEY?.trim()),
    envFallbackTriggerUuid: Boolean(process.env.VOICE_TRIGGER_UUID?.trim()),
    webhookUrl: process.env.REACH_PUBLIC_API_URL
      ? `${process.env.REACH_PUBLIC_API_URL.replace(/\/$/, '')}/api/voice/webhook`
      : null,
  };
}

export async function getVoicePlatformSettingsResponse() {
  const settings = await getOrCreateVoicePlatformSettings();
  return {
    settings: settings.toObject(),
    secrets: getVoiceSecretsStatus(),
  };
}

export async function updateVoicePlatformSettings(
  patch: Partial<IVoicePlatformSettings>,
  userId?: string,
  userEmail?: string
) {
  const settings = await getOrCreateVoicePlatformSettings();
  const allowed = [
    'orchestratorEnabled',
    'pollIntervalSec',
    'defaultTimezone',
    'defaultCallingDaysOfWeek',
    'defaultCallingStartTime',
    'defaultCallingEndTime',
    'defaultMinGapBetweenCallsSec',
    'defaultMaxCallsPerDay',
    'defaultMaxConcurrentCalls',
    'stuckCallTimeoutMinutes',
    'autoPauseAfterConsecutiveFailures',
    'useTestEndpoint',
  ] as const;

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      (settings as any)[key] = patch[key];
    }
  }
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    settings.updatedByUserId = new mongoose.Types.ObjectId(userId);
  }
  await settings.save();

  await VoiceConfigAuditLog.create({
    scope: 'platform',
    action: 'update_settings',
    summary: 'Updated voice platform settings',
    userId: userId && mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : undefined,
    userEmail,
  });

  try {
    const { restartVoiceOrchestrator } = await import('../config/voiceOrchestrator.js');
    await restartVoiceOrchestrator();
  } catch (error) {
    logger.warn('Voice orchestrator restart after settings update failed:', error);
  }

  return getVoicePlatformSettingsResponse();
}

export type VoiceAgentConfigSource = Pick<IUser, 'voiceAgentConfig' | 'isActive' | '_id'>;

export function resolveVoiceTriggerOptions(
  agent: VoiceAgentConfigSource,
  platform: IVoicePlatformSettings
): VoiceTriggerOptions {
  const cfg = agent.voiceAgentConfig || DEFAULT_VOICE_AGENT_CONFIG();
  return {
    triggerRouteType: cfg.triggerRouteType || 'api_trigger',
    useTestEndpoint:
      platform.useTestEndpoint !== undefined
        ? platform.useTestEndpoint
        : process.env.VOICE_USE_TEST_ENDPOINT !== 'false',
  };
}

export async function countVirtualAgentsWithDialOverride(): Promise<number> {
  return User.countDocuments({
    role: 'cc_agent',
    agentKind: 'virtual',
    isActive: true,
    'voiceAgentConfig.voiceDialOverrideEnabled': true,
    'voiceAgentConfig.voiceDialOverrideNumber': { $nin: [null, ''] },
  });
}

export async function getVoiceMetricsSummary() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [voiceTasksWithRun, webhooksToday, agentsRunning, agentsWithDialOverride, stuckInProgress] =
    await Promise.all([
      CallTask.countDocuments({ voiceWorkflowRunId: { $ne: null } }),
      VoiceConfigAuditLog.countDocuments({
        action: { $in: ['test_trigger', 'update_agent_config'] },
        createdAt: { $gte: startOfDay },
      }),
      User.countDocuments({
        role: 'cc_agent',
        agentKind: 'virtual',
        isActive: true,
        'voiceAgentConfig.voiceStatus': 'running',
      }),
      countVirtualAgentsWithDialOverride(),
      CallTask.countDocuments({
        status: 'in_progress',
        voiceWorkflowRunId: { $ne: null },
        callLog: { $exists: false },
      }),
    ]);

  const platform = await getOrCreateVoicePlatformSettings();
  const receiptsToday = await VoiceWebhookReceipt.countDocuments({
    processedAt: { $gte: startOfDay },
  });

  return {
    totalVoiceTriggeredTasks: voiceTasksWithRun,
    webhooksProcessedToday: receiptsToday,
    configChangesToday: webhooksToday,
    virtualAgentsRunning: agentsRunning,
    agentsWithDialOverride,
    stuckVoiceCallsInProgress: stuckInProgress,
    orchestratorEnabled: platform.orchestratorEnabled || process.env.VOICE_ORCHESTRATOR_ENABLED === 'true',
    generatedAt: new Date().toISOString(),
  };
}

export function resolveEffectiveCallingWindow(
  agent: VoiceAgentConfigSource,
  platform: IVoicePlatformSettings
): { timezone: string; daysOfWeek: number[]; startTime: string; endTime: string } {
  const cfg = agent.voiceAgentConfig || DEFAULT_VOICE_AGENT_CONFIG();
  if (cfg.inheritGlobalCallingWindow !== false) {
    return {
      timezone: platform.defaultTimezone,
      daysOfWeek: platform.defaultCallingDaysOfWeek,
      startTime: platform.defaultCallingStartTime,
      endTime: platform.defaultCallingEndTime,
    };
  }
  return {
    timezone: cfg.callingTimezone || platform.defaultTimezone,
    daysOfWeek: cfg.callingDaysOfWeek?.length ? cfg.callingDaysOfWeek : platform.defaultCallingDaysOfWeek,
    startTime: cfg.callingStartTime || platform.defaultCallingStartTime,
    endTime: cfg.callingEndTime || platform.defaultCallingEndTime,
  };
}

export function resolveEffectiveLimits(agent: VoiceAgentConfigSource, platform: IVoicePlatformSettings) {
  const cfg = agent.voiceAgentConfig || DEFAULT_VOICE_AGENT_CONFIG();
  if (cfg.inheritGlobalLimits !== false) {
    return {
      maxConcurrentCalls: platform.defaultMaxConcurrentCalls,
      minGapBetweenCallsSec: platform.defaultMinGapBetweenCallsSec,
      maxCallsPerDay: platform.defaultMaxCallsPerDay,
    };
  }
  return {
    maxConcurrentCalls: cfg.maxConcurrentCalls ?? platform.defaultMaxConcurrentCalls,
    minGapBetweenCallsSec: cfg.minGapBetweenCallsSec ?? platform.defaultMinGapBetweenCallsSec,
    maxCallsPerDay: cfg.maxCallsPerDay ?? platform.defaultMaxCallsPerDay,
  };
}

export async function countAgentCallsToday(agentId: string, timezone: string): Promise<number> {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayStr = fmt.format(now);
  const start = new Date(`${todayStr}T00:00:00`);
  const end = new Date(`${todayStr}T23:59:59.999`);

  return CallTask.countDocuments({
    assignedAgentId: new mongoose.Types.ObjectId(agentId),
    voiceWorkflowRunId: { $ne: null },
    updatedAt: { $gte: start, $lte: end },
  });
}

export type DerivedVoiceRuntimeState =
  | 'idle'
  | 'calling'
  | 'paused'
  | 'stopped'
  | 'outside_hours'
  | 'daily_cap_reached'
  | 'not_configured';

export async function deriveAgentRuntimeState(
  agent: VoiceAgentConfigSource,
  platform: IVoicePlatformSettings
): Promise<DerivedVoiceRuntimeState> {
  const cfg = agent.voiceAgentConfig || DEFAULT_VOICE_AGENT_CONFIG();
  const status = cfg.voiceStatus || 'paused';

  if (agent.isActive === false) return 'stopped';
  if (status === 'stopped') return 'stopped';
  if (status === 'paused') return 'paused';

  const triggerUuid = resolveAgentVoiceTriggerUuid(agent);
  if (!triggerUuid) return 'not_configured';

  const window = resolveEffectiveCallingWindow(agent, platform);
  if (!isWithinCallingWindow(new Date(), window)) return 'outside_hours';

  const limits = resolveEffectiveLimits(agent, platform);
  if (limits.maxCallsPerDay > 0) {
    const todayCount = await countAgentCallsToday(agent._id.toString(), window.timezone);
    if (todayCount >= limits.maxCallsPerDay) return 'daily_cap_reached';
  }

  if (await agentHasActiveVoiceCall(agent._id.toString())) return 'calling';

  return 'idle';
}

export function resolveAgentVoiceTriggerUuid(agent: VoiceAgentConfigSource): string | null {
  const fromAgent = agent.voiceAgentConfig?.voiceTriggerUuid?.trim();
  if (fromAgent) return fromAgent;
  const envFallback = process.env.VOICE_TRIGGER_UUID?.trim();
  return envFallback || null;
}

export async function getAgentQueueCounts(agentId: string) {
  const oid = new mongoose.Types.ObjectId(agentId);
  const now = new Date();
  const [sampled, dueNow, inProgress, completedToday] = await Promise.all([
    CallTask.countDocuments({ assignedAgentId: oid, status: 'sampled_in_queue' }),
    CallTask.countDocuments({
      assignedAgentId: oid,
      status: 'sampled_in_queue',
      scheduledDate: { $lte: now },
    }),
    CallTask.countDocuments({ assignedAgentId: oid, status: 'in_progress' }),
    CallTask.countDocuments({
      assignedAgentId: oid,
      status: 'completed',
      updatedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
  ]);
  return {
    sampled_in_queue: sampled,
    due_now: dueNow,
    in_progress: inProgress,
    completed_today: completedToday,
  };
}

export async function listVoiceAgents(options?: { teamLeadId?: string }) {
  const platform = await getOrCreateVoicePlatformSettings();
  const filter: Record<string, unknown> = { role: 'cc_agent', agentKind: 'virtual' };
  if (options?.teamLeadId && mongoose.Types.ObjectId.isValid(options.teamLeadId)) {
    filter.teamLeadId = new mongoose.Types.ObjectId(options.teamLeadId);
  }

  const agents = await User.find(filter)
    .select('name email employeeId languageCapabilities isActive teamLeadId voiceAgentConfig')
    .populate('teamLeadId', 'name email')
    .sort({ name: 1 })
    .lean();

  const result = [];
  for (const agent of agents) {
    const runtimeState = await deriveAgentRuntimeState(agent, platform);
    const queueCounts = await getAgentQueueCounts(String(agent._id));
    result.push({
      agentId: String(agent._id),
      name: agent.name,
      email: agent.email,
      employeeId: agent.employeeId,
      languageCapabilities: agent.languageCapabilities || [],
      isActive: agent.isActive,
      teamLead: agent.teamLeadId,
      voiceStatus: agent.voiceAgentConfig?.voiceStatus || 'paused',
      voiceTriggerUuid: agent.voiceAgentConfig?.voiceTriggerUuid || null,
      runtimeState,
      queueCounts,
      consecutiveApiFailures: agent.voiceAgentConfig?.consecutiveApiFailures || 0,
      lastTriggerAt: agent.voiceAgentConfig?.lastTriggerAt || null,
      lastWebhookAt: agent.voiceAgentConfig?.lastWebhookAt || null,
      voiceDialOverrideEnabled: isAgentDialOverrideActive(agent.voiceAgentConfig),
    });
  }
  return result;
}

export async function getVoiceAgentDetail(agentId: string) {
  const agent = await User.findOne({ _id: agentId, role: 'cc_agent', agentKind: 'virtual' })
    .select('name email employeeId languageCapabilities isActive teamLeadId voiceAgentConfig')
    .populate('teamLeadId', 'name email');
  if (!agent) return null;

  const platform = await getOrCreateVoicePlatformSettings();
  const runtimeState = await deriveAgentRuntimeState(agent, platform);
  const queueCounts = await getAgentQueueCounts(agentId);
  const callsToday = await countAgentCallsToday(
    agentId,
    resolveEffectiveCallingWindow(agent, platform).timezone
  );

  const auditLog = await VoiceConfigAuditLog.find({ scope: 'agent', agentId: agent._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const pipelineTraces = await getRecentPipelineTraces(agentId, 100);

  return {
    agent: agent.toObject(),
    voiceAgentConfig: agent.voiceAgentConfig || DEFAULT_VOICE_AGENT_CONFIG(),
    runtimeState,
    queueCounts,
    callsToday,
    effectiveCallingWindow: resolveEffectiveCallingWindow(agent, platform),
    effectiveLimits: resolveEffectiveLimits(agent, platform),
    auditLog,
    pipelineTraces,
    orchestratorDiagnostics: getVoiceOrchestratorDiagnostics(),
  };
}

export async function updateVoiceAgentConfig(
  agentId: string,
  patch: Partial<IVoiceAgentConfig>,
  actor: { userId?: string; userEmail?: string }
) {
  const agent = await User.findOne({ _id: agentId, role: 'cc_agent', agentKind: 'virtual' });
  if (!agent) {
    const err = new Error('Virtual agent not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (!agent.voiceAgentConfig) {
    agent.voiceAgentConfig = DEFAULT_VOICE_AGENT_CONFIG();
  }

  const cfg = agent.voiceAgentConfig!;
  const allowed: (keyof IVoiceAgentConfig)[] = [
    'voiceTriggerUuid',
    'triggerRouteType',
    'telephonyConfigurationId',
    'contextAgentName',
    'voiceStatus',
    'inheritGlobalCallingWindow',
    'callingTimezone',
    'callingDaysOfWeek',
    'callingStartTime',
    'callingEndTime',
    'inheritGlobalLimits',
    'maxConcurrentCalls',
    'minGapBetweenCallsSec',
    'maxCallsPerDay',
    'pauseReason',
    'voiceDialOverrideEnabled',
    'voiceDialOverrideNumber',
  ];

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      (cfg as any)[key] = patch[key];
    }
  }

  if (patch.voiceDialOverrideEnabled === false) {
    cfg.voiceDialOverrideNumber = null;
  }

  if (patch.voiceDialOverrideNumber !== undefined) {
    if (!patch.voiceDialOverrideNumber) {
      cfg.voiceDialOverrideNumber = null;
    } else {
      const digits = String(patch.voiceDialOverrideNumber).replace(/\D/g, '');
      if (digits.length < 10) {
        const err = new Error('Dial override number must have at least 10 digits');
        (err as any).statusCode = 400;
        throw err;
      }
      cfg.voiceDialOverrideNumber = toIndianE164(patch.voiceDialOverrideNumber);
    }
  }

  if (patch.voiceStatus === 'paused' || patch.voiceStatus === 'stopped') {
    cfg.pausedAt = new Date();
    cfg.pauseReason = patch.pauseReason || cfg.pauseReason || 'Manually paused';
    if (actor.userId && mongoose.Types.ObjectId.isValid(actor.userId)) {
      cfg.pausedByUserId = new mongoose.Types.ObjectId(actor.userId);
    }
  }

  if (patch.voiceStatus === 'running') {
    cfg.pauseReason = undefined;
    cfg.pausedAt = undefined;
    cfg.pausedByUserId = undefined;
    cfg.consecutiveApiFailures = 0;
  }

  cfg.configUpdatedAt = new Date();
  if (actor.userId && mongoose.Types.ObjectId.isValid(actor.userId)) {
    cfg.configUpdatedByUserId = new mongoose.Types.ObjectId(actor.userId);
  }

  agent.markModified('voiceAgentConfig');
  await agent.save();

  if (patch.voiceStatus === 'running') {
    try {
      const { runVoiceOrchestratorTick } = await import('../config/voiceOrchestrator.js');
      void runVoiceOrchestratorTick();
    } catch (error) {
      logger.warn('Immediate orchestrator tick after agent start failed:', error);
    }
  }

  await VoiceConfigAuditLog.create({
    scope: 'agent',
    agentId: agent._id,
    action: 'update_agent_config',
    summary: `Updated voice config (status=${cfg.voiceStatus})`,
    userId: actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? new mongoose.Types.ObjectId(actor.userId) : undefined,
    userEmail: actor.userEmail,
  });

  return getVoiceAgentDetail(agentId);
}

export async function recordAgentTriggerResult(
  agentId: string,
  success: boolean,
  errorMessage?: string
) {
  const agent = await User.findById(agentId);
  if (!agent?.voiceAgentConfig) return;

  const cfg = agent.voiceAgentConfig;
  cfg.lastTriggerAt = new Date();
  if (success) {
    cfg.lastSuccessfulTriggerAt = new Date();
    cfg.lastTriggerError = null;
    cfg.consecutiveApiFailures = 0;
  } else {
    cfg.lastTriggerError = errorMessage || 'Trigger failed';
    cfg.consecutiveApiFailures = (cfg.consecutiveApiFailures || 0) + 1;
    const platform = await getOrCreateVoicePlatformSettings();
    if (cfg.consecutiveApiFailures >= platform.autoPauseAfterConsecutiveFailures) {
      cfg.voiceStatus = 'paused';
      cfg.pauseReason = `Auto-paused after ${cfg.consecutiveApiFailures} consecutive API failures`;
      cfg.pausedAt = new Date();
      logger.warn(`Voice agent ${agent.name} auto-paused after API failures`);
    }
  }
  agent.markModified('voiceAgentConfig');
  await agent.save();
}

export async function recordAgentWebhook(agentId: string) {
  await User.findByIdAndUpdate(agentId, {
    $set: { 'voiceAgentConfig.lastWebhookAt': new Date() },
  });
}

export async function getVirtualAgentForTeamLead(agentId: string, teamLeadId: string) {
  if (!mongoose.Types.ObjectId.isValid(agentId) || !mongoose.Types.ObjectId.isValid(teamLeadId)) {
    return null;
  }
  return User.findOne({
    _id: agentId,
    role: 'cc_agent',
    agentKind: 'virtual',
    teamLeadId: new mongoose.Types.ObjectId(teamLeadId),
  });
}

export async function updateVoiceAgentStatusForTeamLead(
  agentId: string,
  teamLeadId: string,
  patch: Pick<IVoiceAgentConfig, 'voiceStatus' | 'pauseReason'>,
  actor: { userId?: string; userEmail?: string }
) {
  const agent = await getVirtualAgentForTeamLead(agentId, teamLeadId);
  if (!agent) {
    const err = new Error('Virtual agent not found for this team lead');
    (err as any).statusCode = 404;
    throw err;
  }
  return updateVoiceAgentConfig(agentId, patch, actor);
}

export async function testVoiceAgentTrigger(
  agentId: string,
  phoneNumber: string,
  actor?: { userId?: string; userEmail?: string }
) {
  const agent = await User.findOne({ _id: agentId, role: 'cc_agent', agentKind: 'virtual' });
  if (!agent) {
    const err = new Error('Virtual agent not found');
    (err as any).statusCode = 404;
    throw err;
  }

  const triggerUuid = resolveAgentVoiceTriggerUuid(agent);
  if (!triggerUuid) {
    const err = new Error('Agent has no API Trigger UUID configured');
    (err as any).statusCode = 400;
    throw err;
  }

  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length < 10) {
    const err = new Error('Valid phone number is required (at least 10 digits)');
    (err as any).statusCode = 400;
    throw err;
  }

  const attemptId = crypto.randomUUID();
  const platform = await getOrCreateVoicePlatformSettings();
  const triggerOptions = resolveVoiceTriggerOptions(agent, platform);
  const dialNumber = toIndianE164(phoneNumber);

  const tracer = await VoicePipelineTracer.start(agentId, 'test_call', {
    attemptId,
    dialNumber,
    farmerName: 'Test Farmer (manual)',
  });
  await tracer.pass('orchestrator_enabled', 'Manual test trigger (bypasses queue)');
  await tracer.pass('agent_runtime', 'Test call initiated by admin');
  await tracer.pass('queue_peek', 'Not from queue — manual test dial');
  await tracer.pass('trigger_uuid', triggerUuid.slice(0, 8) + '…');
  await tracer.pass('safe_dial', `Test dial → ${dialNumber.replace(/\d(?=\d{4})/g, '*')}`);

  const initialContext = {
    task_id: 'voice-test',
    attempt_id: attemptId,
    farmer_name: 'Test Farmer',
    agent_name: agent.name,
    village_name: 'Test Village',
    mdo_name: 'Test MDO',
    event_date: new Date().toISOString(),
    product_name: 'Test Product',
    preferred_language: agent.languageCapabilities?.[0] || 'Hindi',
  };
  const triggerPayload = {
    phone_number: dialNumber,
    initial_context: initialContext,
    telephony_configuration_id: agent.voiceAgentConfig?.telephonyConfigurationId ?? null,
  };
  await tracer.setOutboundPayload({
    sent: true,
    phone_number: dialNumber.replace(/\d(?=\d{4})/g, '*'),
    initial_context: initialContext,
    telephony_configuration_id: triggerPayload.telephony_configuration_id,
  });

  try {
    const result = await triggerVoiceOutboundCall(
      triggerUuid,
      triggerPayload,
      triggerOptions
    );

    await tracer.setWorkflowRunId(result.workflow_run_id);
    await tracer.pass('dograh_api', `Workflow run ${result.workflow_run_id}`);
    await tracer.running('awaiting_webhook', 'Test call — webhook optional for manual test');

    await recordAgentTriggerResult(agentId, true);

    await VoiceConfigAuditLog.create({
      scope: 'agent',
      agentId: agent._id,
      action: 'test_trigger',
      summary: `Test trigger to ${dialNumber} (run ${result.workflow_run_id})`,
      userId:
        actor?.userId && mongoose.Types.ObjectId.isValid(actor.userId)
          ? new mongoose.Types.ObjectId(actor.userId)
          : undefined,
      userEmail: actor?.userEmail,
    });

    return {
      workflowRunId: result.workflow_run_id,
      workflowRunName: result.workflow_run_name,
      attemptId,
      phoneNumber: dialNumber,
      pipelineTraceId: tracer.id,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Test trigger failed';
    const { voiceDebugInfo, formatVoiceDebugLine } = await import('../utils/voiceDebugCodes.js');
    const debug = voiceDebugInfo('VA-011', msg);
    await tracer.fail('dograh_api', formatVoiceDebugLine(debug), debug.code);
    await recordAgentTriggerResult(agentId, false, msg);
    throw error;
  }
}

export async function ensureVirtualAgentVoiceConfig(userId: string) {
  await User.findOneAndUpdate(
    { _id: userId, agentKind: 'virtual', 'voiceAgentConfig.voiceStatus': { $exists: false } },
    { $set: { voiceAgentConfig: DEFAULT_VOICE_AGENT_CONFIG() } }
  );
  await User.findOneAndUpdate(
    { _id: userId, agentKind: 'virtual', voiceAgentConfig: null },
    { $set: { voiceAgentConfig: DEFAULT_VOICE_AGENT_CONFIG() } }
  );
}
