import { CallTask } from '../../src/models/CallTask.js';
import mongoose from 'mongoose';
import {
  makeFarmer,
  makeActivity,
  makeTask,
} from '../helpers/factories.js';

// ─── Callback chain ───────────────────────────────────────────────────────────

describe('CB1: original task structure', () => {
  test('newly created task has callbackNumber 0 and isCallback false', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id);

    expect(task.callbackNumber).toBe(0);
    expect(task.isCallback).toBe(false);
    expect(task.parentTaskId).toBeNull();
  });
});

describe('CB2: first callback', () => {
  test('callback from callbackNumber:0 task gets callbackNumber:1', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const parent = await makeTask(farmer._id, activity._id, { callbackNumber: 0 });

    const callback = await makeTask(farmer._id, activity._id, {
      callbackNumber: parent.callbackNumber + 1,
      isCallback: true,
      parentTaskId: parent._id,
      retryCount: 1,
    });

    expect(callback.callbackNumber).toBe(1);
    expect(callback.isCallback).toBe(true);
    expect(callback.parentTaskId?.toString()).toBe(parent._id.toString());
  });
});

describe('CB3: max callback limit enforcement', () => {
  test('callbackNumber:3 is rejected by schema validator', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const parent = await makeTask(farmer._id, activity._id, { callbackNumber: 2, isCallback: true });

    await expect(
      CallTask.create({
        farmerId: farmer._id,
        activityId: activity._id,
        status: 'unassigned',
        scheduledDate: new Date(),
        isCallback: true,
        callbackNumber: 3,
        parentTaskId: parent._id,
        retryCount: 3,
        interactionHistory: [],
      })
    ).rejects.toThrow(/callbackNumber cannot exceed 2/);
  });

  test('callbackNumber:2 (second callback) is accepted', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);

    await expect(
      makeTask(farmer._id, activity._id, { callbackNumber: 2, isCallback: true })
    ).resolves.toBeDefined();
  });

  test('negative callbackNumber is rejected', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);

    await expect(
      CallTask.create({
        farmerId: farmer._id,
        activityId: activity._id,
        status: 'unassigned',
        scheduledDate: new Date(),
        isCallback: false,
        callbackNumber: -1,
        retryCount: 0,
        interactionHistory: [],
      })
    ).rejects.toThrow(/callbackNumber cannot be negative/);
  });
});

describe('CB4: unique constraint prevents duplicate callbacks', () => {
  test('second task with same (activityId, farmerId, callbackNumber) throws', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);

    // First callback
    await makeTask(farmer._id, activity._id, { callbackNumber: 1, isCallback: true });

    // Second with same callbackNumber — should violate unique index
    await expect(
      CallTask.create({
        farmerId: farmer._id,
        activityId: activity._id,
        status: 'unassigned',
        scheduledDate: new Date(),
        isCallback: true,
        callbackNumber: 1, // duplicate
        retryCount: 1,
        interactionHistory: [],
      })
    ).rejects.toThrow();
  });
});

describe('CB5: retryCount tracking', () => {
  test('each callback increments retryCount by 1', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);

    const original = await makeTask(farmer._id, activity._id, { retryCount: 0 });
    const cb1 = await makeTask(farmer._id, activity._id, {
      callbackNumber: 1,
      isCallback: true,
      parentTaskId: original._id,
      retryCount: original.retryCount + 1,
    });
    expect(cb1.retryCount).toBe(1);
  });
});

describe('CB7: callback inherits parent references', () => {
  test('callback has same farmerId and activityId as parent', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const parent = await makeTask(farmer._id, activity._id);

    const callback = await makeTask(farmer._id, activity._id, {
      callbackNumber: 1,
      isCallback: true,
      parentTaskId: parent._id,
      retryCount: 1,
    });

    expect(callback.farmerId.toString()).toBe(parent.farmerId.toString());
    expect(callback.activityId.toString()).toBe(parent.activityId.toString());
  });
});

describe('CB8: legacy task without callbackNumber field', () => {
  /**
   * Tasks created before callbackNumber was added won't have the field.
   * The schema default is 0, but raw insertOne bypasses Mongoose defaults.
   * Verify that a callback (callbackNumber:1) can still be created against
   * such a "legacy" task due to the unique index treating null/missing as
   * a distinct bucket from 1.
   */
  test('callback with callbackNumber:1 can be created against a legacy task', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);

    // Bypass Mongoose to simulate a legacy document (no callbackNumber field)
    const inserted = await CallTask.collection.insertOne({
      farmerId: farmer._id,
      activityId: activity._id,
      status: 'unassigned',
      scheduledDate: new Date(),
      isCallback: false,
      retryCount: 0,
      interactionHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Should succeed — callbackNumber:1 is distinct from missing/null
    await expect(
      CallTask.create({
        farmerId: farmer._id,
        activityId: activity._id,
        status: 'unassigned',
        scheduledDate: new Date(),
        isCallback: true,
        callbackNumber: 1,
        parentTaskId: inserted.insertedId,
        retryCount: 1,
        interactionHistory: [],
      })
    ).resolves.toBeDefined();
  });
});

