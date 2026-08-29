import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Users, Activity as ActivityIcon, List, LogOut, User as UserIcon, Database, Leaf, TrendingUp, Settings2, Archive } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import HeaderRoleSwitcher from '../shared/HeaderRoleSwitcher';
import ActivitySamplingView from './ActivitySamplingView';
import AgentQueueView from './AgentQueueView';
import TaskList from '../TaskList';
import MasterManagementView from './MasterManagement/MasterManagementView';
import ActivityEmsProgressView from './ActivityEmsProgressView';
import DataManagementView from './DataManagementView';
import StockParkingView from './StockParkingView';

type AdminTab = 'activities' | 'queues' | 'tasks' | 'masters' | 'dashboard' | 'data' | 'stock';
const ADMIN_TAB_VALUES: AdminTab[] = ['activities', 'queues', 'tasks', 'masters', 'dashboard', 'data', 'stock'];
const ADMIN_ACTIVE_TAB_KEY = 'admin.dashboard.activeTab';

const AdminDashboardContainer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const saved = localStorage.getItem(ADMIN_ACTIVE_TAB_KEY);
    return saved && (ADMIN_TAB_VALUES as readonly string[]).includes(saved) ? (saved as AdminTab) : 'activities';
  });

  useEffect(() => {
    localStorage.setItem(ADMIN_ACTIVE_TAB_KEY, activeTab);
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
    { id: 'activities' as const, label: 'Activity Monitoring', icon: ActivityIcon },
    { id: 'queues' as const, label: 'Agent Queues', icon: Users },
    { id: 'tasks' as const, label: 'Task Management', icon: List },
    { id: 'stock' as const, label: 'Stock Parking', icon: Archive },
    { id: 'masters' as const, label: 'Master Management', icon: Database },
    { id: 'dashboard' as const, label: 'Activity EMS Progress', icon: TrendingUp },
    { id: 'data' as const, label: 'Data Management', icon: Settings2 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      {/* Header - Dark Slate Theme */}
      <div className="bg-slate-900 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-lime-500 rounded-xl flex items-center justify-center">
                <Leaf className="text-slate-900" size={20} />
              </div>
              <div>
                <span className="text-[10px] font-black text-lime-400 uppercase tracking-[0.2em]">Kweka Reach</span>
                <h1 className="text-xl font-black text-white">Admin Dashboard</h1>
              </div>
            </div>
            
            {/* User Menu & Logout */}
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

          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-700">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 font-bold text-sm transition-colors relative ${
                    activeTab === tab.id
                      ? 'text-lime-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon size={18} />
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-lime-500"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content - prevent horizontal overflow at 100% zoom */}
      <div className="max-w-7xl mx-auto w-full min-w-0 px-4 sm:px-6 py-6 overflow-x-hidden">
        {activeTab === 'dashboard' && <ActivityEmsProgressView />}
        {activeTab === 'activities' && <ActivitySamplingView />}
        {activeTab === 'queues' && <AgentQueueView />}
        {activeTab === 'tasks' && <TaskList />}
        {activeTab === 'stock' && <StockParkingView />}
        {activeTab === 'masters' && <MasterManagementView />}
        {activeTab === 'data' && <DataManagementView />}
      </div>
    </div>
  );
};

export default AdminDashboardContainer;
