import { Document, Schema } from 'mongoose';
import mongoose from 'mongoose';

export interface IVoiceWebhookReceipt extends Document {
  workflowRunId: number;
  taskId: mongoose.Types.ObjectId;
  attemptId?: string | null;
  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VoiceWebhookReceiptSchema = new Schema<IVoiceWebhookReceipt>(
  {
    workflowRunId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'CallTask',
      required: true,
    },
    attemptId: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

VoiceWebhookReceiptSchema.index({ taskId: 1, attemptId: 1 }, { unique: true, sparse: true });

export const VoiceWebhookReceipt = mongoose.model<IVoiceWebhookReceipt>(
  'VoiceWebhookReceipt',
  VoiceWebhookReceiptSchema
);
