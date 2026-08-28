/**
 * Integration tests for /api/tasks endpoints.
 *
 * Covers: task state machine, submit outcomes, mark-in-progress guard,
 * invalid_number reassignment, and unauthenticated access.
 */

import request from 'supertest';
import app from '../helpers/testApp.js';
import { CallTask } from '../../src/models/CallTask.js';
import { Activity } from '../../src/models/Activity.js';
import { makeFarmer, makeActivity, makeAdmin, makeAgent, makeTeamLead, makeTask } from '../helpers/factories.js';

// ─── Auth helper ─────────────────────────────────────────────────────────────

const login = async (email: string, password = 'Password1') => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  return res.body.data?.token as string;
};

// ─── T0: unauthenticated access ───────────────────────────────────────────────

describe('T0: unauthenticated task access', () => {
  test('GET /api/tasks without token returns 401', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  test('POST /api/tasks/:id/submit without token returns 401', async () => {
    const res = await request(app)
      .post('/api/tasks/some-id/submit')
      .send({ callStatus: 'Connected' });
    expect(res.status).toBe(401);
  });
});

// ─── T1: task submission outcomes ────────────────────────────────────────────

describe('T1: submit sets correct final status', () => {
  let agentToken: string;
  let taskId: string;

  const setupTask = async (callStatus: string) => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    agentToken = await login(agent.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
    });
    taskId = task._id.toString();
    return { agent, task };
  };

  test('callStatus "Connected" → task status "completed"', async () => {
    await setupTask('Connected');

    const res = await request(app)
      .post(`/api/tasks/${taskId}/submit`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ callStatus: 'Connected', sentiment: 'Positive' });

    expect(res.status).toBe(200);
    const updated = await CallTask.findById(taskId);
    expect(updated?.status).toBe('completed');
  });

  test('callStatus "No Answer" → task status "not_reachable"', async () => {
    await setupTask('No Answer');

    const res = await request(app)
      .post(`/api/tasks/${taskId}/submit`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ callStatus: 'No Answer' });

    expect(res.status).toBe(200);
    const updated = await CallTask.findById(taskId);
    expect(updated?.status).toBe('not_reachable');
  });

  test('callStatus "Invalid Number" → task status "invalid_number"', async () => {
    await setupTask('Invalid Number');

    const res = await request(app)
      .post(`/api/tasks/${taskId}/submit`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ callStatus: 'Invalid Number' });

    expect(res.status).toBe(200);
    const updated = await CallTask.findById(taskId);
    expect(updated?.status).toBe('invalid_number');
  });

  test('invalid callStatus value returns 400', async () => {
    await setupTask('Bad');

    const res = await request(app)
      .post(`/api/tasks/${taskId}/submit`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ callStatus: 'BadValue' });

    expect(res.status).toBe(400);
  });
});

// ─── T4: follow-up from History — terminal tasks can re-enter in_progress ────

describe('T4: follow-up mark-in-progress from terminal status', () => {
  test('mark-in-progress on completed task moves to in_progress', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'completed',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .post(`/api/tasks/${task._id}/mark-in-progress`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('in_progress');
  });
});

// ─── T5: invalid_number task reassignment ────────────────────────────────────

describe('T5: terminal task reassignment is blocked', () => {
  test('reassigning an invalid_number task returns 400', async () => {
    const admin = await makeAdmin();
    const adminToken = await login(admin.email);

    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'invalid_number',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .put(`/api/tasks/${task._id}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agent._id.toString() });

    expect(res.status).toBe(400);
  });

  test('reassigning a completed task returns 400', async () => {
    const admin = await makeAdmin();
    const adminToken = await login(admin.email);
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'completed',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .put(`/api/tasks/${task._id}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agent._id.toString() });

    expect(res.status).toBe(400);
  });

  test('reassigning a not_reachable task returns 400', async () => {
    const admin = await makeAdmin();
    const adminToken = await login(admin.email);
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'not_reachable',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .put(`/api/tasks/${task._id}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agent._id.toString() });

    expect(res.status).toBe(400);
  });

  test('reassigning an unassigned task succeeds', async () => {
    const admin = await makeAdmin();
    const adminToken = await login(admin.email);

    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'unassigned',
    });

    const res = await request(app)
      .put(`/api/tasks/${task._id}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agent._id.toString() });

    expect(res.status).toBe(200);
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('sampled_in_queue');
  });
});

// ─── T6: mark-in-progress state machine ──────────────────────────────────────

describe('T6: mark-in-progress transitions sampled_in_queue → in_progress', () => {
  test('sampled_in_queue task transitions to in_progress on mark-in-progress', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .post(`/api/tasks/${task._id}/mark-in-progress`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('in_progress');
  });

  test('mark-in-progress sets callStartedAt timestamp', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
    });

    await request(app)
      .post(`/api/tasks/${task._id}/mark-in-progress`)
      .set('Authorization', `Bearer ${token}`);

    const updated = await CallTask.findById(task._id);
    expect((updated as any).callStartedAt).toBeDefined();
  });
});

