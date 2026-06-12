import mongoose, { Document, Schema } from 'mongoose';

export type FfaDataSource = 'api' | 'excel';
export type FfaScheduleMode = 'off' | 'hourly' | 'daily' | 'interval';

export interface IFfaSyncConfig extends Document {
  key: 'default';
  /** Primary ingest path for Activity Monitoring */
  dataSource: FfaDataSource;
  /** EMS pull limit per sync; null = server env default (0 = all eligible) */
  activitiesPullLimit: number | null;
  /** FFA activity date cutoff sent as EMS dateFrom (activities on/after this date, not yet delivered by EMS) */
  emsActivitiesDateFrom: Date | null;
  scheduleEnabled: boolean;
  scheduleMode: FfaScheduleMode;
  /** Used when scheduleMode = interval (minutes, min 10) */
  scheduleIntervalMinutes: number;
  /** Used when scheduleMode = daily (0–23 in scheduleTimezone) */
  scheduleDailyHour: number;
  /** Used when scheduleMode = daily (0–59) */
  scheduleDailyMinute: number;
  scheduleTimezone: string;
  lastScheduledRunAt: Date | null;
  lastScheduledRunActivitiesSynced: number | null;
  lastScheduledRunFarmersSynced: number | null;
  lastScheduledRunSkipped: boolean;
  lastScheduledRunMessage: string | null;
  updatedByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FfaSyncConfigSchema = new Schema<IFfaSyncConfig>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
      enum: ['default'],
    },
    dataSource: {
      type: String,
      enum: ['api', 'excel'],
      default: 'api',
    },
    activitiesPullLimit: {
      type: Number,
      default: null,
      min: 0,
    },
    emsActivitiesDateFrom: {
      type: Date,
      default: null,
    },
    scheduleEnabled: {
      type: Boolean,
      default: false,
    },
    scheduleMode: {
      type: String,
      enum: ['off', 'hourly', 'daily', 'interval'],
      default: 'daily',
    },
    scheduleIntervalMinutes: {
      type: Number,
      default: 60,
      min: 10,
      max: 10080,
    },
    scheduleDailyHour: {
      type: Number,
      default: 6,
      min: 0,
      max: 23,
    },
    scheduleDailyMinute: {
      type: Number,
      default: 0,
      min: 0,
      max: 59,
    },
    scheduleTimezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    lastScheduledRunAt: { type: Date, default: null },
    lastScheduledRunActivitiesSynced: { type: Number, default: null },
    lastScheduledRunFarmersSynced: { type: Number, default: null },
    lastScheduledRunSkipped: { type: Boolean, default: false },
    lastScheduledRunMessage: { type: String, default: null },
    updatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

FfaSyncConfigSchema.index({ key: 1 }, { unique: true });

export const FfaSyncConfig = mongoose.model<IFfaSyncConfig>('FfaSyncConfig', FfaSyncConfigSchema);
