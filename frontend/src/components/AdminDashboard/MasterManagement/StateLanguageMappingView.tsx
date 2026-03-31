import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Loader2, Download, Search, CheckCircle, XCircle, Globe, Check, Trash2, CheckSquare, Square, Filter } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import StyledSelect from '../../shared/StyledSelect';
import ConfirmationModal from '../../shared/ConfirmationModal';
import * as XLSX from 'xlsx';
import ExcelUploadFlow from '../../shared/ExcelUploadFlow';
import { STATE_LANGUAGE_MAP_FIELDS } from '../../../constants/excelUploadFields';

interface StateLanguageMapping {
  _id: string;
  state: string;
  primaryLanguage: string;
  secondaryLanguages: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

// Helper to get auth headers including active role
const getAuthHeaders = () => {
  const token = localStorage.getItem('authToken');
  const activeRole = localStorage.getItem('activeRole');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(activeRole && { 'X-Active-Role': activeRole }),
  };
};

// Fallback languages in case API fails
const FALLBACK_LANGUAGES = [
  'Hindi',
  'Telugu',
  'Marathi',
  'Kannada',
  'Tamil',
  'Bengali',
  'Oriya',
  'English',
  'Malayalam',
];

const StateLanguageMappingView: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [mappings, setMappings] = useState<StateLanguageMapping[]>([]);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>(FALLBACK_LANGUAGES);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<StateLanguageMapping | null>(null);
  const [formData, setFormData] = useState({ 
    state: '', 
    primaryLanguage: 'Hindi',
    secondaryLanguages: [] as string[],
    isActive: true 
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const fetchLanguages = async () => {
    try {
      const response = await fetch(`${API_BASE}/master-data/languages`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success && data.data.languages.length > 0) {
        setAvailableLanguages(data.data.languages.map((l: any) => l.name));
      }
    } catch (error) {
      console.warn('Failed to fetch languages from API, using fallback');
    }
  };

  const fetchMappings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/master-data/state-languages/all`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setMappings(data.data.mappings);
      } else {
        showError('Failed to fetch state-language mappings');
      }
    } catch (error) {
      showError('Failed to fetch state-language mappings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLanguages();
    fetchMappings();
  }, []);

  const handleOpenModal = (mapping?: StateLanguageMapping) => {
    if (mapping) {
      setEditingMapping(mapping);
      setFormData({ 
        state: mapping.state, 
        primaryLanguage: mapping.primaryLanguage,
        secondaryLanguages: mapping.secondaryLanguages || [],
        isActive: mapping.isActive 
      });
    } else {
      setEditingMapping(null);
      setFormData({ 
        state: '', 
        primaryLanguage: 'Hindi',
        secondaryLanguages: [],
        isActive: true 
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingMapping(null);
    setFormData({ state: '', primaryLanguage: 'Hindi', secondaryLanguages: [], isActive: true });
  };

  const handleToggleSecondaryLanguage = (lang: string) => {
    if (lang === formData.primaryLanguage) return; // Can't add primary as secondary
    
    setFormData(prev => ({
      ...prev,
      secondaryLanguages: prev.secondaryLanguages.includes(lang)
        ? prev.secondaryLanguages.filter(l => l !== lang)
        : [...prev.secondaryLanguages, lang]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.state.trim()) {
      showError('State name is required');
      return;
    }
    if (!formData.primaryLanguage) {
      showError('Primary language is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = editingMapping
        ? `${API_BASE}/master-data/state-languages/${editingMapping._id}`
        : `${API_BASE}/master-data/state-languages`;
      const method = editingMapping ? 'PUT' : 'POST';

      // Remove primary language from secondary if present
      const cleanedSecondary = formData.secondaryLanguages.filter(l => l !== formData.primaryLanguage);

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...formData,
          secondaryLanguages: cleanedSecondary,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(editingMapping ? 'Mapping updated successfully' : 'Mapping created successfully');
        handleCloseModal();
        fetchMappings();
      } else {
        showError(data.error?.message || 'Operation failed');
      }
    } catch (error) {
      showError('Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (mapping: StateLanguageMapping) => {
    try {
      const response = await fetch(`${API_BASE}/master-data/state-languages/${mapping._id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isActive: !mapping.isActive }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(`Mapping ${mapping.isActive ? 'deactivated' : 'activated'} successfully`);
        fetchMappings();
      } else {
        showError(data.error?.message || 'Operation failed');
      }
    } catch (error) {
      showError('Operation failed');
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredMappings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMappings.map((m) => m._id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`${API_BASE}/master-data/state-languages/bulk`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(`${data.data.modifiedCount} mapping(s) deleted successfully`);
        setSelectedIds(new Set());
        setShowBulkDeleteModal(false);
        fetchMappings();
      } else {
        showError(data.error?.message || 'Bulk delete failed');
      }
    } catch (error) {
      showError('Bulk delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const sampleData = [
      { 'State': 'State 1', 'Primary Language': 'Language 1', 'Secondary Languages (comma-separated)': '', 'Status (Active/Inactive)': 'Active' },
      { 'State': 'State 2', 'Primary Language': 'Language 2', 'Secondary Languages (comma-separated)': 'Language 3,Language 4', 'Status (Active/Inactive)': 'Active' },
      { 'State': 'State 3', 'Primary Language': 'Language 5', 'Secondary Languages (comma-separated)': 'Language 6', 'Status (Active/Inactive)': 'Active' },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'State-Language Mapping');
    XLSX.writeFile(wb, 'state_language_mapping_template.xlsx');
  };

  const handleDownloadData = () => {
    const excelData = mappings.map(m => ({
      'State': m.state,
      'Primary Language': m.primaryLanguage,
      'Secondary Languages': (m.secondaryLanguages || []).join(', '),
      'Status': m.isActive ? 'Active' : 'Inactive',
      'Created At': new Date(m.createdAt).toLocaleDateString(),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, 'State-Language Mapping');
    XLSX.writeFile(wb, `state_language_mapping_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const importMappingsFromMappedRows = async (mappedRows: Record<string, unknown>[]) => {
    const validRows = mappedRows.filter(
      (row) =>
        String(row.state ?? '').trim().length > 0 && String(row.primaryLanguage ?? '').trim().length > 0
    );
    if (validRows.length === 0) {
      showError('Excel must have at least one row with State and Primary Language');
      return { ok: false, message: 'No valid rows.' };
    }

    setIsImporting(true);
    setImportProgress(0);
    setImportTotal(validRows.length);
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const state = String(row.state ?? '').trim();
      const primaryLanguage = String(row.primaryLanguage ?? '').trim();
      const secondaryStr = String(row.secondaryLanguages ?? '').trim();
      const secondaryLanguages = secondaryStr
        ? secondaryStr.split(',').map((lang) => lang.trim()).filter(Boolean)
        : [];
      const statusValue = String(row.isActive ?? '').trim().toLowerCase();
      const isActive = statusValue === 'active' || statusValue === '' || statusValue === 'true';

      try {
        const response = await fetch(`${API_BASE}/master-data/state-languages`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ state, primaryLanguage, secondaryLanguages, isActive }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
          successCount++;
        } else if (response.status === 409) {
          skippedCount++;
        } else {
          errorCount++;
          const errorMsg = data.error?.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
          errors.push(`${state}: ${errorMsg}`);
          console.error(`Import error for ${state}:`, { status: response.status, data });
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error?.message || 'Network error';
        errors.push(`${state}: ${errorMsg}`);
        console.error(`Import exception for ${state}:`, error);
      }

      setImportProgress(i + 1);
    }

    setIsImporting(false);
    setImportProgress(0);
    setImportTotal(0);

    if (successCount > 0 || skippedCount > 0) {
      let message = '';
      if (successCount > 0) message = `${successCount} mapping(s) imported successfully`;
      if (skippedCount > 0) {
        message += message ? `. ${skippedCount} skipped (already exist)` : `${skippedCount} mapping(s) skipped (already exist)`;
      }
      if (errorCount > 0) message += `. ${errorCount} failed`;
      showSuccess(message);
      if (errorCount > 0 && errors.length > 0) console.error('Import errors:', errors);
      fetchMappings();
      return { ok: true, message };
    }
    showError(`Failed to import mappings. ${errorCount} error(s)`);
    return { ok: false, message: `Failed: ${errorCount} error(s)` };
  };

  const filteredMappings = mappings.filter(m => {
    const matchesSearch = m.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.primaryLanguage.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = showInactive || m.isActive;
    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header – same card style as other list pages */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">State-Language Mapping</h2>
            <p className="text-sm text-slate-600 mt-1">Map states to their primary and secondary languages</p>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <Filter size={16} />
            {showFilters ? 'Hide filters' : 'Filters'}
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors"
            >
              <Trash2 size={16} />
              Delete ({selectedIds.size})
            </button>
          )}
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <Download size={16} />
            Template
          </button>
          <button
            onClick={handleDownloadData}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
          >
            <Plus size={16} />
            Add Mapping
          </button>
        </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <ExcelUploadFlow
            mode="single-sheet"
            entityLabel="State–Language mappings"
            infoBullets={[
              'Download the template with State, Primary Language, Secondary Languages, and Status.',
              'Upload and map columns if headers differ from the template.',
              'Preview and confirm to create mappings (existing rows are skipped).',
            ]}
            template={{ label: 'Download template', onDownload: () => Promise.resolve(handleDownloadTemplate()) }}
            submitLabel="Upload mappings"
            mapFields={STATE_LANGUAGE_MAP_FIELDS}
            disabled={isImporting}
            onImport={(rows) => importMappingsFromMappedRows(rows)}
          />
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
              <div className="relative flex-1 min-w-0">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by state or language..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full min-h-12 pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
                Show inactive
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Import Progress Bar */}
      {isImporting && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-slate-700">Importing state-language mappings...</span>
            <span className="text-sm font-bold text-slate-600">
              {importProgress} / {importTotal}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-lime-600 h-2.5 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${importTotal > 0 ? (importProgress / importTotal) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Processing {importProgress} of {importTotal} mappings...
          </p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-lime-600" />
          </div>
        ) : filteredMappings.length === 0 ? (
          <div className="text-center py-20">
            <Globe size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500">No state-language mappings found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider w-12">
                    <button
                      onClick={handleSelectAll}
                      className="p-1 hover:bg-slate-200 rounded transition-colors"
                      title="Select all"
                    >
                      {selectedIds.size === filteredMappings.length && filteredMappings.length > 0 ? (
                        <CheckSquare size={18} className="text-lime-600" />
                      ) : (
                        <Square size={18} className="text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">State</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">Primary Language</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">Secondary Languages</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredMappings.map((mapping) => (
                  <tr key={mapping._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleToggleSelect(mapping._id)}
                        className="p-1 hover:bg-slate-200 rounded transition-colors"
                      >
                        {selectedIds.has(mapping._id) ? (
                          <CheckSquare size={18} className="text-lime-600" />
                        ) : (
                          <Square size={18} className="text-slate-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-slate-900">{mapping.state}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                        <Globe size={14} />
                        {mapping.primaryLanguage}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {mapping.secondaryLanguages && mapping.secondaryLanguages.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {mapping.secondaryLanguages.map((lang) => (
                            <span
                              key={lang}
                              className="px-2 py-1 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg"
                            >
                              {lang}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                          mapping.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {mapping.isActive ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {mapping.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(mapping)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleToggleActive(mapping)}
                          className={`p-2 rounded-lg transition-colors ${
                            mapping.isActive
                              ? 'text-red-600 hover:bg-red-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                          title={mapping.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {mapping.isActive ? <XCircle size={18} /> : <CheckCircle size={18} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <h3 className="text-xl font-black text-slate-900">
                {editingMapping ? 'Edit State-Language Mapping' : 'Add New Mapping'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                  State Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                  placeholder="Enter state name"
                  disabled={isSubmitting}
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                  Primary Language <span className="text-red-500">*</span>
                </label>
                <StyledSelect
                  value={formData.primaryLanguage}
                  onChange={(newPrimary) => {
                    setFormData({ 
                      ...formData, 
                      primaryLanguage: newPrimary,
                      // Remove from secondary if it was there
                      secondaryLanguages: formData.secondaryLanguages.filter(l => l !== newPrimary)
                    });
                  }}
                  options={availableLanguages.map((lang) => ({ value: lang, label: lang }))}
                  disabled={isSubmitting}
                  placeholder="Select primary language"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                  Secondary Languages
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {availableLanguages.filter(l => l !== formData.primaryLanguage).map((lang) => {
                    const isSelected = formData.secondaryLanguages.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleToggleSecondaryLanguage(lang)}
                        disabled={isSubmitting}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg border-2 transition-all text-sm ${
                          isSelected
                            ? 'border-lime-500 bg-lime-50 text-lime-900'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <span>{lang}</span>
                        {isSelected && <Check size={14} className="text-lime-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>

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
                  Active
                </label>
              </div>
              
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={isSubmitting}
                  className="px-6 py-2.5 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 size={18} className="animate-spin" />}
                  {editingMapping ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showBulkDeleteModal}
        onClose={() => setShowBulkDeleteModal(false)}
        onConfirm={handleBulkDelete}
        title="Delete State-Language Mappings"
        message={`Are you sure you want to delete ${selectedIds.size} mapping(s)? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default StateLanguageMappingView;
