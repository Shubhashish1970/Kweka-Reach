import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { resolveVirtualAgentDefaultPassword } from '../config/userPasswordDefaults.js';
import logger from '../config/logger.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/Kweka_Call_Centre';

/**
 * Apply the configured virtual-agent default password to all active virtual CC agents.
 * Use after enabling USER_VIRTUAL_AGENT_DEFAULT_PASSWORD or to fix agents created before defaults existed.
 */
const applyVirtualAgentDefaultPasswords = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('Connected to MongoDB');

    const defaultPlain = resolveVirtualAgentDefaultPassword();
    if (!defaultPlain) {
      logger.error(
        'Virtual agent default password is not configured. Set USER_VIRTUAL_AGENT_DEFAULT_PASSWORD on the server.'
      );
      process.exit(1);
    }

    const virtualAgents = await User.find({
      role: 'cc_agent',
      agentKind: 'virtual',
    }).select('email name employeeId');

    if (virtualAgents.length === 0) {
      logger.info('No virtual agents found. Nothing to update.');
      await mongoose.disconnect();
      process.exit(0);
    }

    const hashedPassword = await hashPassword(defaultPlain);

    for (const agent of virtualAgents) {
      await User.updateOne(
        { _id: agent._id },
        { password: hashedPassword, mustChangePassword: false }
      );
      logger.info(`Updated default password for virtual agent: ${agent.email} (${agent.employeeId})`);
    }

    logger.info(`Done. Applied default password to ${virtualAgents.length} virtual agent(s).`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Error applying virtual agent default passwords:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

applyVirtualAgentDefaultPasswords();
