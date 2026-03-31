import React, { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { ffaAPI } from '../../services/api';
import { Trash2, Database, Loader2 } from 'lucide-react';
import Button from '../shared/Button';
import ConfirmationModal from '../shared/ConfirmationModal';
import ExcelUploadFlow from '../shared/ExcelUploadFlow';
import { HIERARCHY_MAP_FIELDS } from '../../constants/excelUploadFields';

const DataManagementView: React.FC = () => {
  const { showToast } = useToast();
  const [clearTransactions, setClearTransactions] = useState(true);
  const [clearMasters, setClearMasters] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [activityCount, setActivityCount] = useState(50);
  const [farmersPerActivity, setFarmersPerActivity] = useState(12);

  const handleClear = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const res = await ffaAPI.clearData(clearTransactions, clearMasters);
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header – same card style as other list pages */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <h2 className="text-xl font-black text-slate-900 mb-1">Data Management</h2>
        <p className="text-sm text-slate-600">Clear database and generate sample data via Mock FFA API (Indian names, optional Sales Hierarchy Excel).</p>
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
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={clearTransactions}
                onChange={(e) => setClearTransactions(e.target.checked)}
                className="w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              />
              <span className="text-sm font-medium text-slate-800">Clear transaction data</span>
            </label>
            <span className="text-xs text-slate-500">(activities, farmers, tasks, sampling, cooling, etc.)</span>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={clearMasters}
                onChange={(e) => setClearMasters(e.target.checked)}
                className="w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
              />
              <span className="text-sm font-medium text-slate-800">Clear master data</span>
            </label>
            <span className="text-xs text-slate-500">(crops, products, languages, sentiments, state-language, etc.)</span>
          </div>
          <Button
            variant="danger"
            onClick={() => setShowClearConfirm(true)}
            disabled={(!clearTransactions && !clearMasters) || clearing}
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
        message={
          clearTransactions && clearMasters
            ? 'This will permanently delete all transaction data and all master data. This cannot be undone.'
            : clearTransactions
              ? 'This will permanently delete all transaction data (activities, farmers, tasks, sampling, etc.). Masters will be kept.'
              : 'This will permanently delete all master data (crops, products, languages, etc.). Transaction data will be kept.'
        }
        confirmText="Clear"
        confirmVariant="danger"
        isLoading={clearing}
      />
    </div>
  );
};

export default DataManagementView;
