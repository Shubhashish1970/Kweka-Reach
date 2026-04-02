/**
 * Test data factories
 * All factory functions insert directly into the in-memory DB (via Mongoose models).
 * Collections are wiped between tests by setup.ts, so uniqueness only needs to hold
 * within a single test run — a simple incrementing counter is sufficient.
 */

import mongoose from 'mongoose';
import { Farmer } from '../../src/models/Farmer.js';
import { Activity } from '../../src/models/Activity.js';
import { CallTask } from '../../src/models/CallTask.js';
import { User } from '../../src/models/User.js';
import { CoolingPeriod } from '../../src/models/CoolingPeriod.js';
import { hashPassword } from '../../src/utils/password.js';

// ─── Counters ────────────────────────────────────────────────────────────────
// Module-level counters; never reset (--runInBand means sequential execution,
// so no race conditions. Collections clear between tests so DB uniqueness is fine.)
let _c = 0;
const nextN = () => ++_c;

/** 10-digit mobile: 9 + zero-padded counter */
const nextMobile = () => `9${String(nextN()).padStart(9, '0')}`;
const nextActivityId = () => `ACT-TEST-${nextN()}`;
const nextEmployeeId = () => `EMP-TEST-${nextN()}`;
const nextEmail = () => `testuser-${nextN()}@test.com`;

// ─── Farmer ──────────────────────────────────────────────────────────────────
export interface FarmerOverrides {
  name?: string;
  mobileNumber?: string;
  location?: string;
  preferredLanguage?: string;
  territory?: string;
}

export const makeFarmer = (overrides: FarmerOverrides = {}) =>
  Farmer.create({
    name: 'Test Farmer',
    mobileNumber: nextMobile(),
    location: 'Village, District, State',
    preferredLanguage: 'Hindi',
    territory: 'Test Territory',
    ...overrides,
  });

export const makeFarmers = (count: number, overrides: FarmerOverrides = {}) =>
  Promise.all(Array.from({ length: count }, () => makeFarmer(overrides)));

// ─── Activity ────────────────────────────────────────────────────────────────
export interface ActivityOverrides {
  activityId?: string;
  type?: 'Field Day' | 'Group Meeting' | 'Demo Visit' | 'OFM' | 'Other';
  date?: Date;
  lifecycleStatus?: 'active' | 'sampled' | 'inactive' | 'not_eligible';
  officerId?: string;
  officerName?: string;
  location?: string;
  territory?: string;
  state?: string;
  dataBatchId?: string;
}

/** Creates an activity whose date is 10 days ago so it clears the activity
 *  cooling gate by default. Pass `date: new Date()` to override. */
export const makeActivity = (
  farmerIds: mongoose.Types.ObjectId[],
  overrides: ActivityOverrides = {}
) =>
  Activity.create({
    activityId: nextActivityId(),
    type: 'Field Day',
    // 10 days ago — past default activityCoolingDays (5) so gate passes without forceRun
    date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    officerId: 'OFFICER-1',
    officerName: 'Test Officer',
    location: 'Test Village',
    territory: 'Test Territory',
    state: 'Telangana',
    farmerIds,
    crops: [],
    products: [],
    syncedAt: new Date(),
    lifecycleStatus: 'active',
    ...overrides,
  });

// ─── User ────────────────────────────────────────────────────────────────────
export interface UserOverrides {
  name?: string;
  email?: string;
  /** Provide PLAIN TEXT — factory hashes it */
  password?: string;
  role?: 'cc_agent' | 'team_lead' | 'mis_admin' | 'core_sales_head' | 'marketing_head';
  roles?: string[];
  employeeId?: string;
  languageCapabilities?: string[];
  assignedTerritories?: string[];
  teamLeadId?: mongoose.Types.ObjectId | null;
  isActive?: boolean;
}

export const makeUser = async (overrides: UserOverrides = {}) => {
  const { password: plainPwd = 'Password1', ...rest } = overrides;
  const hashedPwd = await hashPassword(plainPwd);
  return User.create({
    name: 'Test User',
    email: nextEmail(),
    password: hashedPwd,
    role: 'cc_agent',
    employeeId: nextEmployeeId(),
    languageCapabilities: ['Hindi'],
    assignedTerritories: [],
    isActive: true,
    ...rest,
  });
};

export const makeAdmin = (overrides: UserOverrides = {}) =>
  makeUser({ name: 'Admin User', role: 'mis_admin', ...overrides });

export const makeTeamLead = (overrides: UserOverrides = {}) =>
  makeUser({ name: 'Team Lead', role: 'team_lead', ...overrides });

export const makeAgent = (
  teamLeadId: mongoose.Types.ObjectId,
  overrides: UserOverrides = {}
) => makeUser({ role: 'cc_agent', teamLeadId, ...overrides });

// ─── CallTask ─────────────────────────────────────────────────────────────────
export interface TaskOverrides {
  status?: 'unassigned' | 'sampled_in_queue' | 'in_progress' | 'completed' | 'not_reachable' | 'invalid_number';
  assignedAgentId?: mongoose.Types.ObjectId | null;
  callbackNumber?: number;
  isCallback?: boolean;
  parentTaskId?: mongoose.Types.ObjectId | null;
  retryCount?: number;
  scheduledDate?: Date;
  samplingRunType?: 'first_sample' | 'adhoc';
}

export const makeTask = (
  farmerId: mongoose.Types.ObjectId,
  activityId: mongoose.Types.ObjectId,
  overrides: TaskOverrides = {}
) =>
  CallTask.create({
    farmerId,
    activityId,
    status: 'unassigned',
    scheduledDate: new Date(),
    isCallback: false,
    callbackNumber: 0,
    retryCount: 0,
    interactionHistory: [],
    ...overrides,
  });

// ─── CoolingPeriod ────────────────────────────────────────────────────────────
/**
 * Puts a farmer into the cooling window.
 * @param daysAgo  How many days ago was the last call? Default 1 = called yesterday,
 *                 still within default 30-day window so farmer is blocked.
 *                 Pass 31+ to create an expired (inactive) cooling record.
 */
export const putInCooling = (
  farmerId: mongoose.Types.ObjectId,
  daysAgo = 1
) => {
  const lastCallDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(lastCallDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  return CoolingPeriod.create({
    farmerId,
    lastCallDate,
    coolingPeriodDays: 30,
    expiresAt,
  });
};
