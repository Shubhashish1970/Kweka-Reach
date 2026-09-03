/**
 * Connects using MONGODB_URI (never prints the URI).
 * Reports host, database name, ping, and a few collection counts.
 */
import { MongoClient } from 'mongodb';

function redact(text) {
  return String(text || '')
    .replace(/mongodb(\+srv)?:\/\/[^/\s]+/gi, 'mongodb$1://[redacted]')
    .replace(/:[^:@/\s]+@/g, ':[redacted]@');
}

function parseUriMeta(uri) {
  const noQuery = uri.split('?')[0];
  const hostMatch = noQuery.match(/@([^/]+)/);
  const dbMatch = noQuery.match(/\/([^/]+)$/);
  return {
    host: hostMatch?.[1] || '(unknown host)',
    database: dbMatch?.[1] || '(no database in URI path)',
  };
}

const uri = process.env.MONGODB_URI?.trim();
if (!uri) {
  console.error('FAIL: MONGODB_URI is empty');
  process.exit(1);
}

const { host, database } = parseUriMeta(uri);
console.log(`Host: ${host}`);
console.log(`Database in URI: ${database}`);

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 12000,
  connectTimeoutMS: 12000,
});

try {
  await client.connect();
  await client.db(database === '(no database in URI path)' ? 'admin' : database).command({ ping: 1 });
  console.log('Ping: ok');

  const dbName =
    database === '(no database in URI path)' ? client.db().databaseName : database;
  const db = client.db(dbName);
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = collections.map((c) => c.name).sort();
  console.log(`Collections: ${names.length}`);
  if (names.length) {
    console.log(`Collection names: ${names.join(', ')}`);
  }

  const countIfExists = async (name) => {
    if (!names.includes(name)) return `${name}: (missing)`;
    const n = await db.collection(name).countDocuments();
    return `${name}: ${n}`;
  };

  console.log(await countIfExists('users'));
  if (names.includes('users')) {
    const virtual = await db.collection('users').countDocuments({ agentKind: 'virtual' });
    console.log(`users (agentKind=virtual): ${virtual}`);
  }
  console.log(await countIfExists('voiceplatformsettings'));
  console.log(await countIfExists('calltasks'));
  console.log(await countIfExists('farmers'));
  console.log(await countIfExists('activities'));
  console.log('RESULT: reachable');
} catch (err) {
  console.error('RESULT: not reachable');
  console.error(redact(err instanceof Error ? err.message : String(err)));
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
