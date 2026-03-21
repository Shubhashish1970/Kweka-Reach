import { MongoClient } from 'mongodb';

type CollectionInfo = {
  name: string;
  type?: string;
  options?: Record<string, any>;
};

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v == null) return defaultValue;
  return v.toLowerCase() === 'true';
}

function envInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v == null) return defaultValue;
  const parsed = Number(v);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid ${name}: ${v}`);
  return Math.floor(parsed);
}

async function main() {
  const SRC_URI = mustGetEnv('SRC_URI');
  const SRC_DB = mustGetEnv('SRC_DB');
  const TGT_URI = mustGetEnv('TGT_URI');
  const TGT_DB = mustGetEnv('TGT_DB');

  const BATCH_SIZE = envInt('BATCH_SIZE', 1000);
  const DROP_DEST_COLLECTIONS = envBool('DROP_DEST_COLLECTIONS', false);
  const SKIP_SYSTEM_COLLECTIONS = envBool('SKIP_SYSTEM_COLLECTIONS', true);

  const srcClient = new MongoClient(SRC_URI, { maxPoolSize: 20 });
  const tgtClient = new MongoClient(TGT_URI, { maxPoolSize: 20 });

  console.log('Starting MongoDB migration...');
  console.log(`Source DB: ${SRC_DB}`);
  console.log(`Target DB: ${TGT_DB}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Drop destination collections first: ${DROP_DEST_COLLECTIONS}`);
  console.log(`Skip system collections: ${SKIP_SYSTEM_COLLECTIONS}`);

  try {
    await srcClient.connect();
    await tgtClient.connect();

    const srcDb = srcClient.db(SRC_DB);
    const tgtDb = tgtClient.db(TGT_DB);

    const collections = (await srcDb
      .listCollections({}, { nameOnly: false })
      .toArray()) as CollectionInfo[];

    if (!collections.length) {
      console.log('No collections found in source DB. Nothing to migrate.');
      return;
    }

    const destCollectionNames = new Set(
      (await tgtDb.listCollections({}, { nameOnly: true }).toArray()).map((c: any) => c.name as string)
    );

    for (const collInfo of collections) {
      const collName = collInfo.name;

      if (SKIP_SYSTEM_COLLECTIONS && collName.startsWith('system.')) {
        console.log(`Skipping system collection: ${collName}`);
        continue;
      }

      // Views are not handled by document copying. We skip them to avoid hard failures.
      if (collInfo.type === 'view') {
        console.warn(`Skipping view (not migrated as documents): ${collName}`);
        continue;
      }

      console.log(`\nMigrating collection: ${collName}`);

      // Drop destination collection if requested
      if (DROP_DEST_COLLECTIONS && destCollectionNames.has(collName)) {
        await tgtDb.collection(collName).drop().catch(() => {});
      }

      // Create destination collection (best-effort)
      const shouldCreate = !destCollectionNames.has(collName) || DROP_DEST_COLLECTIONS;
      if (shouldCreate) {
        try {
          await tgtDb.createCollection(collName, collInfo.options ?? {});
        } catch (e) {
          // Some collection options aren't supported by createCollection in all MongoDB versions.
          // Fallback to creating without options.
          await tgtDb.createCollection(collName);
        }
      }

      // Copy indexes (best-effort)
      const srcIndexes = await srcDb.collection(collName).indexes();
      const tgtIndexes = await tgtDb.collection(collName).indexes();
      const tgtIndexNames = new Set(tgtIndexes.map((i: any) => i.name as string));

      for (const idx of srcIndexes as any[]) {
        if (idx.name === '_id_') continue;
        if (tgtIndexNames.has(idx.name)) continue;

        const { key, name, ns, v, background, ...rest } = idx as any;
        try {
          await tgtDb.collection(collName).createIndex(key, { ...rest, name });
        } catch (e) {
          console.warn(`  Warning: failed to create index ${idx.name} on ${collName}:`, (e as Error).message);
        }
      }

      // Copy documents
      const srcColl = srcDb.collection(collName);
      const tgtColl = tgtDb.collection(collName);

      const cursor = srcColl.find({}, { batchSize: BATCH_SIZE });
      let batch: any[] = [];
      let totalInserted = 0;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        batch.push(doc);

        if (batch.length >= BATCH_SIZE) {
          const res = await tgtColl.insertMany(batch, { ordered: false });
          totalInserted += res.insertedCount ?? batch.length;
          batch = [];

          if (totalInserted % (BATCH_SIZE * 10) === 0) {
            console.log(`  Inserted so far: ${totalInserted}`);
          }
        }
      }

      if (batch.length > 0) {
        const res = await tgtColl.insertMany(batch, { ordered: false });
        totalInserted += res.insertedCount ?? batch.length;
      }

      console.log(`  Done. Total inserted: ${totalInserted}`);
    }

    console.log('\nMigration completed successfully.');
  } finally {
    await srcClient.close();
    await tgtClient.close();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});

