/**
 * Agent History stats + Load Tasks (/available) count consistency.
 *
 * Seeds tasks in every terminal/active queue status, sets updatedAt inside a fixed * calendar window, then:
 *  - GET /api/tasks/own/history/stats?dateFrom&dateTo — total = non-queue statuses only; inQueue separate
 *  - Raw Mongo counts for the same agent + date window + status must match API buckets
 *  - GET /api/tasks/available — row counts by status must sum to tasks.length (dialer modal)
 */

import request from 'supertest';
import mongoose from 'mongoose';
import app from '../helpers/testApp.js';
import { CallTask } from '../../src/models/CallTask.js';
import { makeFarmer, makeActivity, makeAgent, makeTeamLead, makeTask } from '../helpers/factories.js';

const login = async (email: string, password = 'Password1') => {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.data?.token as string;
};

/** Bypass Mongoose timestamps so stats date windows match exactly */
const setTaskUpdatedAt = async (taskId: mongoose.Types.ObjectId, updatedAt: Date) => {
  await CallTask.collection.updateOne({ _id: taskId }, { $set: { updatedAt } });
};

describe('Agent screens: history stats & available tasks counts', () => {
  test('History stats: total equals sum of buckets; matches Mongo for min–max date window (all statuses)', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id, { languageCapabilities: ['Hindi', 'English'] });
    const token = await login(agent.email);
    const agentOid = new mongoose.Types.ObjectId(agent._id.toString());

    const dateFrom = '2026-06-01';
    const dateTo = '2026-06-30';

    const mk = async (status: 'sampled_in_queue' | 'in_progress' | 'completed' | 'not_reachable' | 'invalid_number', iso: string) => {
      const day = new Date(iso);
      const farmer = await makeFarmer({ preferredLanguage: 'Hindi' });
      const activity = await makeActivity([farmer._id], { territory: 'Kakinada', type: 'Group Meeting' });
      const task = await makeTask(farmer._id, activity._id, {
        assignedAgentId: agent._id,
        status,
        scheduledDate: day,
      });
      await setTaskUpdatedAt(task._id, day);
      return task;
    };

    await mk('sampled_in_queue', '2026-06-02T10:00:00.000Z');
    await mk('sampled_in_queue', '2026-06-05T10:00:00.000Z');
    await mk('in_progress', '2026-06-08T10:00:00.000Z');
    await mk('completed', '2026-06-10T10:00:00.000Z');
    await mk('completed', '2026-06-11T10:00:00.000Z');
    await mk('completed', '2026-06-12T10:00:00.000Z');
    await mk('not_reachable', '2026-06-14T10:00:00.000Z');
    await mk('not_reachable', '2026-06-15T10:00:00.000Z');
    await mk('invalid_number', '2026-06-20T10:00:00.000Z');

    const res = await request(app)
      .get('/api/tasks/own/history/stats')
      .query({ dateFrom, dateTo })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    const nonQueueSum = d.inProgress + d.completedConversation + d.unsuccessful + d.invalid;
    expect(d.total).toBe(nonQueueSum);
    expect(d.inQueue).toBe(2);
    expect(d.inProgress).toBe(1);
    expect(d.completedConversation).toBe(3);
    expect(d.unsuccessful).toBe(2);
    expect(d.invalid).toBe(1);
    expect(d.total).toBe(7);
    expect(d.inQueue + d.total).toBe(9);

    // Same window as route: updatedAt primary branch (no callStartedAt on these tasks)
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    const inWin = { assignedAgentId: agentOid, updatedAt: { $gte: from, $lte: to } };

    const mongoInQueue = await CallTask.countDocuments({ ...inWin, status: 'sampled_in_queue' });
    const mongoProg = await CallTask.countDocuments({ ...inWin, status: 'in_progress' });
    const mongoDone = await CallTask.countDocuments({ ...inWin, status: 'completed' });
    const mongoNr = await CallTask.countDocuments({ ...inWin, status: 'not_reachable' });
    const mongoInv = await CallTask.countDocuments({ ...inWin, status: 'invalid_number' });

    expect(mongoInQueue).toBe(d.inQueue);
    expect(mongoProg).toBe(d.inProgress);
    expect(mongoDone).toBe(d.completedConversation);
    expect(mongoNr).toBe(d.unsuccessful);
    expect(mongoInv).toBe(d.invalid);
    expect(mongoProg + mongoDone + mongoNr + mongoInv).toBe(d.total);
    expect(mongoInQueue + mongoProg + mongoDone + mongoNr + mongoInv).toBe(d.inQueue + d.total);

    // Same totals when date window is derived from min/max updatedAt in DB (prod-style check)
    const bounds = await CallTask.aggregate([
      { $match: { assignedAgentId: agentOid } },
      { $group: { _id: null, minU: { $min: '$updatedAt' }, maxU: { $max: '$updatedAt' } } },
    ]);
    expect(bounds.length).toBe(1);
    const df = (bounds[0].minU as Date).toISOString().slice(0, 10);
    const dt = (bounds[0].maxU as Date).toISOString().slice(0, 10);
    const res2 = await request(app)
      .get('/api/tasks/own/history/stats')
      .query({ dateFrom: df, dateTo: dt })
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
    const d2 = res2.body.data;
    expect(d2.total).toBe(
      d2.inProgress + d2.completedConversation + d2.unsuccessful + d2.invalid
    );
    expect(d2.inQueue + d2.total).toBe(9);
  });

  test('Load Tasks (/available): counts by status sum to returned tasks (modal logic)', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id, { languageCapabilities: ['Hindi'] });
    const token = await login(agent.email);

    const mk = async (status: 'sampled_in_queue' | 'in_progress' | 'completed' | 'not_reachable' | 'invalid_number') => {
      const farmer = await makeFarmer({ preferredLanguage: 'Hindi' });
      const activity = await makeActivity([farmer._id]);
      await makeTask(farmer._id, activity._id, {
        assignedAgentId: agent._id,
        status,
        scheduledDate: new Date('2026-07-01T12:00:00.000Z'),
      });
    };

    await mk('sampled_in_queue');
    await mk('sampled_in_queue');
    await mk('in_progress');
    await mk('completed');
    await mk('not_reachable');
    await mk('invalid_number');

    const res = await request(app).get('/api/tasks/available/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.inProgress).toBe(1);
    expect(res.body.data.queue).toBe(2);
    expect(res.body.data.doneToday).toBe(3);

    const tabs = ['in_progress', 'queue', 'done'] as const;
    const all: any[] = [];
    for (const tab of tabs) {
      const pageRes = await request(app)
        .get(`/api/tasks/available?tab=${tab}&limit=100`)
        .set('Authorization', `Bearer ${token}`);
      expect(pageRes.status).toBe(200);
      all.push(...(pageRes.body.data?.tasks || []));
    }
    let inProgress = 0;
    let queue = 0;
    let doneTab = 0;
    for (const t of all) {
      const s = t.status;
      if (s === 'in_progress') inProgress++;
      else if (s === 'sampled_in_queue') queue++;
      else if (s === 'completed' || s === 'not_reachable' || s === 'invalid_number') doneTab++;
    }
    expect(inProgress + queue + doneTab).toBe(all.length);
    expect(all.length).toBe(6);
  });

  test('History filter options: distinct territories & activity types for agent (no cross-filter shrink)', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const farmer = await makeFarmer({ preferredLanguage: 'Hindi' });
    const activityA = await makeActivity([farmer._id], {
      territory: 'Zone A',
      territoryName: 'Zone A',
      type: 'Group Meeting',
    });
    const activityB = await makeActivity([farmer._id], {
      territory: 'Zone B',
      territoryName: 'Zone B',
      type: 'Field Day',
    });
    await makeTask(farmer._id, activityA._id, {
      assignedAgentId: agent._id,
      status: 'completed',
      scheduledDate: new Date('2026-08-01T12:00:00.000Z'),
    });
    await makeTask(farmer._id, activityB._id, {
      assignedAgentId: agent._id,
      status: 'completed',
      scheduledDate: new Date('2026-08-02T12:00:00.000Z'),
    });

    // No date params: all assigned tasks for agent (avoids TZ edge cases in test env)
    const res = await request(app).get('/api/tasks/own/history/options').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const terr = res.body.data?.territoryOptions || [];
    const types = res.body.data?.activityTypeOptions || [];
    expect(terr).toContain('Zone A');
    expect(terr).toContain('Zone B');
    expect(types).toContain('Group Meeting');
    expect(types).toContain('Field Day');
  });
});
