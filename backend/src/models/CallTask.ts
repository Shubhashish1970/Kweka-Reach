import mongoose, { Document, Schema } from 'mongoose';

export type TaskStatus =
  | 'unassigned'
  | 'sampled_in_queue'
  | 'in_progress'
  | 'completed'
  | 'not_reachable'
  | 'invalid_number';
export type CallStatus =
  | 'Connected'
  | 'Disconnected'
  | 'Incoming N/A'
  | 'No Answer'
  | 'Invalid'
  // Backward-compatible legacy values stored previously
  | 'Not Reachable'
  | 'Invalid Number';

export interface ICallLog {
  timestamp: Date;
  callStatus: CallStatus;
  callDurationSeconds?: number; // captured for analytics (connected calls)
  didAttend: string | null; // Changed from boolean to string enum
  didRecall: boolean | null;
  cropsDiscussed: string[];
  productsDiscussed: string[];
  hasPurchased: boolean | null;
  willingToPurchase: boolean | null;
  likelyPurchaseDate: string;
  nonPurchaseReason: string;
  purchasedProducts: Array<{ product: string; quantity: string; unit: string }>;
  farmerComments: string; // Replaces agentObservations
  sentiment: 'Positive' | 'Negative' | 'Neutral' | 'N/A'; // Sentiment indicator
  activityQuality?: number; // 1-5: FDA holistic crop solution understanding (4B. Activity Quality)
}

export type Outcome = 
  | 'Completed Conversation'
  | 'In Progress'
  | 'Unsuccessful'
  | 'Unknown';

export interface ICallTask extends Document {
  farmerId: mongoose.Types.ObjectId;
  activityId: mongoose.Types.ObjectId;
  status: TaskStatus;
  outcome?: Outcome; // Stored outcome label
  retryCount: number;
  assignedAgentId?: mongoose.Types.ObjectId | null;
  scheduledDate: Date;
  callStartedAt?: Date | null;
  callLog?: ICallLog;
  interactionHistory: Array<{
    timestamp: Date;
    status: TaskStatus;
    notes?: string;
  }>;
  // Callback/Retry fields
  parentTaskId?: mongoose.Types.ObjectId | null; // Link to original task for callbacks
  isCallback: boolean; // true for callback tasks
  callbackNumber: number; // 0 for original, 1 for 1st callback, 2 for 2nd callback
  /** Set when task is created by sampling run; used for adhoc vs first_sample stats */
  samplingRunId?: mongoose.Types.ObjectId | null;
  samplingRunType?: 'first_sample' | 'adhoc' | null;
  createdAt: Date;
  updatedAt: Date;
}

const CallLogSchema = new Schema<ICallLog>({
  timestamp: {
    type: Date,
    default: Date.now,
  },
  callStatus: {
    type: String,
    enum: ['Connected', 'Disconnected', 'Incoming N/A', 'No Answer', 'Invalid', 'Not Reachable', 'Invalid Number'],
    required: true,
  },
  callDurationSeconds: {
    type: Number,
    default: 0,
  },
  didAttend: {
    type: String,
    enum: ['Yes, I attended', 'No, I missed', "Don't recall", 'Identity Wrong', 'Not a Farmer', null],
    default: null,
  },
  didRecall: {
    type: Boolean,
    default: null,
  },
  cropsDiscussed: {
    type: [String],
    default: [],
  },
  productsDiscussed: {
    type: [String],
    default: [],
  },
  hasPurchased: {
    type: Boolean,
    default: null,
  },
  willingToPurchase: {
    type: Boolean,
    default: null,
  },
  likelyPurchaseDate: {
    type: String,
    default: '',
  },
  nonPurchaseReason: {
    type: String,
    default: '',
  },
  purchasedProducts: {
    type: [
      {
        product: { type: String, default: '' },
        quantity: { type: String, default: '' },
        unit: { type: String, default: 'kg' },
      },
    ],
    default: [],
  },
  farmerComments: {
    type: String,
    default: '',
  },
  sentiment: {
    type: String,
    enum: ['Positive', 'Negative', 'Neutral', 'N/A'],
    default: 'N/A',
  },
  activityQuality: {
    type: Number,
    min: 1,
    max: 5,
    default: undefined,
  },
}, { _id: false });

