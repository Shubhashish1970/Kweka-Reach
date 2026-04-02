/**
 * Minimal Express app for integration tests.
 *
 * Mounts the same routes as server.ts but does NOT call connectDB() or listen().
 * The in-memory MongoDB connection is managed by tests/setup.ts.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler, notFound } from '../../src/middleware/errorHandler.js';
import authRoutes from '../../src/routes/auth.js';
import userRoutes from '../../src/routes/users.js';
import taskRoutes from '../../src/routes/tasks.js';
import masterDataRoutes from '../../src/routes/masterData.js';
import samplingRoutes from '../../src/routes/sampling.js';
import adminRoutes from '../../src/routes/admin.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Active-Role'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check (useful for smoke-testing the test setup itself)
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Test server running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/sampling', samplingRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
