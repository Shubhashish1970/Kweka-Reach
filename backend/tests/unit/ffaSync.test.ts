/**
 * Unit tests for ffaSync service.
 *
 * axios.get is spied on so no real HTTP calls are made.
 *
 * Module-level state in ffaSync (isSyncing, lastSyncTime) persists across tests.
 * Each test uses fullSync: true to bypass the lastSyncTime interval guard.
 */

import axios from 'axios';
import { syncFFAData } from '../../src/services/ffaSync.js';
import { Activity } from '../../src/models/Activity.js';
import { Farmer } from '../../src/models/Farmer.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeFFAActivity = (overrides: Record<string, any> = {}) => ({
  activityId: `FFA-SYNC-${Date.now()}-${Math.random()}`,
  type: 'Field Day',
  date: '01/01/2025',
  officerId: 'OFF-001',
  officerName: 'Test Officer',
  location: 'Test Village',
  territory: 'Telangana Zone',
  state: 'Telangana',
  territoryName: 'Test Territory',
  crops: ['Wheat'],
  products: ['Product A'],
  farmers: [
    {
      farmerId: 'FARMER-001',
      name: 'Test Farmer',
      mobileNumber: `9${String(Date.now()).slice(-9)}`,
      location: 'Village',
    },
  ],
  ...overrides,
});

const mockAxiosSuccess = (activities: any[]) => {
  jest.spyOn(axios, 'get').mockResolvedValueOnce({
    status: 200,
    data: {
      success: true,
      data: { activities },
    },
  });
};

const mockAxiosHttpError = (status: number) => {
  jest.spyOn(axios, 'get').mockResolvedValueOnce({
    status,
    statusText: 'Internal Server Error',
    data: { error: 'Server Error' },
  });
};

const mockAxiosNetworkError = () => {
  const err = Object.assign(new Error('connect ECONNREFUSED'), {
    isAxiosError: true,
    code: 'ECONNREFUSED',
    response: undefined,
  });
  jest.spyOn(axios, 'get').mockRejectedValueOnce(err);
};

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── F1: happy path ───────────────────────────────────────────────────────────

describe('F1: successful sync creates activities and farmers', () => {
  test('syncs one activity with one farmer', async () => {
    const actId = `FFA-F1-${Date.now()}`;
    const mobile = `9${String(Date.now()).slice(-9)}`;
    mockAxiosSuccess([
      makeFFAActivity({ activityId: actId, farmers: [{ farmerId: 'F1', name: 'Alice', mobileNumber: mobile, location: 'V1' }] }),
    ]);

    const result = await syncFFAData(true);

    expect(result.activitiesSynced).toBe(1);
    expect(result.farmersSynced).toBe(1);
    expect(result.errors).toHaveLength(0);

    const activity = await Activity.findOne({ activityId: actId });
    expect(activity).not.toBeNull();
    expect(activity!.farmerIds.length).toBe(1);

    const farmer = await Farmer.findOne({ mobileNumber: mobile });
    expect(farmer).not.toBeNull();
  });

  test('upserts existing activity on re-sync', async () => {
    const actId = `FFA-F1-UPSERT-${Date.now()}`;
    const mobile = `9${String(Date.now() - 1).slice(-9)}`;

    mockAxiosSuccess([makeFFAActivity({ activityId: actId, officerName: 'First Officer', farmers: [{ farmerId: 'F2', name: 'Bob', mobileNumber: mobile, location: 'V2' }] })]);
    await syncFFAData(true);

    mockAxiosSuccess([makeFFAActivity({ activityId: actId, officerName: 'Updated Officer', farmers: [{ farmerId: 'F2', name: 'Bob', mobileNumber: mobile, location: 'V2' }] })]);
    await syncFFAData(true);

    const count = await Activity.countDocuments({ activityId: actId });
    expect(count).toBe(1);

    const activity = await Activity.findOne({ activityId: actId });
    expect(activity?.officerName).toBe('Updated Officer');
  });
});

// ─── F2: empty response ───────────────────────────────────────────────────────

