import React, { useState, useEffect } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { usersAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import LanguageSelector from './LanguageSelector';
import StyledSelect from '../shared/StyledSelect';

export type UserRole = 'cc_agent' | 'team_lead' | 'mis_admin' | 'core_sales_head' | 'marketing_head';
export type AgentKind = 'human' | 'virtual';

interface User {
  _id?: string;
  name: string;
  email: string;
  employeeId: string;
  role: UserRole;
  roles?: UserRole[];
  agentKind?: AgentKind;
  languageCapabilities: string[];
  teamLeadId?: string;
  teamLead?: {
    _id: string;
    name: string;
    email: string;
  };
  isActive: boolean;
}

interface UserFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user?: User | null;
  teamLeads?: Array<{ _id: string; name: string; email: string }>;
}

const CALL_CENTRE_ROLES: Array<{ value: UserRole; label: string; description: string }> = [
  { value: 'cc_agent', label: 'CC Agent', description: 'Make calls & log interactions' },
  { value: 'team_lead', label: 'Team Lead', description: 'Manage team & sampling' },
  { value: 'mis_admin', label: 'MIS Admin', description: 'Full system access' },
  { value: 'core_sales_head', label: 'Core Sales Head', description: 'Field team dashboards' },
  { value: 'marketing_head', label: 'Marketing Head', description: 'Product reports' },
];

