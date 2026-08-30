/**
 * One-shot read-only audit: compare History-style task counts (date window) vs dialer list.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/auditAgentScreens.ts --email=naclkkc5@nacl.murugappa.com
 *   npx tsx src/scripts/auditAgentScreens.ts --email=... --dateFrom=2026-04-08 --dateTo=2026-04-14
 *
 * Requires MONGODB_URI (e.g. from .env). Read-only: no writes.
 *
 * If --dateFrom/--dateTo are omitted, uses calendar days of min(updatedAt) and max(updatedAt)
 * across all tasks assigned to that agent (same idea as “full span of task activity”).
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { CallTask } from '../models/CallTask.js';
import { User } from '../models/User.js';
import { getAvailableTasksForAgent } from '../services/taskService.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let email = '';
  let dateFrom = '';
  let dateTo = '';
  for (const a of argv) {
    if (a.startsWith('--email=')) email = a.slice(8).trim().toLowerCase();
    else if (a.startsWith('--dateFrom=')) dateFrom = a.slice(11).trim();
    else if (a.startsWith('--dateTo=')) dateTo = a.slice(9).trim();
  }
  return { email, dateFrom, dateTo };
}

/** Matches GET /api/tasks/own/history/stats non-queue date logic (no territory/search filters). */
function buildNonQueueBaseMatch(agentOid: mongoose.Types.ObjectId, dateFrom?: string, dateTo?: string): Record<string, unknown> {
  const baseMatch: Record<string, unknown> = {
    assignedAgentId: agentOid,
    status: { $ne: 'sampled_in_queue' },
  };
  if (!dateFrom && !dateTo) return baseMatch;

  let from: Date | null = dateFrom ? new Date(dateFrom) : null;
  let to: Date | null = dateTo ? new Date(dateTo) : null;
  if (from && !Number.isNaN(from.getTime())) from.setHours(0, 0, 0, 0);
  else from = null;
  if (to && !Number.isNaN(to.getTime())) to.setHours(23, 59, 59, 999);
  else to = null;

  const dateConditions: Record<string, unknown>[] = [];
  if (from && to) {
    dateConditions.push(
      { updatedAt: { $gte: from, $lte: to } },
      {
        $and: [
          { callStartedAt: { $exists: true, $ne: null, $gte: from, $lte: to } },
          {
            $or: [
              { updatedAt: { $exists: false } },
              { updatedAt: null },
              { updatedAt: { $lt: from } },
              { updatedAt: { $gt: to } },
            ],
          },
        ],
      }
    );
  } else if (from) {
    dateConditions.push(
      { updatedAt: { $gte: from } },
      {
        $and: [
          { callStartedAt: { $exists: true, $ne: null, $gte: from } },
          { $or: [{ updatedAt: { $exists: false } }, { updatedAt: null }, { updatedAt: { $lt: from } }] },
        ],
      }
    );
  } else if (to) {
    dateConditions.push(
      { updatedAt: { $lte: to } },
      {
        $and: [
          { callStartedAt: { $exists: true, $ne: null, $lte: to } },
          { $or: [{ updatedAt: { $exists: false } }, { updatedAt: null }, { updatedAt: { $gt: to } }] },
        ],
      }
    );
  }
  if (dateConditions.length > 0) baseMatch.$or = dateConditions;
  return baseMatch;
}

function buildInQueueMatch(agentOid: mongoose.Types.ObjectId, dateFrom?: string, dateTo?: string): Record<string, unknown> {
  const inQueueMatch: Record<string, unknown> = {
    assignedAgentId: agentOid,
    status: 'sampled_in_queue',
  };
  if (!dateFrom && !dateTo) return inQueueMatch;

  let fromDate: Date | null = dateFrom ? new Date(dateFrom) : null;
  let toDate: Date | null = dateTo ? new Date(dateTo) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) fromDate.setHours(0, 0, 0, 0);
  else fromDate = null;
  if (toDate && !Number.isNaN(toDate.getTime())) toDate.setHours(23, 59, 59, 999);
  else toDate = null;

  if (fromDate && toDate) inQueueMatch.updatedAt = { $gte: fromDate, $lte: toDate };
  else if (fromDate) inQueueMatch.updatedAt = { $gte: fromDate };
  else if (toDate) inQueueMatch.updatedAt = { $lte: toDate };
  return inQueueMatch;
}

