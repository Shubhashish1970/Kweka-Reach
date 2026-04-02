import { sampleAndCreateTasks } from '../../src/services/samplingService.js';
import { Activity } from '../../src/models/Activity.js';
import { CallTask } from '../../src/models/CallTask.js';
import { SamplingAudit } from '../../src/models/SamplingAudit.js';
import { SamplingConfig } from '../../src/models/SamplingConfig.js';
import {
  makeFarmer,
  makeFarmers,
  makeActivity,
  putInCooling,
} from '../helpers/factories.js';

// Helper: reset SamplingConfig to defaults before each test
const resetConfig = () =>
  SamplingConfig.findOneAndUpdate(
    { key: 'default' },
    {
      isActive: true,
      activityCoolingDays: 5,
      farmerCoolingDays: 30,
      defaultPercentage: 10,
      eligibleActivityTypes: [], // empty = all eligible
      taskDueInDays: 0,
    },
    { upsert: true, new: true }
  );

beforeEach(async () => {
  await resetConfig();
});

// ─── Basic sampling math ──────────────────────────────────────────────────────

describe('S1: basic sampling math', () => {
  test('10% of 100 farmers produces 10 tasks', async () => {
    const farmers = await makeFarmers(100);
    const activity = await makeActivity(farmers.map((f) => f._id));

    const result = await sampleAndCreateTasks(activity._id.toString(), 10, {
      forceRun: true,
    });

    expect(result.skipped).toBeUndefined();
    expect(result.sampledCount).toBe(10);
    expect(result.tasksCreated).toBe(10);
  });

  test('50% of 6 farmers produces 3 tasks', async () => {
    const farmers = await makeFarmers(6);
    const activity = await makeActivity(farmers.map((f) => f._id));

    const result = await sampleAndCreateTasks(activity._id.toString(), 50, {
      forceRun: true,
    });

    expect(result.sampledCount).toBe(3);
    expect(result.tasksCreated).toBe(3);
  });
});

// ─── Min / max caps ──────────────────────────────────────────────────────────

describe('S2: minFarmersToSample', () => {
  test('min:5 on activity with 3 eligible farmers creates 3 tasks (not 5)', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id));

    const result = await sampleAndCreateTasks(activity._id.toString(), 10, {
      forceRun: true,
      minFarmersToSample: 5,
    });

    expect(result.tasksCreated).toBe(3);
    expect(result.sampledCount).toBe(3);
  });
});

describe('S3: maxFarmersToSample', () => {
  test('max:3 on activity with 20 farmers creates exactly 3 tasks', async () => {
    const farmers = await makeFarmers(20);
    const activity = await makeActivity(farmers.map((f) => f._id));

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
      maxFarmersToSample: 3,
    });

    expect(result.tasksCreated).toBe(3);
    expect(result.sampledCount).toBe(3);
  });
});

describe('S4 (Bug #1): min > max conflict', () => {
  /**
   * Current behaviour (Bug #1):
   *   sampleSize = Math.max(calcSize, Math.min(min, eligible))
   *   then         = Math.min(sampleSize, max)
   * When min(15) > max(3), the Math.max in line 234 can produce sampleSize > max.
   * This test captures the expected CORRECT behaviour (max should always win).
   * It will FAIL until the bug is fixed — that's intentional.
   */
  test('max should win over min — tasksCreated must not exceed max', async () => {
    const farmers = await makeFarmers(20);
    const activity = await makeActivity(farmers.map((f) => f._id));

    const result = await sampleAndCreateTasks(activity._id.toString(), 10, {
      forceRun: true,
      minFarmersToSample: 15,
      maxFarmersToSample: 3,
    });

    expect(result.tasksCreated).toBeLessThanOrEqual(3);
  });
});

// ─── Cooling period ──────────────────────────────────────────────────────────

