import mongoose, { Document, Schema } from 'mongoose';

export interface IActivity extends Document {
  activityId: string; // FFA App activity ID
  type: string;
  date: Date;
  lifecycleStatus?: 'active' | 'sampled' | 'inactive' | 'not_eligible' | 'superseded';
  lifecycleUpdatedAt?: Date;
  lastSamplingRunAt?: Date;
  /** True once this activity has been processed in a first-sample run; never reset by ad-hoc runs */
  firstSampleRun?: boolean;
  /** Set when firstSampleRun is set to true */
  firstSampledAt?: Date;
  officerId: string;
  officerName: string;
  location: string;
  // Geo hierarchy (Activity API v2)
  // Note: We keep legacy `territory` for backward compatibility but prefer `territoryName`.
  territory: string; // legacy / display fallback
  territoryName?: string;
  zoneName?: string;
  buName?: string;
  state?: string; // Source-of-truth for language derivation (required once Activity API v2 is stable)

  // Field Sales hierarchy (Activity API v2)
  // Note: `officerId`/`officerName` represent MDO; we store TM separately.
  tmEmpCode?: string;
  tmName?: string;
  farmerIds: mongoose.Types.ObjectId[];
  crops: string[]; // Crops discussed in the activity
  products: string[]; // NACL products discussed in the activity
  syncedAt: Date;
  /** Set on each Excel import or FFA sync so rows can be removed per ingest batch before sampling/tasks exist */
  dataBatchId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ActivitySchema = new Schema<IActivity>(
  {
    activityId: {
      type: String,
      required: [true, 'Activity ID is required'],
      unique: true,
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Activity type is required'],
      trim: true,
    },
    date: {
      type: Date,
      required: [true, 'Activity date is required'],
    },
    lifecycleStatus: {
      type: String,
      enum: ['active', 'sampled', 'inactive', 'not_eligible', 'superseded'],
      default: 'active',
      index: true,
    },
    lifecycleUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    lastSamplingRunAt: {
      type: Date,
      default: null,
    },
    firstSampleRun: {
      type: Boolean,
      default: false,
      index: true,
    },
    firstSampledAt: {
      type: Date,
      default: null,
    },
    officerId: {
      type: String,
      required: [true, 'Officer ID is required'],
      trim: true,
    },
    officerName: {
      type: String,
      required: [true, 'Officer name is required'],
      trim: true,
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    territory: {
      type: String,
      required: [true, 'Territory is required'],
      trim: true,
    },
    territoryName: {
      type: String,
      trim: true,
      default: '',
    },
    zoneName: {
      type: String,
      trim: true,
      default: '',
    },
    buName: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      required: false, // Optional for backward compatibility, migration will populate
      trim: true,
    },
    tmEmpCode: {
      type: String,
      trim: true,
      default: '',
    },
    tmName: {
      type: String,
      trim: true,
      default: '',
    },
    farmerIds: [{
      type: Schema.Types.ObjectId,
      ref: 'Farmer',
    }],
    crops: [{
      type: String,
      trim: true,
    }],
    products: [{
      type: String,
      trim: true,
    }],
    syncedAt: {
      type: Date,
      default: Date.now,
    },
    dataBatchId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes - Optimized for 2-3 years of data (600 people × 4-5 activities/day = ~2.7M activities/3 years)
// Primary access pattern indexes
// Note: activityId index is auto-created by unique: true in schema definition
ActivitySchema.index({ date: -1 }); // For date range queries and sorting by date
ActivitySchema.index({ territory: 1 }); // For territory filtering
ActivitySchema.index({ territoryName: 1 }); // For territory filtering (preferred)
ActivitySchema.index({ officerId: 1 }); // For officer filtering
ActivitySchema.index({ type: 1 }); // For activity type filtering
ActivitySchema.index({ type: 1, date: -1 }); // Compound: type + date for common query pattern
ActivitySchema.index({ territory: 1, date: -1 }); // Compound: territory + date for filtering
ActivitySchema.index({ territoryName: 1, date: -1 }); // Compound: territoryName + date for filtering
ActivitySchema.index({ state: 1 }); // For state filtering
ActivitySchema.index({ state: 1, date: -1 }); // Compound: state + date for filtering
ActivitySchema.index({ zoneName: 1 }); // For zone filtering
ActivitySchema.index({ buName: 1 }); // For BU filtering
ActivitySchema.index({ syncedAt: -1 }); // For sync monitoring
ActivitySchema.index({ dataBatchId: 1, syncedAt: -1 }); // Batch list + latest sync batch lookup
ActivitySchema.index({ farmerIds: 1 }); // For farmer lookup in activities
ActivitySchema.index({ lifecycleStatus: 1, date: -1 }); // For sampling control list views

// Performance optimization indexes (added for high-volume dashboard queries)
ActivitySchema.index({ lifecycleStatus: 1, territoryName: 1, date: -1 }); // Sampling control with territory filter
ActivitySchema.index({ lifecycleStatus: 1, zoneName: 1, date: -1 }); // Sampling control with zone filter
ActivitySchema.index({ lifecycleStatus: 1, buName: 1, date: -1 }); // Sampling control with BU filter
ActivitySchema.index({ firstSampleRun: 1, date: 1 }); // First sample / ad-hoc run queries

export const Activity = mongoose.model<IActivity>('Activity', ActivitySchema);