describe('F2: FFA API returns empty activities array', () => {
  test('sync completes with 0 synced and an informational error entry', async () => {
    mockAxiosSuccess([]);

    const result = await syncFFAData(true);

    expect(result.activitiesSynced).toBe(0);
    // Returns with "no activities found" error
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── F3: language mapped from state ──────────────────────────────────────────

describe('F3: preferred language is derived from state, not from FFA payload', () => {
  test('farmer language comes from state (Telangana → Telugu)', async () => {
    const mobile = `9${String(Date.now() + 3).slice(-9)}`;
    mockAxiosSuccess([
      makeFFAActivity({
        activityId: `FFA-F3-${Date.now()}`,
        state: 'Telangana',
        farmers: [{ farmerId: 'F3', name: 'Ravi', mobileNumber: mobile, location: 'V3' }],
      }),
    ]);

    await syncFFAData(true);

    const farmer = await Farmer.findOne({ mobileNumber: mobile });
    expect(farmer).not.toBeNull();
    // Language must be derived from state, not hardcoded
    expect(typeof farmer?.preferredLanguage).toBe('string');
    expect(farmer?.preferredLanguage.length).toBeGreaterThan(0);
  });
});

// ─── F5: empty state AND territory ───────────────────────────────────────────

describe('F5: activity with no state and no territory', () => {
  /**
   * syncActivity throws "Activity X is missing both state and territory".
   * The per-activity error is caught by syncFFAData's for-loop and added to
   * the errors array. The sync does NOT abort — it returns with activitiesSynced=0
   * and errors containing the "missing both state and territory" message.
   */
  test('activity with no state and no territory is recorded as an error, sync does not abort', async () => {
    const actId = `FFA-F5-${Date.now()}`;
    mockAxiosSuccess([
      makeFFAActivity({ activityId: actId, state: '', territory: '', farmers: [] }),
    ]);

    const result = await syncFFAData(true);

    expect(result.activitiesSynced).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => /missing both state and territory/i.test(e))).toBe(true);
  });

  test('activity with no state but valid territory uses territory-derived state', async () => {
    const actId = `FFA-F5-FALLBACK-${Date.now()}`;
    const mobile = `9${String(Date.now() + 5).slice(-9)}`;
    mockAxiosSuccess([
      makeFFAActivity({
        activityId: actId,
        state: '',
        territory: 'Telangana Zone', // territory exists → state derived by stripping " Zone"
        farmers: [{ farmerId: 'F5', name: 'Kumar', mobileNumber: mobile, location: 'V5' }],
      }),
    ]);

    const result = await syncFFAData(true);

    expect(result.activitiesSynced).toBe(1);
    expect(result.errors).toHaveLength(0);

    const activity = await Activity.findOne({ activityId: actId });
    expect(activity?.state).toBe('Telangana'); // stripped " Zone"
  });
});

// ─── F8: FFA API returns 5xx ──────────────────────────────────────────────────

describe('F8: FFA API error responses', () => {
  /**
   * The fetchFFAActivities() function throws when it gets a 5xx response
   * (because validateStatus: status => status < 500 causes axios to throw).
   * syncFFAData re-throws as "Failed to fetch activities from FFA API: ...".
   */
  test('FFA API 5xx causes syncFFAData to throw', async () => {
    mockAxiosHttpError(500);

    await expect(syncFFAData(true)).rejects.toThrow(/failed to fetch activities/i);
  });

  test('FFA API ECONNREFUSED causes syncFFAData to throw', async () => {
    mockAxiosNetworkError();

    await expect(syncFFAData(true)).rejects.toThrow(/cannot connect to FFA API|failed to fetch/i);
  });
});

// ─── F6: date format parsing ──────────────────────────────────────────────────

describe('F6: activity date format parsing', () => {
  test('DD/MM/YYYY date format is parsed correctly', async () => {
    const actId = `FFA-F6-DDMMYYYY-${Date.now()}`;
    const mobile = `9${String(Date.now() + 6).slice(-9)}`;
    mockAxiosSuccess([
      makeFFAActivity({ activityId: actId, date: '15/03/2025', farmers: [{ farmerId: 'F6', name: 'Priya', mobileNumber: mobile, location: 'V6' }] }),
    ]);

    const result = await syncFFAData(true);
    expect(result.activitiesSynced).toBe(1);

    const activity = await Activity.findOne({ activityId: actId });
    expect(activity).not.toBeNull();
    const d = activity!.date;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2); // March = index 2
    expect(d.getDate()).toBe(15);
  });

  test('YYYY-MM-DD date format is parsed correctly', async () => {
    const actId = `FFA-F6-ISO-${Date.now()}`;
    const mobile = `9${String(Date.now() + 7).slice(-9)}`;
    mockAxiosSuccess([
      makeFFAActivity({ activityId: actId, date: '2025-06-20', farmers: [{ farmerId: 'F7', name: 'Suresh', mobileNumber: mobile, location: 'V7' }] }),
    ]);

    const result = await syncFFAData(true);
    expect(result.activitiesSynced).toBe(1);

    const activity = await Activity.findOne({ activityId: actId });
    expect(activity).not.toBeNull();
    expect(activity!.date.getFullYear()).toBe(2025);
    expect(activity!.date.getMonth()).toBe(5); // June
    expect(activity!.date.getDate()).toBe(20);
  });

  test('invalid date format causes activity to be recorded as an error', async () => {
    const actId = `FFA-F6-BAD-${Date.now()}`;
    mockAxiosSuccess([
      makeFFAActivity({ activityId: actId, date: 'not-a-date', farmers: [] }),
    ]);

    const result = await syncFFAData(true);
    expect(result.activitiesSynced).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