describe('S5: farmer cooling period', () => {
  test('farmer called 1 day ago is excluded (within 30-day window)', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    await putInCooling(farmer._id, 1); // called yesterday

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.eligibleFarmers).toBe(0);
    expect(result.sampledCount).toBe(0);
  });

  test('farmer called 31 days ago is eligible (cooling expired)', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    await putInCooling(farmer._id, 31); // called 31 days ago

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.eligibleFarmers).toBe(1);
    expect(result.sampledCount).toBe(1);
  });
});

describe('S6: lifecycle transition to inactive', () => {
  test('activity with all farmers in cooling transitions to inactive', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id));

    for (const f of farmers) {
      await putInCooling(f._id, 1);
    }

    await sampleAndCreateTasks(activity._id.toString(), 100, { forceRun: true });

    const updated = await Activity.findById(activity._id);
    expect(updated?.lifecycleStatus).toBe('inactive');
  });

  test('activity with at least one sampled farmer transitions to sampled', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id));

    // Only put 2 of 3 in cooling — 1 remains eligible
    await putInCooling(farmers[0]._id, 1);
    await putInCooling(farmers[1]._id, 1);

    await sampleAndCreateTasks(activity._id.toString(), 100, { forceRun: true });

    const updated = await Activity.findById(activity._id);
    expect(updated?.lifecycleStatus).toBe('sampled');
  });
});

// ─── Ad-hoc vs first-sample ───────────────────────────────────────────────────

describe('S7: ad-hoc run skips already-sampled farmers', () => {
  test('ad-hoc does not create duplicate tasks for farmers sampled in first run', async () => {
    const farmers = await makeFarmers(5);
    const activity = await makeActivity(farmers.map((f) => f._id));

    // First-sample run: sample all 5
    await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
      setFirstSampleRun: true,
    });
    const countAfterFirst = await CallTask.countDocuments({ activityId: activity._id });

    // Reset lifecycle to sampled so ad-hoc can run
    await Activity.findByIdAndUpdate(activity._id, { lifecycleStatus: 'sampled' });

    // Ad-hoc run — should find 0 eligible (all already sampled)
    const adHocResult = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
      setFirstSampleRun: false,
    });

    const countAfterAdhoc = await CallTask.countDocuments({ activityId: activity._id });

    expect(adHocResult.sampledCount).toBe(0);
    expect(countAfterAdhoc).toBe(countAfterFirst);
  });
});

describe('S8: first-sample run flag', () => {
  test('sets activity.firstSampleRun to true and records firstSampledAt', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id));

    await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
      setFirstSampleRun: true,
    });

    const updated = await Activity.findById(activity._id);
    expect(updated?.firstSampleRun).toBe(true);
    expect(updated?.firstSampledAt).toBeDefined();
  });

  test('ad-hoc run does NOT set firstSampleRun', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id));

    await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
      setFirstSampleRun: false, // adhoc
    });

    const updated = await Activity.findById(activity._id);
    expect(updated?.firstSampleRun).toBeFalsy();
  });
});

// ─── Lifecycle eligibility ────────────────────────────────────────────────────

describe('S9: inactive activities are skipped', () => {
  test('activity with lifecycleStatus inactive is skipped', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id), {
      lifecycleStatus: 'inactive',
    });

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.skipped).toBe(true);
    expect(result.tasksCreated).toBe(0);
  });

  test('not_eligible activity is also skipped', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id), {
      lifecycleStatus: 'not_eligible',
    });

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.skipped).toBe(true);
  });
});

