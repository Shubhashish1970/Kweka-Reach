import mongoose, { Document, Schema } from 'mongoose';

export interface IVoicePlatformSettings extends Document {
  key: 'default';
  orchestratorEnabled: boolean;
  pollIntervalSec: number;
  defaultTimezone: string;
  /** 0=Sun … 6=Sat */
  defaultCallingDaysOfWeek: number[];
  defaultCallingStartTime: string;
  defaultCallingEndTime: string;
  defaultMinGapBetweenCallsSec: number;
  defaultMaxCallsPerDay: number;
  defaultMaxConcurrentCalls: number;
  stuckCallTimeoutMinutes: number;
  autoPauseAfterConsecutiveFailures: number;
  useTestEndpoint: boolean;
  updatedByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VoicePlatformSettingsSchema = new Schema<IVoicePlatformSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'default', enum: ['default'] },
    orchestratorEnabled: { type: Boolean, default: false },
    pollIntervalSec: { type: Number, default: 30, min: 15, max: 600 },
    defaultTimezone: { type: String, default: 'Asia/Kolkata' },
    defaultCallingDaysOfWeek: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    defaultCallingStartTime: { type: String, default: '09:00' },
    defaultCallingEndTime: { type: String, default: '19:00' },
    defaultMinGapBetweenCallsSec: { type: Number, default: 45, min: 0, max: 3600 },
    defaultMaxCallsPerDay: { type: Number, default: 50, min: 0, max: 5000 },
    defaultMaxConcurrentCalls: { type: Number, default: 1, min: 1, max: 5 },
    stuckCallTimeoutMinutes: { type: Number, default: 15, min: 5, max: 120 },
    autoPauseAfterConsecutiveFailures: { type: Number, default: 5, min: 1, max: 50 },
    useTestEndpoint: { type: Boolean, default: true },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const VoicePlatformSettings = mongoose.model<IVoicePlatformSettings>(
  'VoicePlatformSettings',
  VoicePlatformSettingsSchema
);
