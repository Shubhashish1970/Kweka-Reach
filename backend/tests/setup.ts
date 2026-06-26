import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MasterLanguage } from '../src/models/MasterData.js';

const TEST_MASTER_LANGUAGES = [
  { name: 'Hindi', code: 'HI', displayOrder: 1, isActive: true },
  { name: 'Telugu', code: 'TE', displayOrder: 2, isActive: true },
  { name: 'Marathi', code: 'MR', displayOrder: 3, isActive: true },
  { name: 'Kannada', code: 'KN', displayOrder: 4, isActive: true },
  { name: 'Tamil', code: 'TA', displayOrder: 5, isActive: true },
  { name: 'Bengali', code: 'BN', displayOrder: 6, isActive: true },
  { name: 'Oriya', code: 'OR', displayOrder: 7, isActive: true },
  { name: 'English', code: 'EN', displayOrder: 8, isActive: true },
  { name: 'Malayalam', code: 'ML', displayOrder: 9, isActive: true },
];

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

  await MasterLanguage.insertMany(TEST_MASTER_LANGUAGES);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  mongo = null;
});

