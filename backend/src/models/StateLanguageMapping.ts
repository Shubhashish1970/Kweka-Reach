import mongoose, { Document, Schema } from 'mongoose';

export interface IStateLanguageMapping extends Document {
  state: string; // State name (e.g., "Uttar Pradesh", "Andhra Pradesh")
  primaryLanguage: string; // Primary language for the state
  secondaryLanguages?: string[]; // Optional: Other languages spoken in the state
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StateLanguageMappingSchema = new Schema<IStateLanguageMapping>(
  {
    state: {
      type: String,
      required: [true, 'State name is required'],
      unique: true,
      trim: true,
      uppercase: false, // Keep proper case
    },
    primaryLanguage: {
      type: String,
      required: [true, 'Primary language is required'],
      trim: true,
    },
    secondaryLanguages: [{
      type: String,
      trim: true,
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
StateLanguageMappingSchema.index({ state: 1 }, { unique: true });
StateLanguageMappingSchema.index({ primaryLanguage: 1 });
StateLanguageMappingSchema.index({ isActive: 1 });

export const StateLanguageMapping = mongoose.model<IStateLanguageMapping>(
  'StateLanguageMapping',
  StateLanguageMappingSchema
);
