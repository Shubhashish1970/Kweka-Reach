import { describe, expect, test } from '@jest/globals';
import { CallTask } from '../../src/models/CallTask.js';
import { getNextVoiceTaskForAgent } from '../../src/services/taskService.js';
import {
  skipVoiceTaskMissingMobile,
  deferOrFinalizeVoiceNoResponse,
  releaseStuckVoiceTasks,
  handleVoiceWebhook,
  isFarmerMobileBlank,
} from '../../src/services/voiceAgentService.js';
import { makeAgent, makeActivity, makeFarmer, makeTask, makeTeamLead } from '../helpers/factories.js';

describe('isFarmerMobileBlank', () => {
  test('treats missing farmer, empty, and whitespace as blank', () => {
    expect(isFarmerMobileBlank(null)).toBe(true);
    expect(isFarmerMobileBlank({ mobileNumber: '' })).toBe(true);
    expect(isFarmerMobileBlank({ mobileNumber: '   ' })).toBe(true);
    expect(isFarmerMobileBlank({ mobileNumber: '9396792409' })).toBe(false);
  });
});

describe('skipVoiceTaskMissingMobile', () => {
  test('marks the task invalid_number so it leaves the queue', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, { status: 'sampled_in_queue' });

    await skipVoiceTaskMissingMobile(task._id.toString(), farmer.name);

    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('invalid_number');
    expect(updated?.callLog?.callStatus).toBe('Invalid');
    expect(updated?.interactionHistory.at(-1)?.notes).toMatch(/blank mobile/);
  });
});

describe('deferOrFinalizeVoiceNoResponse', () => {
  test('first hang disconnects and requeues for one later retry', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      voiceAttemptId: 'attempt-1',
    });

    const result = await deferOrFinalizeVoiceNoResponse(task, 'Voice call timed out');

    expect(result).toBe('deferred');
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('sampled_in_queue');
    expect(updated?.voiceHangRetryCount).toBe(1);
    expect(updated?.callLog == null).toBe(true);
    expect(updated?.callStartedAt).toBeNull();
  });

  test('hang after first counted try still requeues (retry remaining)', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      voiceHangRetryCount: 1,
      voiceAttemptId: 'attempt-1b',
    });

    const result = await deferOrFinalizeVoiceNoResponse(task, 'No answer');

    expect(result).toBe('deferred');
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('sampled_in_queue');
    expect(updated?.voiceHangRetryCount).toBe(1);
  });

  test('third attempt is blocked — hang at 2 tries marks not_reachable', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      voiceHangRetryCount: 2,
      voiceAttemptId: 'attempt-2',
    });

    const result = await deferOrFinalizeVoiceNoResponse(task, 'Voice call timed out');

    expect(result).toBe('finalized');
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('not_reachable');
    expect(updated?.callLog?.callStatus).toBe('No Answer');
    expect(updated?.interactionHistory.at(-1)?.notes).toMatch(/max 2 tries/);
  });
});

describe('getNextVoiceTaskForAgent hang retry order', () => {
  test('picks remaining first-pass tasks before hang retries', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmerA = await makeFarmer({ name: 'Deferred Farmer' });
    const farmerB = await makeFarmer({ name: 'Primary Farmer' });
    const activity = await makeActivity([farmerA._id, farmerB._id]);

    const earlier = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-08-01T00:00:00.000Z');

    await makeTask(farmerA._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
      scheduledDate: earlier,
      voiceHangRetryCount: 1,
    });
    const primary = await makeTask(farmerB._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
      scheduledDate: later,
      voiceHangRetryCount: 0,
    });

    const next = await getNextVoiceTaskForAgent(agent._id.toString());
    expect(next?._id.toString()).toBe(primary._id.toString());
  });

  test('picks hang retry after first-pass queue is empty', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const deferred = await makeTask(farmer._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
      voiceHangRetryCount: 1,
    });

    const next = await getNextVoiceTaskForAgent(agent._id.toString());
    expect(next?._id.toString()).toBe(deferred._id.toString());
  });

  test('does not pick a task that already used 2 tries', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    await makeTask(farmer._id, activity._id, {
      status: 'sampled_in_queue',
      assignedAgentId: agent._id,
      voiceHangRetryCount: 2,
    });

    const next = await getNextVoiceTaskForAgent(agent._id.toString());
    expect(next).toBeNull();
  });
});

describe('releaseStuckVoiceTasks', () => {
  test('first timeout requeues instead of closing the task', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      assignedAgentId: agent._id,
      voiceAttemptId: 'stuck-1',
      callStartedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const count = await releaseStuckVoiceTasks(agent._id.toString());
    expect(count).toBe(1);

    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('sampled_in_queue');
    expect(updated?.voiceHangRetryCount).toBe(1);
  });
});

describe('handleVoiceWebhook no-response retry', () => {
  test('first No Answer webhook requeues the task', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      assignedAgentId: agent._id,
      voiceAttemptId: 'wa-1',
    });

    const result = await handleVoiceWebhook({
      task_id: task._id.toString(),
      attempt_id: 'wa-1',
      call_status: 'No Answer',
    });

    expect(result.deferredRetry).toBe(true);
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('sampled_in_queue');
    expect(updated?.voiceHangRetryCount).toBe(1);
  });

  test('duplicate No Answer webhook after defer does not finalize', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      assignedAgentId: agent._id,
      voiceAttemptId: 'wa-2',
    });

    await handleVoiceWebhook({
      task_id: task._id.toString(),
      attempt_id: 'wa-2',
      call_status: 'No Answer',
    });
    const dup = await handleVoiceWebhook({
      task_id: task._id.toString(),
      attempt_id: 'wa-2',
      call_status: 'No Answer',
    });

    expect(dup.duplicate).toBe(true);
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('sampled_in_queue');
  });

  test('No Answer after 2 tries closes the task', async () => {
    const lead = await makeTeamLead();
    const agent = await makeAgent(lead._id);
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id, {
      status: 'in_progress',
      assignedAgentId: agent._id,
      voiceAttemptId: 'wa-3',
      voiceHangRetryCount: 2,
    });

    const result = await handleVoiceWebhook({
      task_id: task._id.toString(),
      attempt_id: 'wa-3',
      call_status: 'No Answer',
    });

    expect(result.deferredRetry).toBe(false);
    const updated = await CallTask.findById(task._id);
    expect(updated?.status).toBe('not_reachable');
  });
});