describe('S10: activity type eligibility is NOT bypassed by forceRun', () => {
  test('OFM type excluded when only Group Meeting is eligible', async () => {
    await SamplingConfig.findOneAndUpdate(
      { key: 'default' },
      { eligibleActivityTypes: ['Group Meeting'] },
      { upsert: true }
    );

    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id), { type: 'OFM' });

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/not eligible/i);
    expect(result.tasksCreated).toBe(0);
  });

  test('when eligibleActivityTypes is empty, all types are eligible', async () => {
    await SamplingConfig.findOneAndUpdate(
      { key: 'default' },
      { eligibleActivityTypes: [] },
      { upsert: true }
    );

    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id), { type: 'OFM' });

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.skipped).toBeUndefined();
    expect(result.tasksCreated).toBeGreaterThan(0);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('S11: activity with zero farmers', () => {
  test('returns structured result without error or hanging', async () => {
    const activity = await makeActivity([]);

    const result = await sampleAndCreateTasks(activity._id.toString(), 10, {
      forceRun: true,
    });

    expect(result.totalFarmers).toBe(0);
    expect(result.sampledCount).toBe(0);
    expect(result.tasksCreated).toBe(0);
  });
});

describe('S12: sampling audit', () => {
  test('a SamplingAudit record is created/upserted for the activity', async () => {
    const farmers = await makeFarmers(5);
    const activity = await makeActivity(farmers.map((f) => f._id));

    await sampleAndCreateTasks(activity._id.toString(), 100, { forceRun: true });

    const audit = await SamplingAudit.findOne({ activityId: activity._id });
    expect(audit).not.toBeNull();
    expect(audit!.sampledCount).toBeGreaterThan(0);
    expect(audit!.totalFarmers).toBe(5);
  });

  test('re-sampling the same activity upserts the audit (no duplicate)', async () => {
    const farmers = await makeFarmers(5);
    const activity = await makeActivity(farmers.map((f) => f._id));

    await sampleAndCreateTasks(activity._id.toString(), 50, { forceRun: true });
    await Activity.findByIdAndUpdate(activity._id, { lifecycleStatus: 'active' });
    await sampleAndCreateTasks(activity._id.toString(), 50, { forceRun: true });

    const auditCount = await SamplingAudit.countDocuments({ activityId: activity._id });
    expect(auditCount).toBe(1);
  });
});

describe('S15: activity cooling gate', () => {
  test('activity dated today is skipped without forceRun', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id), {
      date: new Date(), // today — inside default 5-day activityCoolingDays
    });

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/activityCoolingDays/i);
  });

  test('forceRun bypasses the activity cooling gate', async () => {
    const farmers = await makeFarmers(3);
    const activity = await makeActivity(farmers.map((f) => f._id), {
      date: new Date(),
    });

    const result = await sampleAndCreateTasks(activity._id.toString(), 100, {
      forceRun: true,
    });

    expect(result.skipped).toBeUndefined();
    expect(result.tasksCreated).toBeGreaterThan(0);
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('idempotency: running sampling twice on same activity', () => {
  test('does not create duplicate tasks', async () => {
    const farmers = await makeFarmers(5);
    const activity = await makeActivity(farmers.map((f) => f._id));

    await sampleAndCreateTasks(activity._id.toString(), 100, { forceRun: true });
    const countAfterFirst = await CallTask.countDocuments({ activityId: activity._id });

    // Reset lifecycle so second run is eligible
    await Activity.findByIdAndUpdate(activity._id, { lifecycleStatus: 'active' });

    await sampleAndCreateTasks(activity._id.toString(), 100, { forceRun: true });
    const countAfterSecond = await CallTask.countDocuments({ activityId: activity._id });

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  test('all created tasks start as unassigned', async () => {
    const farmers = await makeFarmers(5);
    const activity = await makeActivity(farmers.map((f) => f._id));

    await sampleAndCreateTasks(activity._id.toString(), 100, { forceRun: true });

    const tasks = await CallTask.find({ activityId: activity._id });
    for (const task of tasks) {
      expect(task.status).toBe('unassigned');
    }
  });
});

describe('throws for non-existent activity', () => {
  test('rejects with error when activityId does not exist', async () => {
    const fakeId = new (await import('mongoose')).default.Types.ObjectId().toString();
    await expect(
      sampleAndCreateTasks(fakeId, 10, { forceRun: true })
    ).rejects.toThrow(/not found/i);
  });
});
