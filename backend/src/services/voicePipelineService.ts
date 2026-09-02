/**
 * Per-call pipeline traces for voice orchestration debugging.
 * TEMP: surfaced on Admin → Voice Agents; relocate UI + optional dedicated API later.
 */
import mongoose from 'mongoose';
import {
  VoiceCallPipeline,
  IPipelineStep,
  PipelineStepStatus,
  VoicePipelineOverallStatus,
  VoicePipelineTraceKind,
} from '../models/VoiceCallPipeline.js';

export const PIPELINE_STEP_LABELS: Record<string, string> = {
  orchestrator_enabled: 'Orchestrator enabled',
  agent_runtime: 'Agent ready to dial',
  min_gap: 'Minimum gap between calls',
  queue_peek: 'Next in queue',
  queue_pickup: 'Task picked from queue',
  trigger_uuid: 'API Trigger UUID configured',
  farmer_mobile: 'Farmer mobile on task',
  mark_in_progress: 'Task marked in progress',
  safe_dial: 'Dial number resolved',
  dograh_api: 'Dograh outbound API call',
  awaiting_webhook: 'Awaiting Dograh webhook',
  webhook_received: 'Webhook received',
  task_complete: 'Task completed',
};

function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `***${digits.slice(-4)}`;
}

export class VoicePipelineTracer {
  private readonly docId: mongoose.Types.ObjectId;

  private constructor(docId: mongoose.Types.ObjectId) {
    this.docId = docId;
  }

  static async start(
    agentId: string,
    traceKind: VoicePipelineTraceKind,
    meta?: {
      attemptId?: string;
      taskId?: string;
      dialNumber?: string;
      farmerName?: string;
    }
  ): Promise<VoicePipelineTracer> {
    const doc = await VoiceCallPipeline.create({
      agentId: new mongoose.Types.ObjectId(agentId),
      traceKind,
      attemptId: meta?.attemptId,
      taskId: meta?.taskId && mongoose.Types.ObjectId.isValid(meta.taskId)
        ? new mongoose.Types.ObjectId(meta.taskId)
        : undefined,
      dialNumberMasked: meta?.dialNumber ? maskPhone(meta.dialNumber) : undefined,
      farmerName: meta?.farmerName?.trim() || undefined,
      overallStatus: 'running',
      steps: [],
    });
    return new VoicePipelineTracer(doc._id);
  }

  private async pushStep(
    key: string,
    status: PipelineStepStatus,
    message?: string,
    overallStatus?: VoicePipelineOverallStatus
  ): Promise<void> {
    const label = PIPELINE_STEP_LABELS[key] || key;
    const step: IPipelineStep = {
      key,
      label,
      status,
      message,
      at: new Date(),
    };

    const update: Record<string, unknown> = {
      $push: { steps: step },
      updatedAt: new Date(),
    };

    if (overallStatus) {
      update.$set = {
        overallStatus,
        ...(status === 'failed' ? { failedAtStep: key } : {}),
      };
    }

    await VoiceCallPipeline.findByIdAndUpdate(this.docId, update);
  }

  async pass(key: string, message?: string): Promise<void> {
    await this.pushStep(key, 'success', message);
  }

  async running(key: string, message?: string): Promise<void> {
    await this.pushStep(key, 'running', message, 'running');
  }

  async fail(key: string, message: string): Promise<void> {
    await this.pushStep(key, 'failed', message, 'failed');
  }

  async block(key: string, message: string): Promise<void> {
    await this.pushStep(key, 'failed', message, 'blocked');
  }

  async complete(message?: string): Promise<void> {
    await VoiceCallPipeline.findByIdAndUpdate(this.docId, {
      overallStatus: 'success',
      updatedAt: new Date(),
      ...(message ? { $push: { steps: { key: 'done', label: 'Complete', status: 'success', message, at: new Date() } } } : {}),
    });
  }

  async setWorkflowRunId(workflowRunId: number): Promise<void> {
    await VoiceCallPipeline.findByIdAndUpdate(this.docId, {
      workflowRunId,
      updatedAt: new Date(),
    });
  }

  async setDialNumber(dialNumber: string): Promise<void> {
    await VoiceCallPipeline.findByIdAndUpdate(this.docId, {
      dialNumberMasked: maskPhone(dialNumber),
      updatedAt: new Date(),
    });
  }

  async setFarmerName(farmerName: string): Promise<void> {
    const name = farmerName?.trim();
    if (!name) return;
    await VoiceCallPipeline.findByIdAndUpdate(this.docId, {
      farmerName: name,
      updatedAt: new Date(),
    });
  }

  get id(): string {
    return this.docId.toString();
  }
}

export async function getRecentPipelineTraces(agentId: string, limit = 10) {
  if (!mongoose.Types.ObjectId.isValid(agentId)) return [];
  return VoiceCallPipeline.find({ agentId: new mongoose.Types.ObjectId(agentId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function advancePipelineOnWebhook(
  taskId: string,
  attemptId: string | undefined,
  workflowRunId: number | null
): Promise<void> {
  const query: Record<string, unknown> = {
    overallStatus: { $in: ['running', 'blocked'] },
  };

  if (workflowRunId != null && !Number.isNaN(workflowRunId)) {
    query.workflowRunId = workflowRunId;
  } else if (attemptId) {
    query.attemptId = attemptId;
  } else if (mongoose.Types.ObjectId.isValid(taskId)) {
    query.taskId = new mongoose.Types.ObjectId(taskId);
  } else {
    return;
  }

  const trace = await VoiceCallPipeline.findOne(query).sort({ createdAt: -1 });
  if (!trace) return;

  const steps: IPipelineStep[] = [
    {
      key: 'webhook_received',
      label: PIPELINE_STEP_LABELS.webhook_received,
      status: 'success',
      message: 'Dograh posted call result to Reach',
      at: new Date(),
    },
    {
      key: 'task_complete',
      label: PIPELINE_STEP_LABELS.task_complete,
      status: 'success',
      message: `Task ${taskId} updated`,
      at: new Date(),
    },
  ];

  await VoiceCallPipeline.findByIdAndUpdate(trace._id, {
    $push: { steps: { $each: steps } },
    overallStatus: 'success',
    updatedAt: new Date(),
  });
}
