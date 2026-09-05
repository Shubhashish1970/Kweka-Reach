import mongoose, { Document, Schema } from 'mongoose';

export type PipelineStepStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'running';
export type VoicePipelineTraceKind = 'orchestrator_tick' | 'test_call' | 'queue_call';
export type VoicePipelineOverallStatus = 'running' | 'success' | 'failed' | 'blocked';

export interface IPipelineStep {
  key: string;
  label: string;
  status: PipelineStepStatus;
  message?: string;
  errorCode?: string;
  at?: Date;
}

export interface IVoiceCallPipeline extends Document {
  agentId: mongoose.Types.ObjectId;
  traceKind: VoicePipelineTraceKind;
  attemptId?: string;
  taskId?: mongoose.Types.ObjectId;
  workflowRunId?: number;
  overallStatus: VoicePipelineOverallStatus;
  failedAtStep?: string;
  failedErrorCode?: string;
  steps: IPipelineStep[];
  dialNumberMasked?: string;
  /** Farmer (or test) name for the dial target / next queue item */
  farmerName?: string;
  /** Payload posted to Dograh (phone masked). Peek-only ticks store task_id. */
  outboundPayload?: Record<string, unknown>;
  /** Raw webhook JSON posted back from Dograh (once received). */
  inboundWebhookPayload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const PipelineStepSchema = new Schema<IPipelineStep>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'skipped', 'running'],
      required: true,
    },
    message: { type: String },
    errorCode: { type: String },
    at: { type: Date },
  },
  { _id: false }
);

const VoiceCallPipelineSchema = new Schema<IVoiceCallPipeline>(
  {
    agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    traceKind: {
      type: String,
      enum: ['orchestrator_tick', 'test_call', 'queue_call'],
      required: true,
    },
    attemptId: { type: String, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'CallTask' },
    workflowRunId: { type: Number },
    overallStatus: {
      type: String,
      enum: ['running', 'success', 'failed', 'blocked'],
      default: 'running',
    },
    failedAtStep: { type: String },
    failedErrorCode: { type: String },
    steps: { type: [PipelineStepSchema], default: [] },
    dialNumberMasked: { type: String },
    farmerName: { type: String, trim: true },
    outboundPayload: { type: Schema.Types.Mixed },
    inboundWebhookPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

VoiceCallPipelineSchema.index({ agentId: 1, createdAt: -1 });
VoiceCallPipelineSchema.index({ workflowRunId: 1 });
VoiceCallPipelineSchema.index({ attemptId: 1 });

export const VoiceCallPipeline = mongoose.model<IVoiceCallPipeline>(
  'VoiceCallPipeline',
  VoiceCallPipelineSchema
);