// ─── T7: agent cannot submit another agent's task ────────────────────────────

describe('T7: agent isolation', () => {
  test('agent cannot submit a task assigned to another agent', async () => {
    const teamLead = await makeTeamLead();
    const agent1 = await makeAgent(teamLead._id);
    const agent2 = await makeAgent(teamLead._id);
    const token2 = await login(agent2.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent1._id, // assigned to agent1, not agent2
    });

    const res = await request(app)
      .post(`/api/tasks/${task._id}/submit`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ callStatus: 'Connected' });

    expect(res.status).toBe(403);
  });
});

// ─── T8: non-existent task returns 404 ───────────────────────────────────────

describe('T8: non-existent task', () => {
  test('loading a non-existent task returns 404', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const fakeId = new (await import('mongoose')).default.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/tasks/${fakeId}/load`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ─── T9: resume task from History (load after prior submission) ──────────────

describe('T9: agent can load terminal tasks for follow-up', () => {
  test('POST load succeeds for not_reachable task assigned to agent', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'not_reachable',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .post(`/api/tasks/${task._id}/load`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(String(res.body.data.taskId)).toBe(task._id.toString());
  });

  test('POST load succeeds for completed task assigned to agent', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'completed',
      assignedAgentId: agent._id,
    });

    const res = await request(app)
      .post(`/api/tasks/${task._id}/load`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── T10: bulk cancel ────────────────────────────────────────────────────────

describe('T10: bulk cancel tasks', () => {
  test('cancels sampled_in_queue tasks by agentId and skips in_progress', async () => {
    const teamLead = await makeTeamLead();
    const teamLeadToken = await login(teamLead.email);
    const agent = await makeAgent(teamLead._id);
    const farmer1 = await makeFarmer();
    const farmer2 = await makeFarmer();
    const activity1 = await makeActivity([farmer1._id]);
    const activity2 = await makeActivity([farmer2._id]);

    const queued = await makeTask(farmer1._id, activity1._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
    });
    const inProgress = await makeTask(farmer2._id, activity2._id, {
      status: 'in_progress',
      assignedAgentId: agent._id,
    });

    const preview = await request(app)
      .get(`/api/tasks/bulk/cancel-preview?agentId=${agent._id}`)
      .set('Authorization', `Bearer ${teamLeadToken}`);

    expect(preview.status).toBe(200);
    expect(preview.body.data.tasksToCancel).toBe(1);
    expect(preview.body.data.tasksSkippedInProgress).toBe(1);

    const res = await request(app)
      .put('/api/tasks/bulk/cancel')
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ agentId: agent._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(1);

    const updatedQueued = await CallTask.findById(queued._id);
    const updatedInProgress = await CallTask.findById(inProgress._id);
    expect(updatedQueued?.status).toBe('cancelled');
    expect(updatedInProgress?.status).toBe('in_progress');
  });

  test('team lead cannot cancel tasks for agent outside their team', async () => {
    const teamLead = await makeTeamLead();
    const otherTeamLead = await makeTeamLead();
    const teamLeadToken = await login(teamLead.email);
    const outsiderAgent = await makeAgent(otherTeamLead._id);

    const res = await request(app)
      .put('/api/tasks/bulk/cancel')
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ agentId: outsiderAgent._id.toString() });

    expect(res.status).toBe(403);
  });

  test('supersedes active activities in date range when requested', async () => {
    const admin = await makeAdmin();
    const adminToken = await login(admin.email);
    const farmer = await makeFarmer();
    const inRangeDate = new Date('2026-01-15T12:00:00.000Z');

    const activeActivity = await makeActivity([farmer._id], {
      date: inRangeDate,
      lifecycleStatus: 'active',
    });
    const sampledActivity = await makeActivity([farmer._id], {
      date: inRangeDate,
      lifecycleStatus: 'sampled',
    });

    const res = await request(app)
      .put('/api/tasks/bulk/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        taskIds: [],
        agentId: undefined,
        supersedeActivities: true,
        activityDateFrom: '2026-01-01',
        activityDateTo: '2026-01-31',
      });

    expect(res.status).toBe(400);

    const queuedTask = await makeTask(farmer._id, activeActivity._id, {
      status: 'sampled_in_queue',
    });

    const cancelRes = await request(app)
      .put('/api/tasks/bulk/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        taskIds: [queuedTask._id.toString()],
        supersedeActivities: true,
        activityDateFrom: '2026-01-01',
        activityDateTo: '2026-01-31',
      });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.supersededActivities).toBe(1);

    const updatedActive = await Activity.findById(activeActivity._id);
    const updatedSampled = await Activity.findById(sampledActivity._id);
    expect(updatedActive?.lifecycleStatus).toBe('superseded');
    expect(updatedSampled?.lifecycleStatus).toBe('sampled');
  });
});
