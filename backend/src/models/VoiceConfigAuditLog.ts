import mongoose, { Document, Schema } from 'mongoose';

export interface IVoiceConfigAuditLog extends Document {
  scope: 'platform' | 'agent';
  agentId?: mongoose.Types.ObjectId;
  action: string;
  summary: string;
  userId?: mongoose.Types.ObjectId;
  userEmail?: string;
  createdAt: Date;
}

const VoiceConfigAuditLogSchema = new Schema<IVoiceConfigAuditLog>(
  {
    scope: { type: String, enum: ['platform', 'agent'], required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    summary: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userEmail: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

VoiceConfigAuditLogSchema.index({ scope: 1, createdAt: -1 });
VoiceConfigAuditLogSchema.index({ agentId: 1, createdAt: -1 });

export const VoiceConfigAuditLog = mongoose.model<IVoiceConfigAuditLog>(
  'VoiceConfigAuditLog',
  VoiceConfigAuditLogSchema
);
