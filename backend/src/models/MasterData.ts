import mongoose, { Document, Schema } from 'mongoose';

export interface IMasterCrop extends Document {
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMasterProduct extends Document {
  name: string;
  category?: string;
  segment?: string;
  subcategory?: string;
  productCode?: string;
  focusProducts?: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface INonPurchaseReason extends Document {
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISentiment extends Document {
  name: string;
  colorClass: string;
  icon: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMasterLanguage extends Document {
  name: string;        // e.g., "Hindi", "Telugu"
  code: string;        // e.g., "HI", "TE" (ISO 639-1 style)
  displayOrder: number;
  isActive: boolean;
  /** Calling agent API trigger UUID for this language (Dograh) */
  voiceTriggerUuid?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MasterCropSchema = new Schema<IMasterCrop>(
  {
    name: {
      type: String,
      required: [true, 'Crop name is required'],
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const MasterProductSchema = new Schema<IMasterProduct>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    category: {
      type: String,
      trim: true,
    },
    segment: {
      type: String,
      trim: true,
    },
    subcategory: {
      type: String,
      trim: true,
    },
    productCode: {
      type: String,
      trim: true,
    },
    focusProducts: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const NonPurchaseReasonSchema = new Schema<INonPurchaseReason>(
  {
    name: {
      type: String,
      required: [true, 'Reason name is required'],
      trim: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const SentimentSchema = new Schema<ISentiment>(
  {
    name: {
      type: String,
      required: [true, 'Sentiment name is required'],
      trim: true,
    },
    colorClass: {
      type: String,
      default: 'bg-slate-100 text-slate-800',
    },
    icon: {
      type: String,
      default: 'circle',
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const MasterLanguageSchema = new Schema<IMasterLanguage>(
  {
    name: {
      type: String,
      required: [true, 'Language name is required'],
      trim: true,
    },
    code: {
      type: String,
      required: [true, 'Language code is required'],
      trim: true,
      uppercase: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    voiceTriggerUuid: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes - Partial unique indexes (only unique when isActive: true)
// This allows inactive records to have duplicate names, but active records must be unique
MasterCropSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
MasterCropSchema.index({ isActive: 1 });
MasterProductSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
MasterProductSchema.index({ isActive: 1 });
NonPurchaseReasonSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
NonPurchaseReasonSchema.index({ isActive: 1, displayOrder: 1 });
SentimentSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
SentimentSchema.index({ isActive: 1, displayOrder: 1 });
MasterLanguageSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
MasterLanguageSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
MasterLanguageSchema.index({ isActive: 1, displayOrder: 1 });

export const MasterCrop = mongoose.model<IMasterCrop>('MasterCrop', MasterCropSchema);
export const MasterProduct = mongoose.model<IMasterProduct>('MasterProduct', MasterProductSchema);
export const NonPurchaseReason = mongoose.model<INonPurchaseReason>('NonPurchaseReason', NonPurchaseReasonSchema);
export const Sentiment = mongoose.model<ISentiment>('Sentiment', SentimentSchema);
export const MasterLanguage = mongoose.model<IMasterLanguage>('MasterLanguage', MasterLanguageSchema);

