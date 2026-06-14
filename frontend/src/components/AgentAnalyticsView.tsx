import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Clock, Phone, CheckCircle, XCircle, AlertCircle, ChevronRight } from 'lucide-react';
import Button from './shared/Button';
import { tasksAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import { type DateRangePreset, getPresetRange, formatPretty, formatDateIST } from '../utils/dateRangeUtils';

type Bucket = 'daily' | 'weekly' | 'monthly';

// Always use daily bucket for consistent date-wise trend

const fmtDuration = (secs: number) => {
  const s = Number(secs || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
};

// Format period for chart display (short)
const formatPeriod = (period: string, bucket: Bucket) => {
  if (bucket === 'daily') {
    return formatDateIST(period) || period;
  }
  return period;
};

const formatPeriodTable = (period: string) => formatDateIST(period) || period;

const AgentAnalyticsView: React.FC = () => {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [showDetailTable, setShowDetailTable] = useState(true);

  const [filters, setFilters] = useState<{ dateFrom: string; dateTo: string }>({ dateFrom: '', dateTo: '' });

  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('Last 7 days');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const getRange = (preset: DateRangePreset) =>
    getPresetRange(preset, filters.dateFrom || undefined, filters.dateTo || undefined);

  // Always use daily bucket for date-wise trend
  const bucket: Bucket = 'daily';

  useEffect(() => {
    if (filters.dateFrom || filters.dateTo) return;
    const r = getRange('Last 7 days');
    setFilters({ dateFrom: r.start, dateTo: r.end });
    setDraftStart(r.start);
    setDraftEnd(r.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (datePickerRef.current && !datePickerRef.current.contains(t)) setIsDatePickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isDatePickerOpen]);

  const load = async () => {
    setIsLoading(true);
    try {
      const res: any = await tasksAPI.getOwnAnalytics({
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        bucket,
      });
      setData(res?.data || null);
    } catch (e: any) {
      toast.showError(e?.message || 'Failed to load performance');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateFrom, filters.dateTo, bucket]);

  const totals = useMemo(() => data?.totals || {}, [data]);
  const trend = useMemo(() => Array.isArray(data?.trend) ? data.trend : [], [data]);

  // Calculate max for bar chart scaling
  const maxAttempted = useMemo(() => {
    if (!trend.length) return 1;
    return Math.max(...trend.map((r: any) => r.attempted || 0), 1);
  }, [trend]);

  // Outcome breakdown for visual display
  const outcomeData = useMemo(() => [
    { label: 'Completed', value: totals.successful || 0, color: 'bg-green-500', textColor: 'text-green-700' },
    { label: 'Unsuccessful', value: totals.unsuccessful || 0, color: 'bg-red-500', textColor: 'text-red-700' },
    { label: 'In Progress', value: totals.inProgress || 0, color: 'bg-amber-500', textColor: 'text-amber-700' },
  ], [totals]);

  // Outbound status breakdown
  const outboundData = useMemo(() => [
    { label: 'Connected', value: totals.connected || 0, color: 'bg-green-400' },
    { label: 'No Answer', value: totals.noAnswer || 0, color: 'bg-slate-400' },
    { label: 'Disconnected', value: totals.disconnected || 0, color: 'bg-orange-400' },
    { label: 'Invalid', value: totals.invalid || 0, color: 'bg-red-400' },
    { label: 'Incoming N/A', value: totals.incomingNA || 0, color: 'bg-purple-400' },
  ].filter(d => d.value > 0), [totals]);

  const totalOutbound = useMemo(() => outboundData.reduce((sum, d) => sum + d.value, 0), [outboundData]);

  // Sync draft dates from filters
  const syncDraftFromFilters = () => {
    setDraftStart(filters.dateFrom);
    setDraftEnd(filters.dateTo);
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900">Performance Dashboard</h2>
              <p className="text-sm text-slate-600">Your call performance metrics and trends</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Date Range Selector - Matching AgentHistoryView style */}
              <div className="relative" ref={datePickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsDatePickerOpen((prev) => {
                      const next = !prev;
                      if (!prev && next) syncDraftFromFilters();
                      return next;
                    });
                  }}
                  className="min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 flex items-center justify-between min-w-[280px]"
                >
                  <span className="truncate">
                    {selectedPreset}
                    {filters.dateFrom && filters.dateTo ? ` • ${formatPretty(filters.dateFrom)} - ${formatPretty(filters.dateTo)}` : ''}
                  </span>
                  <span className="text-slate-400 font-black">▾</span>
                </button>

                {isDatePickerOpen && (
                  <div className="absolute z-50 mt-2 right-0 w-[720px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                    <div className="flex">
                      {/* Presets */}
                      <div className="w-56 border-r border-slate-200 bg-slate-50 p-2">
                        {([
                          'Custom',
                          'Today',
                          'Yesterday',
                          'This week (Sun - Today)',
                          'Last 7 days',
                          'Last week (Sun - Sat)',
                          'Last 28 days',
                          'Last 30 days',
                          'Last 90 days',
                          'YTD',
                        ] as DateRangePreset[]).map((p) => {
                          const isActive = selectedPreset === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setSelectedPreset(p);
                                const { start, end } = getRange(p);
                                setDraftStart(start);
                                setDraftEnd(end);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors ${
                                isActive ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-700 hover:bg-white'
                              }`}
                            >
                              {p}
                            </button>
                          );
                        })}
                      </div>

                      {/* Date inputs */}
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div className="flex-1">
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">Start date</p>
                            <input
                              type="date"
                              value={draftStart}
                              onChange={(e) => {
                                setSelectedPreset('Custom');
                                setDraftStart(e.target.value);
                              }}
                              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">End date</p>
                            <input
                              type="date"
                              value={draftEnd}
                              onChange={(e) => {
                                setSelectedPreset('Custom');
                                setDraftEnd(e.target.value);
                              }}
                              className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              setIsDatePickerOpen(false);
                              syncDraftFromFilters();
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFilters({ dateFrom: draftStart, dateTo: draftEnd });
                              setIsDatePickerOpen(false);
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={load} disabled={isLoading}>
                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Tasks Due */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-slate-100">
                <AlertCircle size={14} className="text-slate-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tasks Due</span>
            </div>
            <div className="text-3xl font-black text-slate-900">{totals.totalTasksDue || 0}</div>
            <div className="text-xs text-slate-500 mt-1">In date range</div>
          </div>

          {/* Total Calls */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-blue-50">
                <Phone size={14} className="text-blue-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Calls Made</span>
            </div>
            <div className="text-3xl font-black text-slate-900">{totals.attempted || 0}</div>
            <div className="text-xs text-slate-500 mt-1">{totals.callsPerDay || 0}/day avg</div>
          </div>

          {/* Call Efficiency */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${(totals.efficiency || 0) >= 80 ? 'bg-green-50' : (totals.efficiency || 0) >= 50 ? 'bg-amber-50' : 'bg-red-50'}`}>
                {(totals.efficiency || 0) >= 80 ? (
                  <TrendingUp size={14} className="text-green-600" />
                ) : (totals.efficiency || 0) >= 50 ? (
                  <TrendingUp size={14} className="text-amber-600" />
                ) : (
                  <TrendingDown size={14} className="text-red-600" />
                )}
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Efficiency</span>
            </div>
            <div className={`text-3xl font-black ${(totals.efficiency || 0) >= 80 ? 'text-green-600' : (totals.efficiency || 0) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
              {totals.efficiency || 0}%
            </div>
            <div className="text-xs text-slate-500 mt-1">Calls / Tasks due</div>
          </div>

          {/* Success Rate */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${(totals.successRate || 0) >= 50 ? 'bg-green-50' : 'bg-amber-50'}`}>
                {(totals.successRate || 0) >= 50 ? (
                  <TrendingUp size={14} className="text-green-600" />
                ) : (
                  <TrendingDown size={14} className="text-amber-600" />
                )}
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Success Rate</span>
            </div>
            <div className={`text-3xl font-black ${(totals.successRate || 0) >= 50 ? 'text-green-600' : 'text-amber-600'}`}>
              {totals.successRate || 0}%
            </div>
            <div className="text-xs text-slate-500 mt-1">{totals.successful || 0} completed</div>
          </div>

          {/* Avg Duration */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-purple-50">
                <Clock size={14} className="text-purple-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg Duration</span>
            </div>
            <div className="text-3xl font-black text-slate-900">{fmtDuration(totals.avgConnectedDurationSeconds || 0)}</div>
            <div className="text-xs text-slate-500 mt-1">{totals.connectedCount || 0} connected</div>
          </div>

          {/* Outcomes Summary */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-slate-100">
                <CheckCircle size={14} className="text-slate-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Outcomes</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <CheckCircle size={14} className="text-green-500" />
                <span className="text-sm font-bold text-slate-700">{totals.successful || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <XCircle size={14} className="text-red-500" />
                <span className="text-sm font-bold text-slate-700">{totals.unsuccessful || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock size={14} className="text-amber-500" />
                <span className="text-sm font-bold text-slate-700">{totals.inProgress || 0}</span>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5">Completed • Unsuccessful • In Progress</div>
          </div>
        </div>

        {/* Trend Chart + Outcome Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Trend Line Chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-black text-slate-900">Call Trend</h3>
                <p className="text-[10px] text-slate-500">Daily breakdown</p>
              </div>
            </div>
            
            {trend.length > 0 ? (
              <div>
                {/* Line Chart */}
                <div className="relative h-48">
                  {/* Y-axis labels */}
                  <div className="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-[10px] text-slate-400 font-medium">
                    <span>{maxAttempted}</span>
                    <span>{Math.round(maxAttempted / 2)}</span>
                    <span>0</span>
                  </div>
                  
                  {/* Chart area */}
                  <div className="ml-10 h-full">
                    <svg className="w-full h-full" viewBox={`0 0 ${Math.max(trend.length * 80, 300)} 160`} preserveAspectRatio="none">
                      {/* Grid lines */}
                      <line x1="0" y1="0" x2="100%" y2="0" stroke="#e2e8f0" strokeWidth="1" />
                      <line x1="0" y1="80" x2="100%" y2="80" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4" />
                      <line x1="0" y1="160" x2="100%" y2="160" stroke="#e2e8f0" strokeWidth="1" />
                      
                      {/* Total Attempted Line */}
                      <polyline
                        fill="none"
                        stroke="#64748b"
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={trend.map((row: any, i: number) => {
                          const x = trend.length === 1 ? 150 : (i / (trend.length - 1)) * (Math.max(trend.length * 80, 300) - 40) + 20;
                          const y = 160 - (row.attempted / maxAttempted) * 150;
                          return `${x},${y}`;
                        }).join(' ')}
                      />
                      
                      {/* Completed Line */}
                      <polyline
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={trend.map((row: any, i: number) => {
                          const x = trend.length === 1 ? 150 : (i / (trend.length - 1)) * (Math.max(trend.length * 80, 300) - 40) + 20;
                          const y = 160 - (row.successful / maxAttempted) * 150;
                          return `${x},${y}`;
                        }).join(' ')}
                      />
                      
                      {/* Unsuccessful Line */}
                      <polyline
                        fill="none"
                        stroke="#f87171"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={trend.map((row: any, i: number) => {
                          const x = trend.length === 1 ? 150 : (i / (trend.length - 1)) * (Math.max(trend.length * 80, 300) - 40) + 20;
                          const y = 160 - (row.unsuccessful / maxAttempted) * 150;
                          return `${x},${y}`;
                        }).join(' ')}
                      />
                      
                      {/* Data points with values */}
                      {trend.map((row: any, i: number) => {
                        const x = trend.length === 1 ? 150 : (i / (trend.length - 1)) * (Math.max(trend.length * 80, 300) - 40) + 20;
                        const yAttempted = 160 - (row.attempted / maxAttempted) * 150;
                        const ySuccess = 160 - (row.successful / maxAttempted) * 150;
                        const yUnsuccess = 160 - (row.unsuccessful / maxAttempted) * 150;
                        
                        return (
                          <g key={row.period}>
                            {/* Attempted dot */}
                            <circle cx={x} cy={yAttempted} r="4" fill="#64748b" />
                            <text x={x} y={yAttempted - 8} textAnchor="middle" className="text-[9px] fill-slate-500 font-medium">{row.attempted}</text>
                            
                            {/* Success dot */}
                            <circle cx={x} cy={ySuccess} r="4" fill="#22c55e" />
                            {row.successful > 0 && (
                              <text x={x} y={ySuccess - 8} textAnchor="middle" className="text-[9px] fill-green-600 font-bold">{row.successful}</text>
                            )}
                            
                            {/* Unsuccessful dot */}
                            <circle cx={x} cy={yUnsuccess} r="4" fill="#f87171" />
                            {row.unsuccessful > 0 && (
                              <text x={x} y={yUnsuccess + 14} textAnchor="middle" className="text-[9px] fill-red-500 font-bold">{row.unsuccessful}</text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                    
                    {/* X-axis labels */}
                    <div className="flex justify-between mt-1 px-2">
                      {trend.map((row: any) => (
                        <span key={row.period} className="text-[10px] text-slate-500 font-medium">
                          {formatPeriod(row.period, bucket)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
                No data for selected range
              </div>
            )}
            
            {/* Legend */}
            <div className="flex items-center gap-6 mt-4 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-slate-500 rounded" />
                <span className="text-[10px] text-slate-600">Total</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-green-500 rounded" />
                <span className="text-[10px] text-slate-600">Completed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-red-400 rounded" />
                <span className="text-[10px] text-slate-600">Unsuccessful</span>
              </div>
            </div>
          </div>

          {/* Outbound Status Breakdown */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 mb-4">Call Status Breakdown</h3>
            
            {outboundData.length > 0 ? (
              <div className="space-y-3">
                {outboundData.map((item) => {
                  const pct = totalOutbound > 0 ? Math.round((item.value / totalOutbound) * 100) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-600">{item.label}</span>
                        <span className="text-xs font-bold text-slate-900">{item.value} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
                No outbound data
              </div>
            )}
          </div>
        </div>

        {/* Detailed Table (Collapsible) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDetailTable(!showDetailTable)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50"
          >
            <span className="text-sm font-black text-slate-700">Detailed Breakdown</span>
            <ChevronRight size={16} className={`text-slate-400 transition-transform ${showDetailTable ? 'rotate-90' : ''}`} />
          </button>
          
          {showDetailTable && (
            <div className="px-4 pb-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    <th className="text-left py-2 pr-4">Period</th>
                    <th className="text-right py-2 pr-4">Attempted</th>
                    <th className="text-right py-2 pr-4">Completed</th>
                    <th className="text-right py-2 pr-4">Unsuccessful</th>
                    <th className="text-right py-2 pr-4">In Progress</th>
                    <th className="text-right py-2">Success %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trend.map((r: any) => {
                    const successPct = r.attempted > 0 ? Math.round((r.successful / r.attempted) * 100) : 0;
                    return (
                      <tr key={r.period} className="hover:bg-slate-50">
                        <td className="py-2 pr-4 font-medium text-slate-900">{formatPeriodTable(r.period)}</td>
                        <td className="py-2 pr-4 text-right font-bold text-slate-700">{r.attempted}</td>
                        <td className="py-2 pr-4 text-right font-bold text-green-600">{r.successful}</td>
                        <td className="py-2 pr-4 text-right font-bold text-red-600">{r.unsuccessful}</td>
                        <td className="py-2 pr-4 text-right font-bold text-amber-600">{r.inProgress}</td>
                        <td className="py-2 text-right font-bold text-slate-700">{successPct}%</td>
                      </tr>
                    );
                  })}
                  {!trend.length && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No data for selected range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentAnalyticsView;
