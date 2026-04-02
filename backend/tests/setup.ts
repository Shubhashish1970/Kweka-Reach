import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer | null = null;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  await mongoose.connect(uri);
  // Ensure all schema indexes (including unique constraints) are created
  // before any test runs, so unique-index tests work reliably.
  await mongoose.syncIndexes();
});

beforeEach(async () => {
  // Clear all collections between tests.
  if (!mongoose.connection.db) return;
  const collections = await mongoose.connection.db.collections();
  for (const c of collections) {
    // eslint-disable-next-line no-await-in-loop
    await c.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  mongo = null;
});