const InteractionHistorySchema = new Schema({
  timestamp: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['unassigned', 'sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number'],
    required: true,
  },
  notes: {
    type: String,
    default: '',
  },
}, { _id: false });

const CallTaskSchema = new Schema<ICallTask>(
  {
    farmerId: {
      type: Schema.Types.ObjectId,
      ref: 'Farmer',
      required: [true, 'Farmer ID is required'],
    },
    activityId: {
      type: Schema.Types.ObjectId,
      ref: 'Activity',
      required: [true, 'Activity ID is required'],
    },
    status: {
      type: String,
      enum: ['unassigned', 'sampled_in_queue', 'in_progress', 'completed', 'not_reachable', 'invalid_number'],
      default: 'unassigned',
    },
    outcome: {
      type: String,
      enum: ['Completed Conversation', 'In Progress', 'Unsuccessful', 'Unknown'],
      required: false,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    assignedAgentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required'],
    },
    callStartedAt: {
      type: Date,
      default: null,
    },
    callLog: {
      type: CallLogSchema,
      default: null,
    },
    interactionHistory: {
      type: [InteractionHistorySchema],
      default: [],
    },
    // Callback/Retry fields
    parentTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'CallTask',
      default: null,
    },
    samplingRunId: {
      type: Schema.Types.ObjectId,
      ref: 'SamplingRun',
      default: null,
    },
    samplingRunType: {
      type: String,
      enum: ['first_sample', 'adhoc'],
      default: null,
    },
    isCallback: {
      type: Boolean,
      default: false,
    },
    callbackNumber: {
      type: Number,
      default: 0, // 0 = original, 1 = 1st callback, 2 = 2nd callback (max)
      min: [0, 'callbackNumber cannot be negative'],
      max: [2, 'callbackNumber cannot exceed 2 (maximum 2 callbacks allowed)'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes - Optimized for 2-3 years of data (~19M tasks over 3 years)
// Primary access pattern indexes
CallTaskSchema.index({ status: 1, assignedAgentId: 1 }); // For agent queue queries
CallTaskSchema.index({ farmerId: 1, createdAt: -1 }); // For farmer history
CallTaskSchema.index({ scheduledDate: 1 }); // For chronological ordering
CallTaskSchema.index({ activityId: 1 }); // For activity-based queries
CallTaskSchema.index({ assignedAgentId: 1, status: 1, scheduledDate: 1 }); // Compound: agent queue with status and date
CallTaskSchema.index({ activityId: 1, farmerId: 1, callbackNumber: 1 }, { unique: true }); // UNIQUE: Prevent duplicate tasks for same farmer+activity+callbackNumber
CallTaskSchema.index({ createdAt: -1 }); // For recent tasks
CallTaskSchema.index({ status: 1, scheduledDate: 1 }); // Compound: status + scheduled date for filtering
CallTaskSchema.index({ status: 1, scheduledDate: 1, createdAt: -1 }); // For unassigned management
CallTaskSchema.index({ parentTaskId: 1 }); // For callback chain queries
CallTaskSchema.index({ isCallback: 1, status: 1 }); // For callback filtering

// Performance optimization indexes (added for high-volume operations)
CallTaskSchema.index({ status: 1, scheduledDate: 1, assignedAgentId: 1 }); // For pending tasks stats aggregation
CallTaskSchema.index({ status: 1, callbackNumber: 1, createdAt: -1 }); // For callback candidate queries
CallTaskSchema.index({ 'callLog.sentiment': 1, status: 1 }, { sparse: true }); // For sentiment analytics
CallTaskSchema.index({ updatedAt: -1 }); // For recent updates tracking

export const CallTask = mongoose.model<ICallTask>('CallTask', CallTaskSchema);


