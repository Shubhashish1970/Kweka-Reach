import mongoose, { Document, Schema } from 'mongoose';

export type UserRole = 'cc_agent' | 'team_lead' | 'mis_admin' | 'core_sales_head' | 'marketing_head';

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
      enum: ['Hindi', 'Telugu', 'Marathi', 'Kannada', 'Tamil', 'Bengali', 'Oriya', 'English', 'Malayalam'],
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

