import mongoose, { Document, Schema } from 'mongoose';

export interface IFarmer extends Document {
  name: string;
  mobileNumber: string;
  location: string;
  preferredLanguage: string;
  territory: string;
  photoUrl?: string; // URL to farmer's photo from FFA API
  createdAt: Date;
  updatedAt: Date;
}

const FarmerSchema = new Schema<IFarmer>(
  {
    name: {
      type: String,
      required: [true, 'Farmer name is required'],
      trim: true,
    },
    mobileNumber: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
      match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit mobile number'],
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    preferredLanguage: {
      type: String,
      required: [true, 'Preferred language is required'],
      trim: true,
    },
    territory: {
      type: String,
      required: [true, 'Territory is required'],
      trim: true,
    },
    photoUrl: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
// Note: mobileNumber index is auto-created by unique: true in schema definition
FarmerSchema.index({ territory: 1 });
FarmerSchema.index({ preferredLanguage: 1 });

// Performance optimization indexes
FarmerSchema.index({ preferredLanguage: 1, territory: 1 }); // For language-based agent matching

export const Farmer = mongoose.model<IFarmer>('Farmer', FarmerSchema);

