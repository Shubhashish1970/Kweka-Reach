import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sliders, List, LogOut, User as UserIcon, PhoneForwarded, Leaf } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import HeaderRoleSwitcher from '../shared/HeaderRoleSwitcher';
import SamplingControlView from './SamplingControlView';
import TaskDashboardView from './TaskDashboardView';
import CallbackRequestView from './CallbackRequestView';

type TeamLeadTab = 'sampling' | 'tasks' | 'callbacks';
const TEAM_LEAD_TAB_VALUES: TeamLeadTab[] = ['sampling', 'tasks', 'callbacks'];
const TEAM_LEAD_ACTIVE_TAB_KEY = 'teamLead.dashboard.activeTab';

const TeamLeadDashboardContainer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TeamLeadTab>(() => {
    const saved = localStorage.getItem(TEAM_LEAD_ACTIVE_TAB_KEY);
    return saved && (TEAM_LEAD_TAB_VALUES as readonly string[]).includes(saved) ? (saved as TeamLeadTab) : 'sampling';
  });

  useEffect(() => {
    localStorage.setItem(TEAM_LEAD_ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);
  const { user, logout, activeRole } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const tabs = [
    { id: 'sampling' as const, label: 'Sampling Control', icon: Sliders },
    { id: 'tasks' as const, label: 'Task Allocation', icon: List },
    { id: 'callbacks' as const, label: 'Request Callbacks', icon: PhoneForwarded },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header - Dark Slate Theme */}
      <div className="bg-slate-900 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-lime-500 rounded-xl flex items-center justify-center">
                <Leaf className="text-slate-900" size={20} />
              </div>
              <div>
                <span className="text-[10px] font-black text-lime-400 uppercase tracking-[0.2em]">Kweka Reach</span>
                <h1 className="text-xl font-black text-white">Team Lead Dashboard</h1>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <UserIcon size={16} className="text-slate-400" />
                  <span className="font-medium">{user.name}</span>
                  <span className="text-slate-500">•</span>
                  <HeaderRoleSwitcher />
                </div>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all"
                title="Logout"
              >
                <LogOut size={18} />
                <span>Logout</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 border-b border-slate-700">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 font-bold text-sm transition-colors relative ${
                    activeTab === tab.id ? 'text-lime-400' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon size={18} />
                  {tab.label}
                  {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-lime-500" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 min-w-0 overflow-x-hidden">
        {activeTab === 'sampling' && <SamplingControlView />}
        {activeTab === 'tasks' && <TaskDashboardView />}
        {activeTab === 'callbacks' && <CallbackRequestView />}
      </div>
    </div>
  );
};

export default TeamLeadDashboardContainer;

