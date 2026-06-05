import React, { useState, useEffect } from 'react';
import { useToast } from '../../context/ToastContext';
import { ffaAPI } from '../../services/api';
import { Trash2, Database, Loader2, Settings2, Save } from 'lucide-react';
import Button from '../shared/Button';
import ConfirmationModal from '../shared/ConfirmationModal';
import ExcelUploadFlow from '../shared/ExcelUploadFlow';
import { HIERARCHY_MAP_FIELDS } from '../../constants/excelUploadFields';

type FfaAdminConfig = {
  dataSource: 'api' | 'excel';
  activitiesPullLimit: number | null;
  scheduleEnabled: boolean;
  scheduleMode: 'off' | 'hourly' | 'daily' | 'interval';
  scheduleIntervalMinutes: number;
  scheduleDailyHour: number;
  scheduleDailyMinute: number;
  scheduleTimezone: string;
  scheduledSyncActive: boolean;
  serverDefaultPullLimit: number;
  lastScheduledRunAt: string | null;
  lastScheduledRunActivitiesSynced: number | null;
  lastScheduledRunFarmersSynced: number | null;
  lastScheduledRunSkipped: boolean;
  lastScheduledRunMessage: string | null;
  nextScheduledRunAt: string | null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const DataManagementView: React.FC = () => {
  const { showToast } = useToast();
  type TxEntity =
    | 'tasks'
    | 'samplingAudits'
    | 'coolingPeriods'
    | 'samplingConfigs'
    | 'samplingRuns'
    | 'allocationRuns'
    | 'inboundQueries'
    | 'activities'
    | 'farmers';
  type MasterEntity =
    | 'crops'
    | 'products'
    | 'nonPurchaseReasons'
    | 'sentiments'
    | 'languages'
    | 'stateLanguageMappings'
    | 'users';

  const TX_OPTIONS: Array<{ key: TxEntity; label: string; detail: string }> = [
    { key: 'activities', label: 'Activities', detail: 'FFA activities imported/synced' },
    { key: 'farmers', label: 'Farmers', detail: 'Farmer profiles imported/synced' },
    { key: 'tasks', label: 'Tasks', detail: 'Call tasks / assignments' },
    { key: 'samplingAudits', label: 'Sampling audits', detail: 'Sampling audit trail' },
    { key: 'samplingRuns', label: 'Sampling runs', detail: 'Sampling run history' },
    { key: 'allocationRuns', label: 'Allocation runs', detail: 'Allocation run history' },
    { key: 'samplingConfigs', label: 'Sampling configs', detail: 'Sampling configuration records' },
    { key: 'coolingPeriods', label: 'Cooling periods', detail: 'Cooling/lockout data' },
    { key: 'inboundQueries', label: 'Inbound queries', detail: 'Inbound query records' },
  ];

  const MASTER_OPTIONS: Array<{ key: MasterEntity; label: string; detail: string }> = [
    { key: 'crops', label: 'Crops', detail: 'Crop master' },
    { key: 'products', label: 'Products', detail: 'Product master' },
    { key: 'nonPurchaseReasons', label: 'Non-purchase reasons', detail: 'Reasons master' },
    { key: 'sentiments', label: 'Sentiments', detail: 'Sentiments master' },
    { key: 'languages', label: 'Languages', detail: 'Language master' },
    { key: 'stateLanguageMappings', label: 'State-language mappings', detail: 'State-language mapping master' },
    { key: 'users', label: 'Users (hard delete)', detail: 'Deletes all users except System Administrator and your account' },
  ];

  const [selectedTx, setSelectedTx] = useState<Record<TxEntity, boolean>>(() => ({
    activities: true,
    farmers: true,
    tasks: true,
    samplingAudits: true,
    samplingRuns: true,
    allocationRuns: true,
    samplingConfigs: true,
    coolingPeriods: true,
    inboundQueries: true,
  }));
  const [selectedMasters, setSelectedMasters] = useState<Record<MasterEntity, boolean>>(() => ({
    crops: false,
    products: false,
    nonPurchaseReasons: false,
    sentiments: false,
    languages: false,
    stateLanguageMappings: false,
    users: false,
  }));
  const [autoSelectedNote, setAutoSelectedNote] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [activityCount, setActivityCount] = useState(50);
  const [farmersPerActivity, setFarmersPerActivity] = useState(12);

  const [ffaConfigLoading, setFfaConfigLoading] = useState(true);
  const [ffaConfigSaving, setFfaConfigSaving] = useState(false);
  const [ffaDataSource, setFfaDataSource] = useState<'api' | 'excel'>('api');
  const [ffaPullLimitInput, setFfaPullLimitInput] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'hourly' | 'daily' | 'interval'>('daily');
  const [scheduleDailyTime, setScheduleDailyTime] = useState('06:00');
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState(60);
  const [ffaConfigMeta, setFfaConfigMeta] = useState<Pick<
    FfaAdminConfig,
    | 'scheduledSyncActive'
    | 'serverDefaultPullLimit'
    | 'lastScheduledRunAt'
    | 'lastScheduledRunActivitiesSynced'
    | 'lastScheduledRunFarmersSynced'
    | 'lastScheduledRunSkipped'
    | 'lastScheduledRunMessage'
    | 'nextScheduledRunAt'
    | 'scheduleTimezone'
  > | null>(null);

  const applyFfaConfigToForm = (cfg: FfaAdminConfig) => {
    setFfaDataSource(cfg.dataSource);
    setFfaPullLimitInput(cfg.activitiesPullLimit === null ? '' : String(cfg.activitiesPullLimit));
    setScheduleEnabled(cfg.scheduleEnabled);
    setScheduleMode(
      cfg.scheduleMode === 'hourly' || cfg.scheduleMode === 'interval' ? cfg.scheduleMode : 'daily'
    );
    setScheduleDailyTime(`${pad2(cfg.scheduleDailyHour)}:${pad2(cfg.scheduleDailyMinute)}`);
    setScheduleIntervalMinutes(cfg.scheduleIntervalMinutes);
    setFfaConfigMeta({
      scheduledSyncActive: cfg.scheduledSyncActive,
      serverDefaultPullLimit: cfg.serverDefaultPullLimit,
      lastScheduledRunAt: cfg.lastScheduledRunAt,
      lastScheduledRunActivitiesSynced: cfg.lastScheduledRunActivitiesSynced,
      lastScheduledRunFarmersSynced: cfg.lastScheduledRunFarmersSynced,
      lastScheduledRunSkipped: cfg.lastScheduledRunSkipped,
      lastScheduledRunMessage: cfg.lastScheduledRunMessage,
      nextScheduledRunAt: cfg.nextScheduledRunAt,
      scheduleTimezone: cfg.scheduleTimezone,
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFfaConfigLoading(true);
      try {
        const res = (await ffaAPI.getFfaAdminConfig()) as any;
        const cfg = res?.data?.config as FfaAdminConfig | undefined;
        if (!cancelled && cfg) applyFfaConfigToForm(cfg);
      } catch (e) {
        if (!cancelled) showToast(e instanceof Error ? e.message : 'Failed to load FFA settings', 'error');
      } finally {
        if (!cancelled) setFfaConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const handleSaveFfaConfig = async () => {
    setFfaConfigSaving(true);
    try {
      const [hourStr, minuteStr] = scheduleDailyTime.split(':');
      const scheduleDailyHour = Number.parseInt(hourStr, 10);
      const scheduleDailyMinute = Number.parseInt(minuteStr, 10);
      const pullRaw = ffaPullLimitInput.trim();
      const activitiesPullLimit =
        pullRaw === '' ? null : Number.parseInt(pullRaw, 10);

      if (pullRaw !== '' && (!Number.isFinite(activitiesPullLimit!) || activitiesPullLimit! < 0)) {
        showToast('Pull limit must be a non-negative number or blank for server default', 'error');
        return;
      }

      const intervalMins = Math.max(10, scheduleIntervalMinutes);
      if (scheduleEnabled && scheduleMode === 'interval' && scheduleIntervalMinutes < 10) {
        showToast('Interval must be at least 10 minutes', 'error');
        return;
      }

      const res = (await ffaAPI.updateFfaAdminConfig({
        dataSource: ffaDataSource,
        activitiesPullLimit,
        scheduleEnabled: scheduleEnabled && ffaDataSource === 'api',
        scheduleMode: scheduleEnabled && ffaDataSource === 'api' ? scheduleMode : 'off',
        scheduleIntervalMinutes: intervalMins,
        scheduleDailyHour: Number.isFinite(scheduleDailyHour) ? scheduleDailyHour : 6,
        scheduleDailyMinute: Number.isFinite(scheduleDailyMinute) ? scheduleDailyMinute : 0,
      })) as any;

      const cfg = res?.data?.config as FfaAdminConfig | undefined;
      if (cfg) applyFfaConfigToForm(cfg);
      showToast(res?.message || 'FFA settings saved', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save FFA settings', 'error');
    } finally {
      setFfaConfigSaving(false);
    }
  };

  const txSelectedKeys = Object.entries(selectedTx)
    .filter(([, v]) => v)
    .map(([k]) => k as TxEntity);
  const masterSelectedKeys = Object.entries(selectedMasters)
    .filter(([, v]) => v)
    .map(([k]) => k as MasterEntity);

  const applyPreset = (preset: '1A' | '2A') => {
    setAutoSelectedNote(null);
    if (preset === '1A') {
      // 1A: Clear ALL transaction entities (safe “reset operational data”)
      setSelectedTx((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, true])) as any);
      setSelectedMasters((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, false])) as any);
      return;
    }
    // 2A: Clear ALL transaction + ALL master entities (full wipe)
    setSelectedTx((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, true])) as any);
    setSelectedMasters((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, true])) as any);
  };

  const toggleTx = (key: TxEntity, checked: boolean) => {
    setSelectedTx((prev) => {
      const next = { ...prev, [key]: checked };
      // Auto-select dependency: Activities implies Farmers.
      if (key === 'activities' && checked && !next.farmers) {
        next.farmers = true;
        setAutoSelectedNote('Auto-selected: Farmers (required when clearing Activities).');
      } else {
        setAutoSelectedNote(null);
      }
      return next;
    });
  };

  const handleClear = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const res = await ffaAPI.clearData(txSelectedKeys.length > 0, masterSelectedKeys.length > 0, {
        transactionEntities: txSelectedKeys,
        masterEntities: masterSelectedKeys,
      });
      const counts = res.data ? Object.entries(res.data).filter(([, v]) => typeof v === 'number' && v > 0) : [];
      const msg = counts.length
        ? `Cleared: ${counts.map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()}: ${v}`).join(', ')}`
        : res.message || 'Clear completed.';
      showToast(msg, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Clear failed', 'error');
    } finally {
      setClearing(false);
    }
  };

  const buildConfirmMessage = () => {
    const txLabels = TX_OPTIONS.filter((o) => selectedTx[o.key]).map((o) => o.label);
    const masterLabels = MASTER_OPTIONS.filter((o) => selectedMasters[o.key]).map((o) => o.label);
    const parts: string[] = [];
    if (txLabels.length) parts.push(`Transaction data: ${txLabels.join(', ')}.`);
    if (masterLabels.length) parts.push(`Master data: ${masterLabels.join(', ')}.`);
    if (!parts.length) return 'Please select at least one entity to clear.';
    return `${parts.join(' ')} This cannot be undone.`;
  };

  const disableClear = txSelectedKeys.length === 0 && masterSelectedKeys.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header – same card style as other list pages */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <h2 className="text-xl font-black text-slate-900 mb-1">Data Management</h2>
        <p className="text-sm text-slate-600">Clear database, configure FFA data source & sync, and generate sample data via Mock FFA API.</p>
      </div>

      {/* FFA data source & scheduled sync */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center">
            <Settings2 className="text-slate-700" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900">FFA data source & sync</h3>
            <p className="text-xs text-slate-600">
              Applies to Activity Monitoring for all admins. Scheduled sync runs on the server (incremental API pull).
            </p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {ffaConfigLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading FFA settings…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      Data source
                    </label>
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 w-fit">
                      <span className={`text-sm font-black ${ffaDataSource === 'api' ? 'text-slate-900' : 'text-slate-400'}`}>API</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ffaDataSource === 'excel'}
                        onClick={() => setFfaDataSource((p) => (p === 'api' ? 'excel' : 'api'))}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                          ffaDataSource === 'excel' ? 'bg-green-700 border-green-700' : 'bg-slate-200 border-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                            ffaDataSource === 'excel' ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <span className={`text-sm font-black ${ffaDataSource === 'excel' ? 'text-slate-900' : 'text-slate-400'}`}>Excel</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      API = NACL EMS sync buttons on Activity Monitoring. Excel = upload workbook there instead.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="ffa-admin-pull-limit" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      Pull limit (API sync)
                    </label>
                    <input
                      id="ffa-admin-pull-limit"
                      type="number"
                      min={0}
                      step={1}
                      placeholder={String(ffaConfigMeta?.serverDefaultPullLimit ?? 0)}
                      value={ffaPullLimitInput}
                      onChange={(e) => setFfaPullLimitInput(e.target.value)}
                      disabled={ffaDataSource !== 'api'}
                      className="w-full max-w-xs min-h-12 px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 disabled:bg-slate-100"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                      Blank = server default ({ffaConfigMeta?.serverDefaultPullLimit ?? 0}). 0 = all eligible per NACL EMS.
                      Used for manual and scheduled incremental syncs.
                    </p>
                  </div>
                </div>

                <div className="space-y-4 border border-slate-200 rounded-2xl p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scheduleEnabled}
                      onChange={(e) => setScheduleEnabled(e.target.checked)}
                      disabled={ffaDataSource !== 'api'}
                      className="mt-1 w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400"
                    />
                    <div>
                      <div className="text-sm font-black text-slate-900">Scheduled incremental sync</div>
                      <div className="text-xs text-slate-500">
                        Server runs incremental FFA API sync automatically ({ffaConfigMeta?.scheduleTimezone ?? 'Asia/Kolkata'}).
                      </div>
                    </div>
                  </label>

                  {ffaDataSource === 'api' && scheduleEnabled && (
                    <div className="space-y-3 pl-7">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Frequency</label>
                        <select
                          value={scheduleMode}
                          onChange={(e) => setScheduleMode(e.target.value as 'hourly' | 'daily' | 'interval')}
                          className="w-full max-w-xs min-h-10 px-3 rounded-xl border border-slate-200 text-sm"
                        >
                          <option value="daily">Daily</option>
                          <option value="hourly">Hourly</option>
                          <option value="interval">Every N minutes</option>
                        </select>
                      </div>
                      {scheduleMode === 'daily' && (
                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1">Time</label>
                          <input
                            type="time"
                            value={scheduleDailyTime}
                            onChange={(e) => setScheduleDailyTime(e.target.value)}
                            className="min-h-10 px-3 rounded-xl border border-slate-200 text-sm"
                          />
                        </div>
                      )}
                      {scheduleMode === 'interval' && (
                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1">Interval (minutes, min 10)</label>
                          <input
                            type="number"
                            min={10}
                            max={10080}
                            value={scheduleIntervalMinutes}
                            onChange={(e) => setScheduleIntervalMinutes(Number(e.target.value) || 60)}
                            className="w-full max-w-xs min-h-10 px-3 rounded-xl border border-slate-200 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {ffaConfigMeta?.scheduledSyncActive && (
                    <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                      Scheduled sync is active. The server checks every minute and runs incremental sync when due.
                      Turn off by unchecking above and saving.
                    </div>
                  )}

                  {scheduleEnabled && ffaDataSource !== 'api' && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      Scheduled sync only runs when data source is API. Switch to API or disable scheduled sync.
                    </div>
                  )}

                  {ffaConfigMeta?.lastScheduledRunAt && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                      Last scheduled run: {new Date(ffaConfigMeta.lastScheduledRunAt).toLocaleString()}
                      {ffaConfigMeta.lastScheduledRunSkipped
                        ? ` • Skipped: ${ffaConfigMeta.lastScheduledRunMessage ?? '—'}`
                        : ` • ${ffaConfigMeta.lastScheduledRunActivitiesSynced ?? 0} activities, ${ffaConfigMeta.lastScheduledRunFarmersSynced ?? 0} farmers`}
                    </div>
                  )}

                  {ffaConfigMeta?.nextScheduledRunAt && scheduleEnabled && ffaDataSource === 'api' && (
                    <div className="text-xs text-slate-500">
                      Next scheduled run (approx.): {new Date(ffaConfigMeta.nextScheduledRunAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <Button variant="primary" onClick={handleSaveFfaConfig} disabled={ffaConfigSaving}>
                {ffaConfigSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                <span>{ffaConfigSaving ? 'Saving…' : 'Save FFA settings'}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Clear database */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Trash2 className="text-red-600" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900">Clear database</h3>
            <p className="text-xs text-slate-600">Remove transaction and/or master data. Use with caution.</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Quick select</span>
            <Button variant="secondary" size="sm" onClick={() => applyPreset('1A')}>
              1A — Clear all transaction data
            </Button>
            <Button variant="secondary" size="sm" onClick={() => applyPreset('2A')}>
              2A — Clear transaction + master data
            </Button>
          </div>

          {autoSelectedNote && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {autoSelectedNote}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Transaction data</p>
                  <p className="text-xs text-slate-500">Choose exactly what to clear</p>
                </div>
                <button
                  type="button"
                  className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setAutoSelectedNote(null);
                    setSelectedTx((prev) =>
                      Object.fromEntries(Object.keys(prev).map((k) => [k, false])) as any
                    );
                  }}
                >
                  Clear selection
                </button>
              </div>
              <div className="space-y-2">
                {TX_OPTIONS.map((o) => (
                  <label key={o.key} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selectedTx[o.key]}
                      onChange={(e) => toggleTx(o.key, e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800">{o.label}</div>
                      <div className="text-xs text-slate-500">{o.detail}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Master data</p>
                  <p className="text-xs text-slate-500">Choose exactly what to clear</p>
                </div>
                <button
                  type="button"
                  className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  onClick={() =>
                    setSelectedMasters((prev) =>
                      Object.fromEntries(Object.keys(prev).map((k) => [k, false])) as any
                    )
                  }
                >
                  Clear selection
                </button>
              </div>
              <div className="space-y-2">
                {MASTER_OPTIONS.map((o) => (
                  <label key={o.key} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selectedMasters[o.key]}
                      onChange={(e) => setSelectedMasters((prev) => ({ ...prev, [o.key]: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800">{o.label}</div>
                      <div className="text-xs text-slate-500">{o.detail}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <Button
            variant="danger"
            onClick={() => setShowClearConfirm(true)}
            disabled={disableClear || clearing}
          >
            {clearing ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
            <span>{clearing ? 'Clearing…' : 'Clear'}</span>
          </Button>
        </div>
      </div>

      {/* Generate data via Mock FFA */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center">
            <Database className="text-lime-700" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900">Generate data via Mock FFA API</h3>
            <p className="text-xs text-slate-600">Set activity and farmer counts; optionally upload Sales Hierarchy Excel (Territory Name, Region, Zone Name, BU). Generate &amp; Sync does not clear any existing data—it creates more activities and farmers in the same territories with the same TM and FDA names already in the database, so data stays close to reality. Data uses Indian names.</p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Number of activities</label>
              <input
                type="number"
                min={1}
                max={500}
                value={activityCount}
                onChange={(e) => setActivityCount(Math.max(1, Math.min(500, Number(e.target.value) || 50)))}
                className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Farmers per activity</label>
              <input
                type="number"
                min={1}
                max={50}
                value={farmersPerActivity}
                onChange={(e) => setFarmersPerActivity(Math.max(1, Math.min(50, Number(e.target.value) || 12)))}
                className="w-full min-h-12 px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              />
            </div>
          </div>
          <div className="border-t border-slate-200 pt-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">Sales Hierarchy Excel (optional)</label>
            <p className="text-xs text-slate-500 mb-3">
              Download the template for labelled columns (Territory Name, Region, Zone Name, BU). You can run Generate &amp; sync without a file, or map columns then confirm.
            </p>
            <ExcelUploadFlow
              mode="optional-file"
              entityLabel="Sales Hierarchy"
              infoTitle="How to use Sales Hierarchy Excel with Mock FFA"
              infoBullets={[
                'Download the hierarchy template and fill territory, region, zone, and BU.',
                'Optionally upload your file — or continue without a file to use defaults.',
                'Map columns if headers differ, preview, then Generate & sync.',
              ]}
              template={{
                label: 'Download template',
                onDownload: async () => {
                  await ffaAPI.downloadHierarchyTemplate();
                  showToast('Template downloaded', 'success');
                },
              }}
              submitLabel="Generate & sync"
              mapFields={HIERARCHY_MAP_FIELDS}
              onImport={async (mappedOrNull) => {
                try {
                  const res = await ffaAPI.seedFromHierarchy(mappedOrNull, activityCount, farmersPerActivity);
                  const data = res?.data as
                    | { seed?: { activitiesGenerated?: number; farmersGenerated?: number }; hierarchyRowsUsed?: number }
                    | undefined;
                  const seedMsg = data?.seed
                    ? `Generated ${data.seed.activitiesGenerated ?? 0} activities, ${data.seed.farmersGenerated ?? 0} farmers.`
                    : '';
                  const hierarchyMsg = data?.hierarchyRowsUsed ? ` Hierarchy: ${data.hierarchyRowsUsed} rows used.` : '';
                  showToast(`${res?.message ?? 'Done.'} ${seedMsg}${hierarchyMsg} Full sync started – check sync progress.`, 'success');
                  return { ok: true, message: res?.message ?? 'Generate & sync completed.' };
                } catch (e) {
                  showToast(e instanceof Error ? e.message : 'Generate & sync failed', 'error');
                  return { ok: false, message: e instanceof Error ? e.message : 'Generate & sync failed' };
                }
              }}
            />
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClear}
        title="Clear database"
        message={buildConfirmMessage()}
        confirmText="Clear"
        confirmVariant="danger"
        isLoading={clearing}
      />
    </div>
  );
};

export default DataManagementView;
