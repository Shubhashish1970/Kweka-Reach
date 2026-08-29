import mongoose, { Document, Schema } from 'mongoose';

export type ActivityLifecycleStatus = 'active' | 'sampled' | 'inactive' | 'not_eligible';

export interface ISamplingConfig extends Document {
  key: 'default';
  isActive: boolean;
  activityCoolingDays: number;
  farmerCoolingDays: number;
  defaultPercentage: number;
  activityTypePercentages: Record<string, number>;
  eligibleActivityTypes: string[]; // empty => all eligible
  /** Automatic later run: enable/disable cron-triggered Run Sample when unsampled >= threshold */
  autoRunEnabled?: boolean;
  /** Run when unsampled (active, never sampled) activities in auto range >= this (default 200) */
  autoRunThreshold?: number;
  /** Activities on/after this activity date are considered for sampling; earlier eligible activities are left alone (with confirm). */
  autoRunActivateFrom?: Date | null;
  /** Task due date = today + this many days (0 = today). Used for both Sampling Run and Adhoc Run. */
  taskDueInDays?: number;
  /** Last time POST /api/sampling/auto-run actually triggered a run (set when ran: true) */
  lastAutoRunAt?: Date | null;
  lastAutoRunRunId?: string | null;
  lastAutoRunMatched?: number;
  lastAutoRunProcessed?: number;
  lastAutoRunTasksCreated?: number;
  updatedByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SamplingConfigSchema = new Schema<ISamplingConfig>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
      enum: ['default'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    activityCoolingDays: {
      type: Number,
      required: true,
      default: 5,
      min: 0,
      max: 365,
    },
    farmerCoolingDays: {
      type: Number,
      required: true,
      default: 30,
      min: 0,
      max: 365,
    },
    defaultPercentage: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
      max: 100,
    },
    activityTypePercentages: {
      type: Schema.Types.Mixed,
      default: {},
    },
    eligibleActivityTypes: {
      type: [String],
      default: [],
    },
    autoRunEnabled: {
      type: Boolean,
      default: false,
    },
    autoRunThreshold: {
      type: Number,
      default: 200,
      min: 1,
      max: 100000,
    },
    autoRunActivateFrom: {
      type: Date,
      default: null,
    },
    taskDueInDays: {
      type: Number,
      default: 0,
      min: 0,
      max: 365,
    },
    lastAutoRunAt: { type: Date, default: null },
    lastAutoRunRunId: { type: String, default: null },
    lastAutoRunMatched: { type: Number, default: null },
    lastAutoRunProcessed: { type: Number, default: null },
    lastAutoRunTasksCreated: { type: Number, default: null },
    updatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

SamplingConfigSchema.index({ key: 1 }, { unique: true });
SamplingConfigSchema.index({ isActive: 1 });

export const SamplingConfig = mongoose.model<ISamplingConfig>('SamplingConfig', SamplingConfigSchema);

