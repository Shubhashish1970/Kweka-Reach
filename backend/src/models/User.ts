import mongoose, { Document, Schema } from 'mongoose';

export type UserRole = 'cc_agent' | 'team_lead' | 'mis_admin' | 'core_sales_head' | 'marketing_head';

export type AgentKind = 'human' | 'virtual';

export type VoiceOperationalStatus = 'running' | 'paused' | 'stopped';

export type VoiceTriggerRouteType = 'api_trigger' | 'workflow';

export interface IVoiceAgentConfig {
  voiceTriggerUuid?: string | null;
  triggerRouteType?: VoiceTriggerRouteType;
  telephonyConfigurationId?: number | null;
  contextAgentName?: string | null;
  voiceStatus: VoiceOperationalStatus;
  inheritGlobalCallingWindow: boolean;
  callingTimezone?: string;
  callingDaysOfWeek?: number[];
  callingStartTime?: string;
  callingEndTime?: string;
  inheritGlobalLimits: boolean;
  maxConcurrentCalls?: number;
  minGapBetweenCallsSec?: number;
  maxCallsPerDay?: number;
  pauseReason?: string;
  pausedByUserId?: mongoose.Types.ObjectId;
  pausedAt?: Date;
  consecutiveApiFailures?: number;
  lastTriggerAt?: Date;
  lastTriggerError?: string | null;
  lastWebhookAt?: Date;
  lastSuccessfulTriggerAt?: Date;
  configUpdatedAt?: Date;
  configUpdatedByUserId?: mongoose.Types.ObjectId;
  /** When true, orchestrator dials voiceDialOverrideNumber instead of farmer mobile */
  voiceDialOverrideEnabled?: boolean;
  voiceDialOverrideNumber?: string | null;
}

export const ALL_ROLES: UserRole[] = ['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head'];

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: UserRole; // Primary/default role (backward compatible)
  roles: UserRole[]; // All roles this user can assume
  employeeId: string;
  languageCapabilities: string[];
  assignedTerritories: string[];
  teamLeadId?: mongoose.Types.ObjectId; // For cc_agent role - points to team_lead user
  /** human = manual dialer; virtual = voice orchestrator */
  agentKind?: AgentKind;
  voiceAgentConfig?: IVoiceAgentConfig;
  isActive: boolean;
  /** When true, user may only call auth/me, logout, and change-password until they set a new password */
  mustChangePassword?: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // Don't return password in queries by default
    },
    role: {
      type: String,
      enum: ['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head'],
      required: [true, 'Role is required'],
    },
    roles: {
      type: [String],
      enum: ['cc_agent', 'team_lead', 'mis_admin', 'core_sales_head', 'marketing_head'],
      default: function(this: any) {
        // Default to array containing the primary role
        return this.role ? [this.role] : [];
      },
    },
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    languageCapabilities: {
      type: [String],
      default: [],
    },
    assignedTerritories: {
      type: [String],
      default: [],
    },
    teamLeadId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    agentKind: {
      type: String,
      enum: ['human', 'virtual'],
      default: 'human',
    },
    voiceAgentConfig: {
      voiceTriggerUuid: { type: String, default: null, trim: true },
      triggerRouteType: { type: String, enum: ['api_trigger', 'workflow'], default: 'api_trigger' },
      telephonyConfigurationId: { type: Number, default: null },
      contextAgentName: { type: String, default: null, trim: true },
      voiceStatus: { type: String, enum: ['running', 'paused', 'stopped'], default: 'paused' },
      inheritGlobalCallingWindow: { type: Boolean, default: true },
      callingTimezone: { type: String, default: null },
      callingDaysOfWeek: { type: [Number], default: undefined },
      callingStartTime: { type: String, default: null },
      callingEndTime: { type: String, default: null },
      inheritGlobalLimits: { type: Boolean, default: true },
      maxConcurrentCalls: { type: Number, default: null, min: 1, max: 5 },
      minGapBetweenCallsSec: { type: Number, default: null, min: 0, max: 3600 },
      maxCallsPerDay: { type: Number, default: null, min: 0, max: 5000 },
      pauseReason: { type: String, default: null },
      pausedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      pausedAt: { type: Date, default: null },
      consecutiveApiFailures: { type: Number, default: 0, min: 0 },
      lastTriggerAt: { type: Date, default: null },
      lastTriggerError: { type: String, default: null },
      lastWebhookAt: { type: Date, default: null },
      lastSuccessfulTriggerAt: { type: Date, default: null },
      configUpdatedAt: { type: Date, default: null },
      configUpdatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      voiceDialOverrideEnabled: { type: Boolean, default: false },
      voiceDialOverrideNumber: { type: String, default: null, trim: true },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes (email and employeeId already have unique: true, so no need to index again)
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ roles: 1, isActive: 1 });
UserSchema.index({ teamLeadId: 1 });

// Performance optimization indexes
UserSchema.index({ teamLeadId: 1, role: 1, isActive: 1 }); // For team member lookups
UserSchema.index({ languageCapabilities: 1, role: 1, isActive: 1 }); // For agent language matching
UserSchema.index({ agentKind: 1, role: 1, isActive: 1 }); // Virtual voice agents

// Pre-save middleware to ensure roles array always contains the primary role
UserSchema.pre('save', function(next) {
  if (this.role && (!this.roles || this.roles.length === 0)) {
    this.roles = [this.role];
  }
  // Ensure primary role is always in roles array
  if (this.role && !this.roles.includes(this.role)) {
    this.roles.push(this.role);
  }
  next();
});

// Virtual for team members (for team_lead role)
UserSchema.virtual('teamMembers', {
  ref: 'User',
  localField: '_id',
  foreignField: 'teamLeadId',
});

export const User = mongoose.model<IUser>('User', UserSchema);

