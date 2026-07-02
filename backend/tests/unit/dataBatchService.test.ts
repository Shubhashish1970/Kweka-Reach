import mongoose from 'mongoose';
import { Activity } from '../../src/models/Activity.js';
import { Farmer } from '../../src/models/Farmer.js';
import { SamplingAudit } from '../../src/models/SamplingAudit.js';
import { CallTask } from '../../src/models/CallTask.js';
import { deleteDataBatch, buildDataBatchExportRows } from '../../src/services/dataBatchService.js';
import { makeFarmer, makeActivity } from '../helpers/factories.js';

describe('dataBatchService.deleteDataBatch', () => {
  // ─── F10: happy path ────────────────────────────────────────────────────────
  test('F10: deletes activities in batch and only orphan farmers', async () => {
    const batchId = 'excel-import-test-happy';

    const f1 = await Farmer.create({ name: 'F1', mobileNumber: '9000000001', location: 'Loc', preferredLanguage: 'English', territory: 'T' });
    const f2 = await Farmer.create({ name: 'F2', mobileNumber: '9000000002', location: 'Loc', preferredLanguage: 'English', territory: 'T' });

    // Batch activity references f1 and f2
    const a1 = await Activity.create({
      activityId: 'A-BATCH-1',
      type: 'Field Day',
      date: new Date(),
      officerId: 'O1',
      officerName: 'Officer',
      location: 'Loc',
      territory: 'Terr',
      state: 'Telangana',
      farmerIds: [f1._id, f2._id],
      crops: [],
      products: [],
      syncedAt: new Date(),
      dataBatchId: batchId,
    });

    // Non-batch activity also references f2 (so f2 must NOT be deleted)
    await Activity.create({
      activityId: 'A-OTHER-1',
      type: 'Field Day',
      date: new Date(),
      officerId: 'O1',
      officerName: 'Officer',
      location: 'Loc',
      territory: 'Terr',
      state: 'Telangana',
      farmerIds: [f2._id],
      crops: [],
      products: [],
      syncedAt: new Date(),
      dataBatchId: 'sync-other',
    });

    const res = await deleteDataBatch(batchId);

    expect(res.deletedActivities).toBe(1);
    expect(res.deletedFarmers).toBe(1); // only f1 (f2 still referenced)

    expect(await Activity.findById(a1._id)).toBeNull();
    expect(await Farmer.findById(f1._id)).toBeNull();
    expect(await Farmer.findById(f2._id)).not.toBeNull();
  });

  // ─── F9: blocked when sampling audit exists ─────────────────────────────────
  test('F9: blocks delete when sampling audit exists for a batch activity', async () => {
    const batchId = 'excel-import-test-blocked';

    const f1 = await Farmer.create({ name: 'F1', mobileNumber: '9000000011', location: 'Loc', preferredLanguage: 'English', territory: 'T' });
    const a1 = await Activity.create({
      activityId: 'A-BLOCKED-1',
      type: 'Field Day',
      date: new Date(),
      officerId: 'O1',
      officerName: 'Officer',
      location: 'Loc',
      territory: 'Terr',
      state: 'Telangana',
      farmerIds: [f1._id],
      crops: [],
      products: [],
      syncedAt: new Date(),
      dataBatchId: batchId,
    });

    await SamplingAudit.create({
      activityId: a1._id as mongoose.Types.ObjectId,
      samplingPercentage: 10,
      totalFarmers: 1,
      sampledCount: 1,
      algorithm: 'Reservoir Sampling',
      metadata: {},
    });

    await expect(deleteDataBatch(batchId)).rejects.toThrow(/Sampling has run/i);
  });

  // ─── Blocked when call tasks exist ──────────────────────────────────────────
  test('blocks delete when call tasks exist for a batch activity', async () => {
    const batchId = 'excel-import-test-tasks';

    const f1 = await makeFarmer();
    const a1 = await makeActivity([f1._id], { dataBatchId: batchId });

    // Create a task for this activity
    await CallTask.create({
      farmerId: f1._id,
      activityId: a1._id,
      status: 'unassigned',
      scheduledDate: new Date(),
      isCallback: false,
      callbackNumber: 0,
      retryCount: 0,
      interactionHistory: [],
    });

    await expect(deleteDataBatch(batchId)).rejects.toThrow(/Call tasks exist/i);
  });

  // ─── Empty batch ─────────────────────────────────────────────────────────────
  test('throws when batchId has no activities', async () => {
    await expect(deleteDataBatch('nonexistent-batch-id')).rejects.toThrow(
      /No activities found/i
    );
  });

  // ─── Empty batchId ────────────────────────────────────────────────────────────
  test('throws when batchId is empty string', async () => {
    await expect(deleteDataBatch('')).rejects.toThrow(/batchId is required/i);
  });

  // ─── Multiple activities in one batch ────────────────────────────────────────
  test('deletes all activities in the batch in one call', async () => {
    const batchId = 'excel-import-multi';

    const f1 = await makeFarmer();
    const f2 = await makeFarmer();

    await makeActivity([f1._id], { dataBatchId: batchId, activityId: 'MULTI-A1' });
    await makeActivity([f2._id], { dataBatchId: batchId, activityId: 'MULTI-A2' });

    const res = await deleteDataBatch(batchId);

    expect(res.deletedActivities).toBe(2);
    expect(res.deletedFarmers).toBe(2);
  });
});

describe('dataBatchService.buildDataBatchExportRows', () => {
  test('returns API-shaped activity and farmer rows for a batch', async () => {
    const batchId = 'sync-export-test';

    const f1 = await Farmer.create({
      name: 'Ravi',
      mobileNumber: '9000000099',
      location: 'Village A',
      preferredLanguage: 'Kannada',
      territory: 'Mysore',
      photoUrl: 'https://example.com/photo.jpg',
    });

    await Activity.create({
      activityId: 'ACT-EXPORT-1',
      type: 'FieldVisit',
      date: new Date(2026, 5, 26),
      officerId: 'FDA-1',
      officerName: 'SASHANK M E',
      location: 'Mysore',
      territory: 'Mysore',
      territoryName: 'Mysore',
      zoneName: 'Hassan',
      buName: 'SBU',
      state: 'Karnataka',
      tmEmpCode: 'TM-1',
      tmName: 'TM One',
      farmerIds: [f1._id],
      crops: ['Rice', 'Wheat'],
      products: ['ATONIK'],
      syncedAt: new Date(),
      dataBatchId: batchId,
    });

    const { activities, farmers } = await buildDataBatchExportRows(batchId);

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      activityId: 'ACT-EXPORT-1',
      type: 'FieldVisit',
      date: '26/06/2026',
      officerId: 'FDA-1',
      officerName: 'SASHANK M E',
      state: 'Karnataka',
      zoneName: 'Hassan',
      crops: 'Rice,Wheat',
      products: 'ATONIK',
    });

    expect(farmers).toHaveLength(1);
    expect(farmers[0]).toMatchObject({
      activityId: 'ACT-EXPORT-1',
      name: 'Ravi',
      mobileNumber: '9000000099',
      location: 'Village A',
      photoUrl: 'https://example.com/photo.jpg',
    });
  });
});