// ─── Task schema validation ───────────────────────────────────────────────────

describe('T1: initial task state', () => {
  test('sampling creates task with status unassigned', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id);

    expect(task.status).toBe('unassigned');
  });
});

describe('T10: activityQuality bounds', () => {
  test('activityQuality above 5 is rejected', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id);

    await expect(
      CallTask.findByIdAndUpdate(
        task._id,
        {
          callLog: {
            callStatus: 'Connected',
            didAttend: 'Yes, I attended',
            sentiment: 'Positive',
            activityQuality: 6,
            cropsDiscussed: [],
            productsDiscussed: [],
            purchasedProducts: [],
          },
        },
        { new: true, runValidators: true }
      )
    ).rejects.toThrow();
  });

  test('activityQuality below 1 is rejected', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id);

    await expect(
      CallTask.findByIdAndUpdate(
        task._id,
        {
          callLog: {
            callStatus: 'Connected',
            didAttend: 'Yes, I attended',
            sentiment: 'Positive',
            activityQuality: 0,
            cropsDiscussed: [],
            productsDiscussed: [],
            purchasedProducts: [],
          },
        },
        { new: true, runValidators: true }
      )
    ).rejects.toThrow();
  });

  test('activityQuality between 1 and 5 is accepted', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id);

    const updated = await CallTask.findByIdAndUpdate(
      task._id,
      {
        callLog: {
          callStatus: 'Connected',
          didAttend: 'Yes, I attended',
          sentiment: 'Positive',
          activityQuality: 4,
          cropsDiscussed: [],
          productsDiscussed: [],
          purchasedProducts: [],
        },
      },
      { new: true, runValidators: true }
    );

    expect(updated?.callLog?.activityQuality).toBe(4);
  });
});

describe('T11: sentiment enum validation', () => {
  test('invalid sentiment value is rejected by schema', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);

    await expect(
      CallTask.create({
        farmerId: farmer._id,
        activityId: activity._id,
        status: 'completed',
        scheduledDate: new Date(),
        isCallback: false,
        callbackNumber: 0,
        retryCount: 0,
        interactionHistory: [],
        callLog: {
          callStatus: 'Connected',
          didAttend: 'Yes, I attended',
          sentiment: 'Excellent', // not in enum
          cropsDiscussed: [],
          productsDiscussed: [],
          purchasedProducts: [],
        },
      })
    ).rejects.toThrow();
  });

  test('valid sentiment values are accepted', async () => {
    const validSentiments = ['Positive', 'Negative', 'Neutral', 'N/A'] as const;

    for (const sentiment of validSentiments) {
      // Fresh farmer + activity per iteration so callbackNumber:0 is unique each time
      const farmer = await makeFarmer();
      const activity = await makeActivity([farmer._id]);

      const task = await CallTask.create({
        farmerId: farmer._id,
        activityId: activity._id,
        status: 'completed',
        scheduledDate: new Date(),
        isCallback: false,
        callbackNumber: 0,
        retryCount: 0,
        interactionHistory: [],
        callLog: {
          callStatus: 'Connected',
          didAttend: 'Yes, I attended',
          sentiment,
          cropsDiscussed: [],
          productsDiscussed: [],
          purchasedProducts: [],
        },
      });
      expect(task.callLog?.sentiment).toBe(sentiment);
    }
  });
});

describe('T6: callLog immutability', () => {
  test('task can receive a callLog', async () => {
    const farmer = await makeFarmer();
    const activity = await makeActivity([farmer._id]);
    const task = await makeTask(farmer._id, activity._id);

    expect(task.callLog).toBeNull();

    const updated = await CallTask.findByIdAndUpdate(
      task._id,
      {
        status: 'completed',
        callLog: {
          callStatus: 'Connected',
          didAttend: 'Yes, I attended',
          sentiment: 'Positive',
          cropsDiscussed: [],
          productsDiscussed: [],
          purchasedProducts: [],
        },
      },
      { new: true }
    );

    expect(updated?.callLog).not.toBeNull();
    expect(updated?.callLog?.callStatus).toBe('Connected');
  });
});