const UserForm: React.FC<UserFormProps> = ({ isOpen, onClose, onSuccess, user, teamLeads = [] }) => {
  const { showError, showSuccess } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    employeeId: '',
    role: 'cc_agent' as UserRole, // Primary role (first selected)
    roles: ['cc_agent'] as UserRole[], // All assigned roles
    languageCapabilities: [] as string[],
    agentKind: 'human' as AgentKind,
    teamLeadId: '',
    isActive: true,
  });

  const isEditMode = !!user;

  useEffect(() => {
    if (isOpen) {
      if (user) {
        // Get roles from user, fallback to single role if not present
        const userRoles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
        setFormData({
          name: user.name || '',
          email: user.email || '',
          password: '', // Don't pre-fill password
          employeeId: user.employeeId || '',
          role: user.role || 'cc_agent',
          roles: userRoles,
          languageCapabilities: user.languageCapabilities || [],
          agentKind: user.agentKind === 'virtual' ? 'virtual' : 'human',
          teamLeadId: user.teamLeadId?.toString() || user.teamLead?._id || '',
          isActive: user.isActive !== undefined ? user.isActive : true,
        });
      } else {
        setFormData({
          name: '',
          email: '',
          password: '',
          employeeId: '',
          role: 'cc_agent',
          roles: ['cc_agent'],
          languageCapabilities: [],
          agentKind: 'human',
          teamLeadId: '',
          isActive: true,
        });
      }
    }
  }, [isOpen, user]);

  // UX: if creating a CC Agent and there is exactly one active Team Lead, preselect it
  useEffect(() => {
    if (!isOpen) return;
    if (isEditMode) return;
    if (!formData.roles.includes('cc_agent')) return;
    if (formData.teamLeadId) return;
    if (teamLeads.length === 1) {
      setFormData((prev) => ({ ...prev, teamLeadId: teamLeads[0]._id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, formData.roles, teamLeads]);

  // Toggle a role on/off
  const toggleRole = (role: UserRole) => {
    setFormData((prev) => {
      const newRoles = prev.roles.includes(role)
        ? prev.roles.filter(r => r !== role)
        : [...prev.roles, role];
      
      // Ensure at least one role is selected
      if (newRoles.length === 0) {
        return prev;
      }
      
      // Set primary role to the first in the list
      const primaryRole = newRoles[0];
      
      return {
        ...prev,
        roles: newRoles,
        role: primaryRole,
        // Clear team lead if cc_agent is no longer in roles
        teamLeadId: newRoles.includes('cc_agent') ? prev.teamLeadId : '',
        // Clear languages if cc_agent is no longer in roles
        languageCapabilities: newRoles.includes('cc_agent') ? prev.languageCapabilities : [],
        agentKind: newRoles.includes('cc_agent') ? prev.agentKind : 'human',
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.name.trim()) {
      showError('Name is required');
      return;
    }
    if (!formData.email.trim()) {
      showError('Email is required');
      return;
    }
    if (!formData.employeeId.trim()) {
      showError('Employee ID is required');
      return;
    }
    if (!isEditMode && !formData.password.trim() && formData.agentKind !== 'virtual') {
      showError('Password is required for new users');
      return;
    }
    if (formData.roles.length === 0) {
      showError('At least one role must be selected');
      return;
    }
    if (formData.roles.includes('cc_agent') && formData.languageCapabilities.length === 0) {
      showError('At least one language capability is required when CC Agent role is assigned');
      return;
    }
    if (formData.roles.includes('cc_agent') && !formData.teamLeadId) {
      showError('Team Lead is required when CC Agent role is assigned (needed for task allocation)');
      return;
    }

    setIsSubmitting(true);
    try {
      const submitData: any = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        employeeId: formData.employeeId.trim(),
        role: formData.roles[0], // Primary role is the first selected
        roles: formData.roles, // All assigned roles
        languageCapabilities: formData.languageCapabilities,
        isActive: formData.isActive,
      };

      // Only include password for new human users; virtual agents use server default
      if (!isEditMode && formData.agentKind !== 'virtual' && formData.password.trim()) {
        submitData.password = formData.password;
      }

      // Include teamLeadId if cc_agent is one of the roles
      if (formData.roles.includes('cc_agent')) {
        submitData.teamLeadId = formData.teamLeadId;
        submitData.agentKind = formData.agentKind;
      }

      if (isEditMode && user?._id) {
        await usersAPI.updateUser(user._id, submitData);
        showSuccess('User updated successfully');
      } else {
        await usersAPI.createUser(submitData);
        showSuccess('User created successfully');
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      showError(error.message || 'Failed to save user');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const hasAgentRole = formData.roles.includes('cc_agent');
  const showTeamLeadField = hasAgentRole;
  const showLanguageField = hasAgentRole;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-2xl font-black text-slate-900">
            {isEditMode ? 'Edit User' : 'Create User'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
            disabled={isSubmitting}
          >
            <X size={24} className="text-slate-600" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              required
              disabled={isSubmitting || isEditMode}
            />
            {isEditMode && (
              <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
            )}
          </div>

          {/* Employee ID */}
          <div>
            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
              Employee ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.employeeId}
              onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
              className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              required
              disabled={isSubmitting || isEditMode}
            />
            {isEditMode && (
              <p className="text-xs text-slate-500 mt-1">Employee ID cannot be changed</p>
            )}
          </div>

          {/* Password (only for new human CC agents; virtual agents use server default) */}
          {!isEditMode && formData.agentKind !== 'virtual' && (
            <div>
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                required
                disabled={isSubmitting}
                minLength={6}
              />
              <p className="text-xs text-slate-500 mt-1">Minimum 6 characters</p>
            </div>
          )}

          {!isEditMode && formData.agentKind === 'virtual' && formData.roles.includes('cc_agent') && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
              A server-configured default password will be applied for this voice agent (
              <span className="font-mono text-xs">USER_VIRTUAL_AGENT_DEFAULT_PASSWORD</span>
              ). No password change is required on first login.
            </div>
          )}

          {/* Roles (Multi-select) */}
          <div>
            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
              Roles <span className="text-red-500">*</span>
              <span className="text-xs font-normal text-slate-500 ml-2">(Select one or more)</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CALL_CENTRE_ROLES.map((role) => {
                const isSelected = formData.roles.includes(role.value);
                const isPrimary = formData.roles[0] === role.value;
                return (
                  <button
                    key={role.value}
                    type="button"
                    onClick={() => toggleRole(role.value)}
                    disabled={isSubmitting}
                    className={`relative flex items-start gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? 'border-lime-500 bg-lime-50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <div className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center mt-0.5 ${
                      isSelected
                        ? 'bg-lime-500 border-lime-500'
                        : 'border-slate-300 bg-white'
                    }`}>
                      {isSelected && <Check size={14} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                          {role.label}
                        </span>
                        {isPrimary && isSelected && (
                          <span className="px-1.5 py-0.5 bg-lime-500 text-white text-[9px] font-bold uppercase rounded">
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{role.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              The first selected role becomes the primary/default role. Users with multiple roles can switch between them.
            </p>
          </div>

          {/* Team Lead (only for CC Agent) */}
          {showTeamLeadField && (
            <div>
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                Team Lead <span className="text-red-500">*</span>
              </label>
              <StyledSelect
                value={formData.teamLeadId}
                onChange={(value) => setFormData({ ...formData, teamLeadId: value })}
                options={[
                  { value: '', label: 'Select Team Lead' },
                  ...teamLeads.map((lead) => ({
                    value: lead._id,
                    label: `${lead.name} (${lead.email})`,
                  })),
                ]}
                disabled={isSubmitting}
                placeholder="Select Team Lead"
              />
              {!teamLeads.length && (
                <p className="text-xs text-amber-700 mt-1">
                  No active Team Leads found. Create a Team Lead first.
                </p>
              )}
            </div>
          )}

          {/* Agent kind (only for CC Agent) */}
          {showLanguageField && (
            <div>
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                Agent Type
              </label>
              <div className="flex gap-3">
                {([
                  { value: 'human' as AgentKind, label: 'Human (manual dialer)' },
                  { value: 'virtual' as AgentKind, label: 'Virtual (voice agent)' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setFormData({ ...formData, agentKind: opt.value })}
                    className={`flex-1 px-4 py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                      formData.agentKind === opt.value
                        ? 'border-lime-500 bg-lime-50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Language Capabilities (only for CC Agent) */}
          {showLanguageField && (
            <LanguageSelector
              selectedLanguages={formData.languageCapabilities}
              onChange={(languages) => setFormData({ ...formData, languageCapabilities: languages })}
              required={formData.role === 'cc_agent'}
              disabled={isSubmitting}
            />
          )}

          {/* Is Active */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-5 h-5 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              disabled={isSubmitting}
            />
            <label htmlFor="isActive" className="text-sm font-medium text-slate-700">
              Active User
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2.5 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={18} className="animate-spin" />}
              {isEditMode ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserForm;
