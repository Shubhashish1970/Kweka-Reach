import { useAuth } from '../context/AuthContext';

export type AgentAccentTheme = 'human' | 'virtual';

export function getAgentAccentTheme(agentKind?: string | null): AgentAccentTheme {
  return agentKind === 'virtual' ? 'virtual' : 'human';
}

export type AgentAccentClasses = {
  brandLabel: string;
  sideNavActiveBordered: string;
  sideNavActive: string;
  iconAccent: string;
  loadTasksBtn: string;
  globeIcon: string;
  notetakerActive: string;
  notetakerIdle: string;
  mobileTabActive: string;
  fabOpenDialer: string;
  loader: string;
  loaderSm: string;
  loaderDark: string;
  focusRingField: string;
  tabActive: string;
  tabActiveText: string;
  avatarGradient: string;
  rowSelectedBg: string;
  callBtn: string;
  callBtnIcon: string;
  phoneIcon: string;
  badge: string;
  btnSolid: string;
  btnSolidLight: string;
  filterChipActive: string;
  chartIcon: string;
};

const HUMAN_ACCENT: AgentAccentClasses = {
  brandLabel: 'text-lime-400',
  sideNavActiveBordered: 'bg-lime-500/20 text-lime-400 border-lime-500/30 shadow-lg',
  sideNavActive: 'text-lime-400 bg-lime-500/20',
  iconAccent: 'text-lime-400',
  loadTasksBtn: 'bg-lime-500 text-slate-900 hover:bg-lime-400',
  globeIcon: 'text-lime-400',
  notetakerActive: 'text-lime-400 bg-lime-500/15 hover:bg-lime-500/25',
  notetakerIdle: 'text-slate-300 hover:text-lime-400 hover:bg-slate-800',
  mobileTabActive: 'text-lime-400 bg-lime-500/20',
  fabOpenDialer: 'bg-lime-500 hover:bg-lime-400 text-slate-900',
  loader: 'text-lime-600',
  loaderSm: 'text-lime-700',
  loaderDark: 'text-lime-400',
  focusRingField: 'focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400',
  tabActive: 'bg-slate-900 text-lime-400',
  tabActiveText: 'text-lime-400',
  avatarGradient: 'bg-gradient-to-br from-green-500 to-green-700',
  rowSelectedBg: 'bg-green-50',
  callBtn: 'border-lime-400/80 bg-lime-500/15 text-lime-800 hover:bg-lime-500/25',
  callBtnIcon: 'text-lime-700',
  phoneIcon: 'text-lime-600',
  badge: 'bg-lime-100 text-lime-800 border-lime-200',
  btnSolid: 'bg-green-700 text-white border-green-700 shadow-sm',
  btnSolidLight: 'bg-green-400 text-white border-green-400 shadow-sm',
  filterChipActive: 'bg-lime-50 border-lime-200 text-lime-700',
  chartIcon: 'text-lime-600',
};

const VIRTUAL_ACCENT: AgentAccentClasses = {
  brandLabel: 'text-violet-400',
  sideNavActiveBordered: 'bg-violet-500/20 text-violet-400 border-violet-500/30 shadow-lg',
  sideNavActive: 'text-violet-400 bg-violet-500/20',
  iconAccent: 'text-violet-400',
  loadTasksBtn: 'bg-violet-500 text-white hover:bg-violet-400',
  globeIcon: 'text-violet-400',
  notetakerActive: 'text-violet-400 bg-violet-500/15 hover:bg-violet-500/25',
  notetakerIdle: 'text-slate-300 hover:text-violet-400 hover:bg-slate-800',
  mobileTabActive: 'text-violet-400 bg-violet-500/20',
  fabOpenDialer: 'bg-violet-500 hover:bg-violet-400 text-white',
  loader: 'text-violet-600',
  loaderSm: 'text-violet-700',
  loaderDark: 'text-violet-400',
  focusRingField: 'focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400',
  tabActive: 'bg-slate-900 text-violet-400',
  tabActiveText: 'text-violet-400',
  avatarGradient: 'bg-gradient-to-br from-violet-500 to-violet-700',
  rowSelectedBg: 'bg-violet-50',
  callBtn: 'border-violet-400/80 bg-violet-500/15 text-violet-800 hover:bg-violet-500/25',
  callBtnIcon: 'text-violet-700',
  phoneIcon: 'text-violet-600',
  badge: 'bg-violet-200 text-violet-900 border-violet-300',
  btnSolid: 'bg-violet-700 text-white border-violet-700 shadow-sm',
  btnSolidLight: 'bg-violet-400 text-white border-violet-400 shadow-sm',
  filterChipActive: 'bg-violet-50 border-violet-200 text-violet-700',
  chartIcon: 'text-violet-600',
};

export function getAgentAccentClasses(theme: AgentAccentTheme): AgentAccentClasses {
  return theme === 'virtual' ? VIRTUAL_ACCENT : HUMAN_ACCENT;
}

export function useAgentAccent() {
  const { user } = useAuth();
  const theme = getAgentAccentTheme(user?.agentKind);
  return {
    theme,
    accent: getAgentAccentClasses(theme),
    isVoiceAgent: theme === 'virtual',
  };
}