async function historyStyleStats(agentOid: mongoose.Types.ObjectId, dateFrom: string, dateTo: string) {
  const baseMatch = buildNonQueueBaseMatch(agentOid, dateFrom, dateTo);
  const rows = await CallTask.aggregate([
    { $match: baseMatch },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const statusCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r._id) statusCounts[String(r._id)] = Number(r.count || 0);
  }
  const inQueue = await CallTask.countDocuments(buildInQueueMatch(agentOid, dateFrom, dateTo));
  const inProgress = statusCounts['in_progress'] || 0;
  const completed = statusCounts['completed'] || 0;
  const notReachable = statusCounts['not_reachable'] || 0;
  const invalid = statusCounts['invalid_number'] || 0;
  const cancelled = statusCounts['cancelled'] || 0;
  const total = inProgress + completed + notReachable + invalid + cancelled;
  return { inQueue, inProgress, completed, notReachable, invalid, cancelled, total };
}

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Add it to .env or export it for this command.');
    process.exit(1);
  }

  const { email, dateFrom: dfArg, dateTo: dtArg } = parseArgs();
  if (!email) {
    console.error('Usage: npx tsx src/scripts/auditAgentScreens.ts --email=agent@company.com [--dateFrom=YYYY-MM-DD] [--dateTo=YYYY-MM-DD]');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected:', mongoose.connection.name);

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('name email role languageCapabilities employeeId');
  if (!user) {
    console.error('User not found:', email);
    await mongoose.disconnect();
    process.exit(1);
  }

  const agentOid = user._id as mongoose.Types.ObjectId;
  const agentId = String(user._id);

  console.log('\nAgent:', user.name, '|', user.email, '| role:', user.role, '| languages:', (user.languageCapabilities || []).join(', ') || '(none)');

  let dateFrom = dfArg;
  let dateTo = dtArg;
  if (!dateFrom || !dateTo) {
    const bounds = await CallTask.aggregate([
      { $match: { assignedAgentId: agentOid } },
      { $group: { _id: null, minU: { $min: '$updatedAt' }, maxU: { $max: '$updatedAt' } } },
    ]);
    if (!bounds[0]?.minU || !bounds[0]?.maxU) {
      console.log('\nNo CallTask documents for this agent.');
      await mongoose.disconnect();
      return;
    }
    dateFrom = dateFrom || new Date(bounds[0].minU as Date).toISOString().slice(0, 10);
    dateTo = dateTo || new Date(bounds[0].maxU as Date).toISOString().slice(0, 10);
    console.log('\nDate window (auto from min/max updatedAt on assigned tasks):', dateFrom, '->', dateTo);
  } else {
    console.log('\nDate window (from args):', dateFrom, '->', dateTo);
  }

  const h = await historyStyleStats(agentOid, dateFrom, dateTo);
  console.log('\n=== History-style counts (DB, same date rules as /tasks/own/history/stats, no extra filters) ===');
  console.log(JSON.stringify(h, null, 2));
  const sumOk = h.total === h.inProgress + h.completed + h.notReachable + h.invalid;
  console.log('Internal sum check (total = non-queue only):', sumOk ? 'OK' : 'FAIL');

  const allAssigned = await CallTask.countDocuments({ assignedAgentId: agentOid });
  const dialerTasks = await getAvailableTasksForAgent(agentId);
  const dBy: Record<string, number> = {};
  for (const t of dialerTasks) {
    const s = String(t.status || '');
    dBy[s] = (dBy[s] || 0) + 1;
  }

  console.log('\n=== Dialer (getAvailableTasksForAgent: scheduledDate sort, language filter) ===');
  console.log('Rows returned:', dialerTasks.length, '| Total assigned CallTasks:', allAssigned);
  console.log('By status:', dBy);

  console.log('\n=== Interpretation ===');
  console.log('- History total = non-queue statuses; inQueue is separate (matches Statistics strip + table scope).');
  console.log('- Dialer rows can differ: no date filter, max 300 earliest by scheduledDate, language match only.');
  console.log('- If History UI used a different preset (e.g. Last 7 days), pass --dateFrom/--dateTo to match that screen.');

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
