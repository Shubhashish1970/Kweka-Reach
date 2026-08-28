import { TaskStatus } from '../models/CallTask.js';

/**
 * Display labels for task statuses
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  unassigned: 'Unassigned',
  sampled_in_queue: 'Sampled - in queue',
  in_progress: 'In Progress',
  completed: 'Completed',
  not_reachable: 'Not Reachable',
  invalid_number: 'Invalid Number',
  cancelled: 'Cancelled',
};

/**
 * Get display label for a task status
 */
export const getTaskStatusLabel = (status: TaskStatus): string => {
  return TASK_STATUS_LABELS[status] || status;
};

/**
 * Get status from label (reverse lookup) - useful for filters
 */
export const getStatusFromLabel = (label: string): TaskStatus | null => {
  const entry = Object.entries(TASK_STATUS_LABELS).find(([_, value]) => value === label);
  return entry ? (entry[0] as TaskStatus) : null;
};
