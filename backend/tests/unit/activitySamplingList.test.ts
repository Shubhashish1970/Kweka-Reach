import mongoose from 'mongoose';
import { SamplingAudit } from '../../src/models/SamplingAudit.js';
import {
  getActivitiesWithSampling,
  getActivitiesSamplingExportRows,
} from '../../src/services/adminService.js';
import { makeFarmer, makeActivity } from '../helpers/factories.js';

describe('activity sampling list pagination', () => {
  test('sorts by date desc without lookup-before-sort and honors samplingStatus', async () => {
    const farmer = await makeFarmer();
    const oldest = await makeActivity([farmer._id], { date: new Date('2026-04-01T00:00:00.000Z') });
    const mid = await makeActivity([farmer._id], { date: new Date('2026-06-01T00:00:00.000Z') });
    const newest = await makeActivity([farmer._id], { date: new Date('2026-08-01T00:00:00.000Z') });

    await SamplingAudit.create({
      activityId: oldest._id as mongoose.Types.ObjectId,
      samplingPercentage: 10,
      totalFarmers: 1,
      sampledCount: 1,
      algorithm: 'Reservoir Sampling',
      metadata: {},
    });
    await SamplingAudit.create({
      activityId: mid._id as mongoose.Types.ObjectId,
      samplingPercentage: 10,
      totalFarmers: 1,
      sampledCount: 0,
      algorithm: 'Reservoir Sampling',
      metadata: {},
    });

    const page1 = await getActivitiesWithSampling({ page: 1, limit: 2 });
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.pages).toBe(2);
    expect(page1.activities.map((a) => String(a.activity._id))).toEqual([
      String(newest._id),
      String(mid._id),
    ]);

    const page2 = await getActivitiesWithSampling({ page: 2, limit: 2 });
    expect(page2.activities.map((a) => String(a.activity._id))).toEqual([String(oldest._id)]);

    const sampled = await getActivitiesWithSampling({ samplingStatus: 'sampled', limit: 50 });
    expect(sampled.pagination.total).toBe(1);
    expect(String(sampled.activities[0].activity._id)).toBe(String(oldest._id));

    const partial = await getActivitiesWithSampling({ samplingStatus: 'partial', limit: 50 });
    expect(partial.pagination.total).toBe(1);
    expect(String(partial.activities[0].activity._id)).toBe(String(mid._id));

    const notSampled = await getActivitiesWithSampling({ samplingStatus: 'not_sampled', limit: 50 });
    expect(notSampled.pagination.total).toBe(1);
    expect(String(notSampled.activities[0].activity._id)).toBe(String(newest._id));

    const exported = await getActivitiesSamplingExportRows({ limit: 5000 });
    expect(exported.map((r) => r.activityId)).toEqual([
      newest.activityId,
      mid.activityId,
      oldest.activityId,
    ]);
  });
});
