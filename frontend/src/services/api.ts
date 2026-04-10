// API Service Layer - Replaces mock ApiService

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

// Get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('authToken');
};

// Get active role from localStorage
const getActiveRole = (): string | null => {
  return localStorage.getItem('activeRole');
};

// Get auth headers
export const getAuthHeaders = (): HeadersInit => {
  const token = getAuthToken();
  const activeRole = getActiveRole();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(activeRole && { 'X-Active-Role': activeRole }),
  };
};

// Create a fetch with timeout
const fetchWithTimeout = (url: string, options: RequestInit, timeout: number = 8000, abortSignal?: AbortSignal): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);
  
  // Combine abort signals if provided
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });
  }
  
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
};

// API request wrapper
const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {},
  abortSignal?: AbortSignal,
  timeout: number = 8000 // Default 8 second timeout
): Promise<T> => {
  const url = `${API_BASE_URL}${endpoint}`;
  const config: RequestInit = {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  };

  try {
    const response = await fetchWithTimeout(url, config, timeout, abortSignal);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
      const msg = error.error?.message || `Request failed with status ${response.status}`;
      const details = error.error?.errors;
      const detailStr = Array.isArray(details) && details.length > 0
        ? ': ' + details.map((e: { msg?: string; path?: string }) => e.msg || e.path || '').join('; ')
        : '';
      throw new Error(msg + detailStr);
    }

    return response.json();
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Failed to connect to server. Please check if the backend is running.');
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  }
};

