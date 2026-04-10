import React, { useState, useMemo, useEffect } from 'react';
import { Edit2, Trash2, UserCheck, UserX, Mail, Hash, Users as UsersIcon, ChevronUp, ChevronDown, KeyRound } from 'lucide-react';
import { UserRole } from './UserForm';

type UserTableColumnKey = 'name' | 'role' | 'languages' | 'teamLead' | 'status';

interface User {
  _id: string;
  name: string;
  email: string;
  employeeId: string;
  role: UserRole;
  roles?: UserRole[]; // Multiple roles support
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

interface UserListProps {
  users: User[];
  isLoading: boolean;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
  onResetDefaultPassword?: (user: User) => void;
  currentUserId?: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  cc_agent: 'CC Agent',
  team_lead: 'Team Lead',
  mis_admin: 'MIS Admin',
  core_sales_head: 'Core Sales Head',
  marketing_head: 'Marketing Head',
};

const ROLE_COLORS: Record<UserRole, string> = {
  cc_agent: 'bg-blue-100 text-blue-800',
  team_lead: 'bg-purple-100 text-purple-800',
  mis_admin: 'bg-green-100 text-green-800',
  core_sales_head: 'bg-orange-100 text-orange-800',
  marketing_head: 'bg-pink-100 text-pink-800',
};

const UserList: React.FC<UserListProps> = ({ users, isLoading, onEdit, onDelete, onResetDefaultPassword, currentUserId }) => {
  const [tableSort, setTableSort] = useState<{ key: UserTableColumnKey; dir: 'asc' | 'desc' }>(() => {
    const raw = localStorage.getItem('admin.userManagement.tableSort');
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
    } catch {
      // ignore
    }
    return { key: 'name', dir: 'asc' };
  });

  useEffect(() => {
    localStorage.setItem('admin.userManagement.tableSort', JSON.stringify(tableSort));
  }, [tableSort]);

  const getSortValue = (user: User, key: UserTableColumnKey): string | number => {
    switch (key) {
      case 'name':
        return (user.name || '').toLowerCase();
      case 'role': {
        const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
        return (ROLE_LABELS[roles[0]] || '').toLowerCase();
      }
      case 'languages':
        return (user.languageCapabilities || []).join(',').toLowerCase();
      case 'teamLead':
        return (user.teamLead?.name || '').toLowerCase();
      case 'status':
        return user.isActive ? 1 : 0;
      default:
        return '';
    }
  };

  const sortedUsers = useMemo(() => {
    const { key, dir } = tableSort;
    const mapped = users.map((u, idx) => ({ user: u, idx }));
    mapped.sort((a, b) => {
      const va = getSortValue(a.user, key);
      const vb = getSortValue(b.user, key);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) return a.idx - b.idx;
      return dir === 'asc' ? cmp : -cmp;
    });
    return mapped.map((m) => m.user);
  }, [users, tableSort]);

  const handleHeaderClick = (key: UserTableColumnKey) => {
    setTableSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-700 mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">Loading users...</p>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-20">
        <UsersIcon size={48} className="mx-auto text-slate-300 mb-4" />
        <p className="text-slate-600 font-medium text-lg mb-2">No users found</p>
        <p className="text-sm text-slate-500">Create a new user to get started</p>
      </div>
    );
  }

  const sortableColumns: Array<{ key: UserTableColumnKey; label: string }> = [
    { key: 'name', label: 'User' },
    { key: 'role', label: 'Role' },
    { key: 'languages', label: 'Languages' },
    { key: 'teamLead', label: 'Team Lead' },
    { key: 'status', label: 'Status' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {sortableColumns.map((col) => {
                const isSorted = tableSort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className="px-3 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-widest select-none cursor-pointer hover:bg-slate-100"
                    onClick={() => handleHeaderClick(col.key)}
                    title="Click to sort"
                  >
                    <div className="flex items-center gap-2">
                      <span>{col.label}</span>
                      {isSorted && (tableSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </div>
                  </th>
                );
              })}
              <th className="px-6 py-4 text-right text-xs font-black text-slate-500 uppercase tracking-widest">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {sortedUsers.map((user) => {
              const isCurrentUser = user._id === currentUserId;
              return (
                <tr key={user._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-slate-900">{user.name}</div>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-slate-600">
                        <div className="flex items-center gap-1">
                          <Mail size={14} />
                          <span>{user.email}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Hash size={14} />
                          <span>{user.employeeId}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {/* Show all roles if available, otherwise show single role */}
                      {(user.roles && user.roles.length > 0 ? user.roles : [user.role]).map((role, idx) => (
                        <span
                          key={role}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${ROLE_COLORS[role]} ${idx === 0 ? 'ring-1 ring-offset-1 ring-slate-300' : ''}`}
                          title={idx === 0 ? 'Primary role' : ''}
                        >
                          {ROLE_LABELS[role]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {/* Show languages if user has cc_agent role */}
                    {(user.roles?.includes('cc_agent') || user.role === 'cc_agent') && user.languageCapabilities.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.languageCapabilities.slice(0, 3).map((lang) => (
                          <span
                            key={lang}
                            className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-lg"
                          >
                            {lang}
                          </span>
                        ))}
                        {user.languageCapabilities.length > 3 && (
                          <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg">
                            +{user.languageCapabilities.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {/* Show team lead if user has cc_agent role */}
                    {(user.roles?.includes('cc_agent') || user.role === 'cc_agent') && user.teamLead ? (
                      <div className="text-sm text-slate-700">
                        <div className="font-medium">{user.teamLead.name}</div>
                        <div className="text-xs text-slate-500">{user.teamLead.email}</div>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        user.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {user.isActive ? (
                        <>
                          <UserCheck size={14} />
                          Active
                        </>
                      ) : (
                        <>
                          <UserX size={14} />
                          Inactive
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onResetDefaultPassword && (
                        <button
                          onClick={() => onResetDefaultPassword(user)}
                          disabled={isCurrentUser || !user.isActive}
                          className={`p-2 rounded-lg transition-colors ${
                            isCurrentUser || !user.isActive
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-amber-700 hover:bg-amber-50'
                          }`}
                          title={
                            isCurrentUser
                              ? 'Cannot reset your own password here'
                              : !user.isActive
                                ? 'Inactive user'
                                : 'Reset to default password (user must set a new password on next login)'
                          }
                        >
                          <KeyRound size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => onEdit(user)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit user"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => onDelete(user)}
                        disabled={isCurrentUser}
                        className={`p-2 rounded-lg transition-colors ${
                          isCurrentUser
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-red-600 hover:bg-red-50'
                        }`}
                        title={isCurrentUser ? 'Cannot delete your own account' : 'Deactivate user'}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserList;
