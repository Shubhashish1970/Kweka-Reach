import React, { useState, useEffect } from 'react';
import { Plus, Filter, Search, Users as UsersIcon, Grid3x3 } from 'lucide-react';
import { usersAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import UserList from './UserList';
import UserForm, { UserRole } from './UserForm';
import AgentLanguageMatrix from './AgentLanguageMatrix';
import ConfirmationModal from '../shared/ConfirmationModal';
import StyledSelect from '../shared/StyledSelect';
import InfoBanner from '../shared/InfoBanner';
import Button from '../shared/Button';

const USER_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const USER_PAGE_SIZE_DEFAULT = 20;

interface User {
  _id: string;
  name: string;
  email: string;
  employeeId: string;
  role: UserRole;
  languageCapabilities: string[];
  teamLeadId?: string;
  teamLead?: {
    _id: string;
    name: string;
    email: string;
  };
  isActive: boolean;
  createdAt?: string;
}

const UserManagementView: React.FC = () => {
  const { showError, showSuccess } = useToast();
  const [view, setView] = useState<'users' | 'matrix'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [teamLeads, setTeamLeads] = useState<Array<{ _id: string; name: string; email: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [filters, setFilters] = useState({
    role: '' as UserRole | '',
    isActive: true as boolean | undefined,
    search: '',
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem('admin.userManagement.pageSize');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && USER_PAGE_SIZE_OPTIONS.includes(n as any) ? n : USER_PAGE_SIZE_DEFAULT;
  });
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; user: User | null }>({
    isOpen: false,
    user: null,
  });
  const [resetPwdModal, setResetPwdModal] = useState<{ isOpen: boolean; user: User | null }>({
    isOpen: false,
    user: null,
  });

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const user = JSON.parse(userData);
        setCurrentUserId(user._id || user.id);
      } catch (e) {
        console.error('Failed to parse user data');
      }
    }
  }, []);

  const fetchUsers = async (page: number = 1) => {
    setIsLoading(true);
    try {
      const response: any = await usersAPI.getUsers({
        role: filters.role || undefined,
        isActive: filters.isActive,
        page,
        limit: pageSize,
      });

      if (response.success && response.data) {
        let filteredUsers = (response.data.users || []).map((u: any) => {
          // Backend populates teamLeadId (as an object) not "teamLead". Normalize for UI.
          const populatedLead =
            u?.teamLeadId && typeof u.teamLeadId === 'object'
              ? {
                  _id: u.teamLeadId._id,
                  name: u.teamLeadId.name,
                  email: u.teamLeadId.email,
                }
              : undefined;

          return {
            ...u,
            teamLead: u.teamLead || populatedLead,
            teamLeadId: populatedLead?._id || (typeof u.teamLeadId === 'string' ? u.teamLeadId : u.teamLeadId?._id),
          };
        });

        // Apply search filter
        if (filters.search.trim()) {
          const searchLower = filters.search.toLowerCase();
          filteredUsers = filteredUsers.filter(
            (user: User) =>
              user.name.toLowerCase().includes(searchLower) ||
              user.email.toLowerCase().includes(searchLower) ||
              user.employeeId.toLowerCase().includes(searchLower)
          );
        }

        setUsers(filteredUsers);
        setPagination({
          page: response.data.pagination?.page || page,
          limit: response.data.pagination?.limit || pageSize,
          total: response.data.pagination?.total || filteredUsers.length,
          pages: response.data.pagination?.pages || 1,
        });
      }
    } catch (error: any) {
      showError(error.message || 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTeamLeads = async () => {
    try {
      const response: any = await usersAPI.getUsers({
        role: 'team_lead',
        isActive: true,
      });

      if (response.success && response.data) {
        setTeamLeads(
          (response.data.users || []).map((user: any) => ({
            _id: user._id,
            name: user.name,
            email: user.email,
          }))
        );
      }
    } catch (error) {
      console.error('Failed to fetch team leads:', error);
    }
  };

  useEffect(() => {
    fetchUsers(1);
  }, [filters.role, filters.isActive, pageSize]);

  useEffect(() => {
    fetchTeamLeads();
  }, []);

  const handleCreateUser = () => {
    setSelectedUser(null);
    setShowUserForm(true);
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setShowUserForm(true);
  };

  const handleDeleteUser = (user: User) => {
    setConfirmModal({ isOpen: true, user });
  };

  const handleResetDefaultPassword = (user: User) => {
    setResetPwdModal({ isOpen: true, user });
  };

  const confirmResetDefaultPassword = async () => {
    if (!resetPwdModal.user) return;
    try {
      await usersAPI.resetUserToDefaultPassword(resetPwdModal.user._id);
      showSuccess(
        'Temporary password applied. User must sign in with the server default password, then choose a new one.'
      );
      setResetPwdModal({ isOpen: false, user: null });
      fetchUsers(pagination.page);
    } catch (error: any) {
      showError(error.message || 'Failed to reset password');
    }
  };

  const confirmDeleteUser = async () => {
    if (!confirmModal.user) return;

    try {
      await usersAPI.deleteUser(confirmModal.user._id);
      showSuccess('User deactivated successfully');
      setConfirmModal({ isOpen: false, user: null });
      fetchUsers();
      fetchTeamLeads();
    } catch (error: any) {
      showError(error.message || 'Failed to deactivate user');
    }
  };

  const handleFormSuccess = () => {
    fetchUsers();
    fetchTeamLeads();
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters({ ...filters, search: e.target.value });
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (filters.search.trim() || !filters.search) {
        fetchUsers(1);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [filters.search]);

  useEffect(() => {
    localStorage.setItem('admin.userManagement.pageSize', String(pageSize));
  }, [pageSize]);

  return (
    <div className="space-y-6">
      <InfoBanner title="User Management - Call Centre Employees Only">
        Field Sales employees (FDA, TM, RM, ZM, BU Head, RDM) and hierarchy information are
        managed via the Activity API and used for reporting purposes.
      </InfoBanner>

      {/* Header – same card style as Activity Monitoring / TaskList */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900">Call Centre Users</h2>
            <p className="text-sm text-slate-600 mt-1">
              Manage Call Centre employees and their language capabilities
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className="flex items-center bg-slate-100 rounded-xl p-1">
              <button
                onClick={() => setView('users')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                  view === 'users'
                    ? 'bg-white text-green-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Users
              </button>
              <button
                onClick={() => setView('matrix')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${
                  view === 'matrix'
                    ? 'bg-white text-green-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Grid3x3 size={16} />
                Language Matrix
              </button>
            </div>
            {view === 'users' && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
                  <Filter size={16} />
                  {showFilters ? 'Hide filters' : 'Filters'}
                </Button>
                <button
                  onClick={handleCreateUser}
                  className="flex items-center gap-2 px-6 py-3 bg-green-700 text-white font-bold rounded-xl hover:bg-green-800 transition-colors"
                >
                  <Plus size={20} />
                  Create User
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters – expand when Filter button clicked (consistent with other list pages) */}
        {view === 'users' && showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, email, or employee ID..."
                  value={filters.search}
                  onChange={handleSearch}
                  className="w-full min-h-12 pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Role</label>
                <StyledSelect
                  value={filters.role}
                  onChange={(value) => setFilters({ ...filters, role: value as UserRole | '' })}
                  options={[
                    { value: '', label: 'All Roles' },
                    { value: 'cc_agent', label: 'CC Agent' },
                    { value: 'team_lead', label: 'Team Lead' },
                    { value: 'mis_admin', label: 'MIS Admin' },
                    { value: 'core_sales_head', label: 'Core Sales Head' },
                    { value: 'marketing_head', label: 'Marketing Head' },
                  ]}
                  placeholder="All Roles"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Status</label>
                <StyledSelect
                  value={filters.isActive === undefined ? '' : filters.isActive ? 'true' : 'false'}
                  onChange={(value) =>
                    setFilters({
                      ...filters,
                      isActive: value === '' ? undefined : value === 'true',
                    })
                  }
                  options={[
                    { value: '', label: 'All Status' },
                    { value: 'true', label: 'Active' },
                    { value: 'false', label: 'Inactive' },
                  ]}
                  placeholder="All Status"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content based on view */}
      {view === 'users' ? (
        <>
          {/* User List */}
          <UserList
            users={users}
            isLoading={isLoading}
            onEdit={handleEditUser}
            onDelete={handleDeleteUser}
            onResetDefaultPassword={handleResetDefaultPassword}
            currentUserId={currentUserId}
          />

          {/* Pagination - consistent with Activity Monitoring / TaskList */}
          {!isLoading && pagination.total > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Page {pagination.page} of {pagination.pages} • {pagination.total} total users
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Rows</span>
                    <StyledSelect
                      value={String(pageSize)}
                      onChange={(v) => {
                        setPageSize(Number(v));
                        setPagination((p) => ({ ...p, page: 1 }));
                      }}
                      options={USER_PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
                      className="min-w-[80px]"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fetchUsers(pagination.page - 1)}
                    disabled={pagination.page === 1 || pagination.pages <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fetchUsers(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages || pagination.pages <= 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <AgentLanguageMatrix />
      )}

      {/* User Form Modal */}
      <UserForm
        isOpen={showUserForm}
        onClose={() => setShowUserForm(false)}
        onSuccess={handleFormSuccess}
        user={selectedUser}
        teamLeads={teamLeads}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, user: null })}
        onConfirm={confirmDeleteUser}
        title="Deactivate User"
        message={`Are you sure you want to deactivate ${confirmModal.user?.name}?`}
        confirmText="Deactivate"
        cancelText="Cancel"
        confirmVariant="danger"
      />

      <ConfirmationModal
        isOpen={resetPwdModal.isOpen}
        onClose={() => setResetPwdModal({ isOpen: false, user: null })}
        onConfirm={confirmResetDefaultPassword}
        title="Reset to default password?"
        message={`Apply the server-configured temporary password for ${resetPwdModal.user?.name}? They must sign in with that password once, then set a new password before using the app. Ensure USER_DEFAULT_RESET_PASSWORD is set on the server (see deployment notes).`}
        confirmText="Reset password"
        cancelText="Cancel"
        confirmVariant="danger"
      />
    </div>
  );
};

export default UserManagementView;