// Authentication API
export const authAPI = {
  login: async (email: string, password: string) => {
    const response = await apiRequest<{ success: boolean; data: { token: string; user: any } }>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );

    if (response.success && response.data.token) {
      localStorage.setItem('authToken', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }

    return response;
  },

  logout: async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
    }
  },

  getCurrentUser: async () => {
    return apiRequest<{ success: boolean; data: { user: any } }>('/auth/me');
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    return apiRequest<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  forgotPassword: async (email: string) => {
    return apiRequest<{ success: boolean; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword: async (token: string, password: string) => {
    return apiRequest<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },

  verifyResetToken: async (token: string) => {
    return apiRequest<{ success: boolean; message: string }>('/auth/verify-reset-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },
};

// Tasks API
export const tasksAPI = {
  fetchActiveTask: async (abortSignal?: AbortSignal) => {
    const response = await apiRequest<{ success: boolean; data: { taskId?: string; task?: null; farmer?: any; activity?: any; status?: string; scheduledDate?: string; message?: string } }>('/tasks/active', {}, abortSignal);
    return response;
  },

  getAvailableTasks: async (abortSignal?: AbortSignal) => {
    return apiRequest<{ success: boolean; data: { tasks: any[]; count: number } }>('/tasks/available', {}, abortSignal);
  },

  loadTask: async (taskId: string) => {
    return apiRequest<{ success: boolean; data: { taskId: string; farmer: any; activity: any; status: string; scheduledDate: string } }>(`/tasks/${taskId}/load`, {
      method: 'POST',
    });
  },

  submitInteraction: async (taskId: string, log: any) => {
    return apiRequest(`/tasks/${taskId}/submit`, {
      method: 'POST',
      body: JSON.stringify(log),
    });
  },

  markInProgress: async (taskId: string) => {
    return apiRequest(`/tasks/${taskId}/mark-in-progress`, { method: 'POST' });
  },

  getOwnHistory: async (filters?: { status?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    // Optional extra filters (Agent History v2 UI)
    if ((filters as any)?.territory) params.append('territory', (filters as any).territory);
    if ((filters as any)?.activityType) params.append('activityType', (filters as any).activityType);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString();
    return apiRequest(`/tasks/own/history${query ? `?${query}` : ''}`);
  },

  getOwnHistoryOptions: async (filters?: { status?: string; territory?: string; activityType?: string; search?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/tasks/own/history/options${query ? `?${query}` : ''}`);
  },

  getOwnHistoryStats: async (filters?: { status?: string; territory?: string; activityType?: string; search?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/tasks/own/history/stats${query ? `?${query}` : ''}`);
  },

  downloadOwnHistoryExport: async (filters?: { status?: string; territory?: string; activityType?: string; search?: string; dateFrom?: string; dateTo?: string; limit?: number }) => {
    const headers = getAuthHeaders();
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString();

    const res = await fetch(`${API_BASE_URL}/tasks/own/history/export${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const msg = json?.error?.message || json?.message || `Download failed (${res.status})`;
      throw new Error(msg);
    }

    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'agent_history.xlsx';

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  getOwnHistoryDetail: async (taskId: string) => {
    return apiRequest(`/tasks/own/history/${taskId}`);
  },

  getOwnAnalytics: async (filters?: { dateFrom?: string; dateTo?: string; bucket?: 'daily' | 'weekly' | 'monthly' }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.bucket) params.append('bucket', filters.bucket);
    const query = params.toString();
    return apiRequest(`/tasks/own/analytics${query ? `?${query}` : ''}`);
  },

  getPendingTasks: async (filters?: { agentId?: string; territory?: string; zone?: string; bu?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.agentId) params.append('agentId', filters.agentId);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const query = params.toString();
    return apiRequest(`/tasks/pending${query ? `?${query}` : ''}`);
  },

  getPendingTasksStats: async (filters?: { agentId?: string; territory?: string; zone?: string; bu?: string; search?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.agentId) params.append('agentId', filters.agentId);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/tasks/pending/stats${query ? `?${query}` : ''}`);
  },

  getPendingTasksFilterOptions: async (filters?: { agentId?: string; territory?: string; zone?: string; bu?: string; search?: string; dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.agentId) params.append('agentId', filters.agentId);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/tasks/pending/options${query ? `?${query}` : ''}`);
  },

  downloadPendingTasksExport: async (filters?: { agentId?: string; territory?: string; zone?: string; bu?: string; search?: string; dateFrom?: string; dateTo?: string; exportAll?: boolean; page?: number; limit?: number }) => {
    const headers = getAuthHeaders();
    const params = new URLSearchParams();
    if (filters?.agentId) params.append('agentId', filters.agentId);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.exportAll !== undefined) params.append('exportAll', String(filters.exportAll));
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const query = params.toString();
    const res = await fetch(`${API_BASE_URL}/tasks/pending/export${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const msg = json?.error?.message || json?.message || `Download failed (${res.status})`;
      throw new Error(msg);
    }

    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'tasks_export.xlsx';

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  getTeamTasks: async (filters?: { status?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const query = params.toString();
    return apiRequest(`/tasks/team${query ? `?${query}` : ''}`);
  },

  getUnassignedTasks: async (filters?: { dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const query = params.toString();
    return apiRequest(`/tasks/unassigned${query ? `?${query}` : ''}`);
  },

  // Callback Request APIs (Team Lead)
  getCallbackCandidates: async (filters?: { 
    dateFrom?: string; 
    dateTo?: string; 
    outcome?: string; 
    callType?: string; 
    agentId?: string;
    page?: number; 
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.outcome) params.append('outcome', filters.outcome);
    if (filters?.callType) params.append('callType', filters.callType);
    if (filters?.agentId) params.append('agentId', filters.agentId);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const query = params.toString();
    return apiRequest(`/tasks/callback/candidates${query ? `?${query}` : ''}`);
  },

  createCallbacks: async (taskIds: string[]) => {
    return apiRequest('/tasks/callback/create', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    });
  },

  getCallbackHistory: async (taskId: string) => {
    return apiRequest(`/tasks/${taskId}/callback-history`);
  },

  getDashboard: async (filters?: { dateFrom?: string; dateTo?: string; bu?: string; state?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.state) params.append('state', filters.state);
    const query = params.toString();
    return apiRequest(`/tasks/dashboard${query ? `?${query}` : ''}`);
  },

  getDashboardAgent: async (
    agentId: string,
    language?: string,
    page?: number,
    limit?: number,
    filters?: { dateFrom?: string; dateTo?: string; bu?: string; state?: string; status?: string; fda?: string }
  ) => {
    const params = new URLSearchParams();
    if (language) params.set('language', language);
    if (page != null && page >= 1) params.set('page', String(page));
    if (limit != null && limit >= 1) params.set('limit', String(limit));
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    if (filters?.bu) params.set('bu', filters.bu);
    if (filters?.state) params.set('state', filters.state);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.fda) params.set('fda', filters.fda);
    const query = params.toString();
    return apiRequest(`/tasks/dashboard/agent/${encodeURIComponent(agentId)}${query ? `?${query}` : ''}`);
  },

  getDashboardByLanguage: async (
    language: string,
    filters?: { dateFrom?: string; dateTo?: string; bu?: string; state?: string; agentId?: string; status?: string },
    page?: number,
    limit?: number
  ) => {
    const params = new URLSearchParams();
    params.set('language', language);
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    if (filters?.bu) params.set('bu', filters.bu);
    if (filters?.state) params.set('state', filters.state);
    if (filters?.agentId) params.set('agentId', filters.agentId);
    if (filters?.status) params.set('status', filters.status);
    if (page != null && page >= 1) params.set('page', String(page));
    if (limit != null && limit >= 1) params.set('limit', String(limit));
    const query = params.toString();
    return apiRequest(`/tasks/dashboard/by-language?${query}`);
  },
  allocate: async (payload: { language: string; count?: number; dateFrom?: string; dateTo?: string; bu?: string; state?: string }) => {
    // Allocation can update many tasks; allow longer timeout
    return apiRequest(
      '/tasks/allocate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      undefined,
      300000
    );
  },
  reallocate: async (agentId: string) => {
    // Reallocation can update many tasks; allow longer timeout
    return apiRequest(
      '/tasks/reallocate',
      {
        method: 'POST',
        body: JSON.stringify({ agentId }),
      },
      undefined,
      300000
    );
  },
  getLatestAllocationStatus: async () => {
    return apiRequest('/tasks/allocate-status/latest');
  },

  reassignTask: async (taskId: string, agentId: string) => {
    return apiRequest(`/tasks/${taskId}/reassign`, {
      method: 'PUT',
      body: JSON.stringify({ agentId }),
    });
  },

  getTaskById: async (taskId: string) => {
    return apiRequest(`/tasks/${taskId}`);
  },

  updateTaskStatus: async (taskId: string, status: string, notes?: string) => {
    return apiRequest(`/tasks/${taskId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, notes }),
    });
  },

  bulkReassignTasks: async (taskIds: string[], agentId: string) => {
    return apiRequest('/tasks/bulk/reassign', {
      method: 'PUT',
      body: JSON.stringify({ taskIds, agentId }),
    });
  },

  bulkUpdateStatus: async (taskIds: string[], status: string, notes?: string) => {
    return apiRequest('/tasks/bulk/status', {
      method: 'PUT',
      body: JSON.stringify({ taskIds, status, notes }),
    });
  },
};

// Sampling Control API (Team Lead)
export const samplingAPI = {
  getConfig: async () => {
    return apiRequest('/sampling/config');
  },
  updateConfig: async (payload: {
    activityCoolingDays?: number;
    farmerCoolingDays?: number;
    defaultPercentage?: number;
    activityTypePercentages?: Record<string, number>;
    eligibleActivityTypes?: string[];
    autoRunEnabled?: boolean;
    autoRunThreshold?: number;
    autoRunActivateFrom?: string | null;
    taskDueInDays?: number;
  }) => {
    return apiRequest('/sampling/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  listActivities: async (filters?: {
    lifecycleStatus?: 'active' | 'sampled' | 'inactive' | 'not_eligible';
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.lifecycleStatus) params.append('lifecycleStatus', filters.lifecycleStatus);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString();
    return apiRequest(`/sampling/activities${query ? `?${query}` : ''}`);
  },
  getStats: async (filters?: { dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/sampling/stats${query ? `?${query}` : ''}`);
  },
  getActivityTypes: async (filters?: { dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/sampling/activity-types${query ? `?${query}` : ''}`);
  },
  getLatestRunStatus: async () => {
    return apiRequest('/sampling/run-status/latest');
  },
  getFirstSampleRange: async () => {
    return apiRequest('/sampling/first-sample-range');
  },
  applyEligibility: async (eligibleActivityTypes: string[]) => {
    // Can take time if updating many activities; allow longer timeout
    return apiRequest('/sampling/apply-eligibility', {
      method: 'POST',
      body: JSON.stringify({ eligibleActivityTypes }),
    }, undefined, 60000);
  },
  getReactivatePreview: async (filters: {
    fromStatus?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters.fromStatus) params.append('fromStatus', filters.fromStatus);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/sampling/reactivate-preview${query ? `?${query}` : ''}`);
  },
  reactivate: async (payload: {
    confirm: 'YES';
    activityIds?: string[];
    fromStatus?: 'inactive' | 'not_eligible' | 'sampled';
    dateFrom?: string;
    dateTo?: string;
    deleteExistingTasks?: boolean;
    deleteExistingAudit?: boolean;
  }) => {
    // Bulk reactivation can take time if deleting tasks/audits; allow longer timeout
    return apiRequest('/sampling/reactivate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, undefined, 180000);
  },
  runSampling: async (payload: {
    runType?: 'first_sample' | 'adhoc';
    activityIds?: string[];
    lifecycleStatus?: 'active' | 'sampled' | 'inactive' | 'not_eligible';
    dateFrom?: string;
    dateTo?: string;
    samplingPercentage?: number;
    forceRun?: boolean;
  }) => {
    // Sampling can run longer than default 8s; allow a longer timeout
    return apiRequest('/sampling/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, undefined, 300000);
  },
};

// Users API (for MIS Admin)
export const usersAPI = {
  getUsers: async (filters?: { role?: string; isActive?: boolean; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.role) params.append('role', filters.role);
    if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const query = params.toString();
    return apiRequest(`/users${query ? `?${query}` : ''}`);
  },

  createUser: async (userData: any) => {
    return apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  updateUser: async (userId: string, userData: any) => {
    return apiRequest(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  },

  deleteUser: async (userId: string) => {
    return apiRequest(`/users/${userId}`, {
      method: 'DELETE',
    });
  },

  resetUserToDefaultPassword: async (userId: string) => {
    return apiRequest<{ success: boolean; message: string }>(`/users/${userId}/reset-default-password`, {
      method: 'POST',
    });
  },

  getUser: async (userId: string) => {
    return apiRequest(`/users/${userId}`);
  },

  // Team Lead: list only own agents (no users.view permission required)
  getTeamAgents: async () => {
    return apiRequest('/users/team/agents');
  },
};

export const masterDataAPI = {
  getCrops: async () => {
    return apiRequest<{
      success: boolean;
      data: { crops: Array<{ name: string; isActive: boolean }> };
    }>('/master-data/crops', { method: 'GET' });
  },
  getProducts: async () => {
    return apiRequest<{
      success: boolean;
      data: { products: Array<{ name: string; isActive: boolean }> };
    }>('/master-data/products', { method: 'GET' });
  },
};

// Admin API
export const adminAPI = {
  getActivitiesWithSampling: async (filters?: {
    activityType?: string;
    territory?: string;
    zone?: string;
    bu?: string;
    samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    _refresh?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.samplingStatus) params.append('samplingStatus', filters.samplingStatus);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?._refresh != null) params.append('_t', String(filters._refresh));

    const query = params.toString();
    return apiRequest(`/admin/activities-sampling${query ? `?${query}` : ''}`);
  },

  getActivitiesSamplingStats: async (filters?: {
    activityType?: string;
    territory?: string;
    zone?: string;
    bu?: string;
    samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.samplingStatus) params.append('samplingStatus', filters.samplingStatus);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/admin/activities-sampling/stats${query ? `?${query}` : ''}`);
  },

  getActivitiesSamplingFilterOptions: async (filters?: {
    activityType?: string;
    territory?: string;
    zone?: string;
    bu?: string;
    samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.samplingStatus) params.append('samplingStatus', filters.samplingStatus);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString();
    return apiRequest(`/admin/activities-sampling/options${query ? `?${query}` : ''}`);
  },

  downloadActivitiesSamplingExport: async (filters?: {
    activityType?: string;
    territory?: string;
    zone?: string;
    bu?: string;
    samplingStatus?: 'sampled' | 'not_sampled' | 'partial';
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const headers = getAuthHeaders();
    const params = new URLSearchParams();
    if (filters?.activityType) params.append('activityType', filters.activityType);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.samplingStatus) params.append('samplingStatus', filters.samplingStatus);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);

    const query = params.toString();
    const res = await fetch(`${API_BASE_URL}/admin/activities-sampling/export${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const msg = json?.error?.message || json?.message || `Download failed (${res.status})`;
      throw new Error(msg);
    }

    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'activity_sampling_export.xlsx';

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  getAgentQueues: async (filters?: {
    agentId?: string;
    isActive?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (filters?.agentId) params.append('agentId', filters.agentId);
    if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));

    const query = params.toString();
    return apiRequest(`/admin/agent-queues${query ? `?${query}` : ''}`);
  },

  getAgentQueue: async (
    agentId: string,
    params?: {
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      language?: string;
      territory?: string;
      page?: number;
      limit?: number;
    }
  ) => {
    const search = new URLSearchParams();
    if (params?.dateFrom) search.set('dateFrom', params.dateFrom);
    if (params?.dateTo) search.set('dateTo', params.dateTo);
    if (params?.status) search.set('status', params.status);
    if (params?.language) search.set('language', params.language);
    if (params?.territory) search.set('territory', params.territory);
    if (params?.page != null) search.set('page', String(params.page));
    if (params?.limit != null) search.set('limit', String(params.limit));
    const q = search.toString();
    return apiRequest(`/admin/agent-queues/${agentId}${q ? `?${q}` : ''}`);
  },
};

// KPI / EMS Progress API (MIS Admin)
export type EmsDrilldownGroupBy = 'state' | 'territory' | 'zone' | 'bu' | 'activityType';

export type EmsReportGroupBy = 'tm' | 'fda' | 'bu' | 'zone' | 'region' | 'territory';

export type EmsTrendBucket = 'daily' | 'weekly' | 'monthly';

export interface EmsTrendRow {
  period: string;
  totalAttempted: number;
  totalConnected: number;
  emsScore: number;
  mobileValidityPct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
}

export interface EmsReportSummaryRow {
  groupKey: string;
  groupLabel: string;
  totalAttempted: number;
  totalConnected: number;
  disconnectedCount: number;
  incomingNACount: number;
  invalidCount: number;
  noAnswerCount: number;
  identityWrongCount: number;
  dontRecallCount: number;
  noMissedCount: number;
  notAFarmerCount: number;
  yesAttendedCount: number;
  notPurchasedCount: number;
  purchasedCount: number;
  willingMaybeCount: number;
  willingNoCount: number;
  willingYesCount: number;
  yesPlusPurchasedCount: number;
  mobileValidityPct: number;
  hygienePct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
  activityQualitySum: number;
  activityQualityCount: number;
  qualityCount1?: number;
  qualityCount2?: number;
  qualityCount3?: number;
  qualityCount4?: number;
  qualityCount5?: number;
  totalCsScore?: number;
  maxCsScore?: number;
  emsScore: number;
  relativeRemarks: string;
}

/** One row per call for drill-down; from GET /reports/ems?level=line */
export interface EmsReportLineRow {
  taskId: string;
  groupKey: string;
  groupLabel: string;
  activityId: string;
  activityDate: string;
  farmerName: string;
  farmerMobile: string;
  officerName: string;
  tmName: string;
  territoryName: string;
  zoneName: string;
  buName: string;
  state: string;
  totalAttempted: 1;
  connected: 0 | 1;
  invalid: 0 | 1;
  identityWrong: 0 | 1;
  notAFarmer: 0 | 1;
  yesAttended: 0 | 1;
  purchased: 0 | 1;
  willingYes: 0 | 1;
  mobileValidityPct: number;
  hygienePct: number;
  meetingValidityPct: number;
  meetingConversionPct: number;
  purchaseIntentionPct: number;
  cropSolutionsFocusPct: number;
  emsScore: number;
  relativeRemarks: string;
}

export interface EmsProgressFilters {
  dateFrom?: string;
  dateTo?: string;
  state?: string;
  territory?: string;
  zone?: string;
  bu?: string;
  activityType?: string;
}

export interface EmsProgressSummary {
  activities: {
    total: number;
    byLifecycle: { active: number; sampled: number; inactive: number; not_eligible: number };
    sampledCount: number;
    notSampledCount: number;
    partialCount: number;
  };
  tasks: {
    total: number;
    unassigned: number;
    sampled_in_queue: number;
    in_progress: number;
    completed: number;
    not_reachable: number;
    invalid_number: number;
    completionRatePct: number;
  };
  farmers: { totalInActivities: number; sampled: number };
}

export interface EmsDrilldownRow {
  key: string;
  label: string;
  activitiesTotal: number;
  activitiesSampled: number;
  activitiesNotSampled: number;
  activitiesPartial: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksInQueue: number;
  tasksInProgress: number;
  farmersTotal: number;
  farmersSampled: number;
  completionRatePct: number;
}

export const kpiAPI = {
  getEmsProgress: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: EmsProgressSummary }>(`/kpi/ems${query ? `?${query}` : ''}`);
  },

  getEmsDrilldown: async (groupBy: EmsDrilldownGroupBy, filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    params.append('groupBy', groupBy);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: EmsDrilldownRow[] }>(`/kpi/ems/drilldown?${query}`);
  },

  getEmsFilterOptions: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: { stateOptions: string[]; territoryOptions: string[]; zoneOptions: string[]; buOptions: string[]; activityTypeOptions: string[] } }>(`/kpi/ems/filter-options${query ? `?${query}` : ''}`);
  },
};

// Reports API (MIS Admin)
export const reportsAPI = {
  getDaily: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: any[] }>(`/reports/daily${query ? `?${query}` : ''}`);
  },
  getWeekly: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: any[] }>(`/reports/weekly${query ? `?${query}` : ''}`);
  },
  getMonthly: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: any[] }>(`/reports/monthly${query ? `?${query}` : ''}`);
  },
  downloadExport: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    const res = await fetch(`${API_BASE_URL}/reports/export${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error?.message || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'ems-progress-report.xlsx';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  /** EMS report JSON: groupBy, level summary|line, + filters */
  getEmsReport: async (
    groupBy: EmsReportGroupBy,
    level: 'summary' | 'line' = 'summary',
    filters?: EmsProgressFilters
  ): Promise<{ success: boolean; data: EmsReportSummaryRow[] | EmsReportLineRow[] }> => {
    const params = new URLSearchParams();
    params.append('groupBy', groupBy);
    params.append('level', level);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: EmsReportSummaryRow[] | EmsReportLineRow[] }>(`/reports/ems?${query}`);
  },
  /** EMS trends: bucket daily|weekly|monthly, + filters */
  getEmsTrends: async (bucket: EmsTrendBucket, filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    params.append('bucket', bucket);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    return apiRequest<{ success: boolean; data: EmsTrendRow[] }>(`/reports/ems/trends?${query}`);
  },
  /** EMS report Excel: groupBy (tm|fda|bu|zone|region|territory), level summary|line, + filters */
  downloadEmsReportExport: async (
    groupBy: EmsReportGroupBy,
    level: 'summary' | 'line' = 'summary',
    filters?: EmsProgressFilters
  ) => {
    const params = new URLSearchParams();
    params.append('groupBy', groupBy);
    params.append('level', level);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    const res = await fetch(`${API_BASE_URL}/reports/ems/export?${query}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error?.message || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'ems-report.xlsx';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  /** Task-level detail Excel: Officer Name, FDA, farmer name, territory, Activity/Task details, dates, agent, responses, final status */
  downloadTaskDetailsExport: async (filters?: EmsProgressFilters) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.state) params.append('state', filters.state);
    if (filters?.territory) params.append('territory', filters.territory);
    if (filters?.zone) params.append('zone', filters.zone);
    if (filters?.bu) params.append('bu', filters.bu);
    if (filters?.activityType) params.append('activityType', filters.activityType);
    const query = params.toString();
    const res = await fetch(`${API_BASE_URL}/reports/tasks-detail-export${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error?.message || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'ems-task-details.xlsx';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

// FFA Sync API
export const ffaAPI = {
  syncFFAData: async (fullSync: boolean = false) => {
    // FFA sync can take 200+ seconds for full sync, but incremental sync is much faster
    // Use 300 second (5 minute) timeout to handle full syncs in production
    const params = fullSync ? '?fullSync=true' : '';
    return apiRequest(`/ffa/sync${params}`, { method: 'POST' }, undefined, 300000);
  },

  getFFASyncStatus: async () => {
    return apiRequest('/ffa/status');
  },

  getFFASyncProgress: async () => {
    return apiRequest('/ffa/sync-progress');
  },

  clearData: async (
    clearTransactions: boolean,
    clearMasters: boolean,
    opts?: { transactionEntities?: string[]; masterEntities?: string[] }
  ) => {
    return apiRequest<{ success: boolean; message: string; data: Record<string, number>; meta?: any }>('/ffa/clear-data', {
      method: 'POST',
      body: JSON.stringify({
        clearTransactions,
        clearMasters,
        ...(opts?.transactionEntities?.length ? { transactionEntities: opts.transactionEntities } : null),
        ...(opts?.masterEntities?.length ? { masterEntities: opts.masterEntities } : null),
      }),
    });
  },

  downloadHierarchyTemplate: async () => {
    const token = getAuthToken();
    const activeRole = getActiveRole();
    const res = await fetch(`${API_BASE_URL}/ffa/hierarchy-template`, {
      method: 'GET',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(activeRole && { 'X-Active-Role': activeRole }),
      },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sales_hierarchy_template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  seedFromHierarchy: async (file: File | null, activityCount: number, farmersPerActivity: number) => {
    const token = getAuthToken();
    const activeRole = getActiveRole();
    const formData = new FormData();
    formData.append('activityCount', String(activityCount));
    formData.append('farmersPerActivity', String(farmersPerActivity));
    if (file) formData.append('file', file);

    const res = await fetch(`${API_BASE_URL}/ffa/seed-from-hierarchy`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(activeRole && { 'X-Active-Role': activeRole }),
      },
      body: formData,
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || `Seed failed (${res.status})`;
      throw new Error(msg);
    }
    return json;
  },

  importExcel: async (file: File) => {
    const token = getAuthToken();
    const activeRole = getActiveRole();

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE_URL}/ffa/import-excel`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(activeRole && { 'X-Active-Role': activeRole }),
      },
      body: formData,
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || `Upload failed (${res.status})`;
      throw new Error(msg);
    }
    return json;
  },

  getImportExcelProgress: async () => {
    return apiRequest('/ffa/import-excel-progress');
  },

  getDataBatches: async () => {
    return apiRequest<{
      success: boolean;
      data: {
        batches: Array<{
          batchId: string;
          activityCount: number;
          lastSyncedAt: string | null;
          source: 'excel' | 'sync' | 'unknown';
          canDelete: boolean;
          blockReason?: string;
        }>;
      };
    }>('/ffa/data-batches');
  },

  deleteDataBatch: async (batchId: string) => {
    return apiRequest<{
      success: boolean;
      message: string;
      data: {
        deletedActivities: number;
        deletedTasks: number;
        deletedAudits: number;
        deletedFarmers: number;
      };
    }>(
      '/ffa/delete-data-batch',
      {
        method: 'POST',
        body: JSON.stringify({ batchId }),
      },
      undefined,
      120000
    );
  },

  downloadExcelTemplate: async () => {
    const headers = getAuthHeaders();
    const res = await fetch(`${API_BASE_URL}/ffa/excel-template`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const msg = json?.error?.message || json?.message || `Download failed (${res.status})`;
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ffa_ems_template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

// AI API
export interface ExtractionContext {
  farmerName?: string;
  activityType?: string;
  crops?: string[];
  products?: string[];
  territory?: string;
}

export interface ExtractedData {
  didAttend?: string | null;
  didRecall?: boolean | null;
  cropsDiscussed?: string[];
  productsDiscussed?: string[];
  hasPurchased?: boolean | null;
  willingToPurchase?: boolean | null;
  likelyPurchaseDate?: string | undefined;
  nonPurchaseReason?: string;
  purchasedProducts?: Array<{ product: string; quantity: string; unit: string }>;
  farmerComments?: string; // 3 bullet points, 20-25 words each
  sentiment?: 'Positive' | 'Negative' | 'Neutral' | 'N/A'; // Sentiment indicator
}

export const aiAPI = {
  extractData: async (notes: string, context?: ExtractionContext) => {
    // AI extraction can take 5-10 seconds, use 30 second timeout
    return apiRequest<{
      success: boolean;
      message: string;
      data: ExtractedData;
    }>(
      '/ai/extract',
      {
        method: 'POST',
        body: JSON.stringify({ notes, context }),
      },
      undefined,
      30000
    );
  },

  getStatus: async () => {
    return apiRequest<{
      success: boolean;
      data: {
        available: boolean;
        model: string;
        hasApiKey: boolean;
      };
    }>('/ai/status');
  },
};
