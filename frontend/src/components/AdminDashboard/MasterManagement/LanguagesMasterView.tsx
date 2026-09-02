import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Loader2, Download, Upload, Search, CheckCircle, XCircle, Globe, Trash2, CheckSquare, Square, Filter } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import ConfirmationModal from '../../shared/ConfirmationModal';
import * as XLSX from 'xlsx';
import ExcelUploadFlow from '../../shared/ExcelUploadFlow';
import { LANGUAGES_MAP_FIELDS } from '../../../constants/excelUploadFields';

interface Language {
  _id: string;
  name: string;
  code: string;
  displayOrder: number;
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

const LanguagesMasterView: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLanguage, setEditingLanguage] = useState<Language | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', displayOrder: 0, isActive: true });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const fetchLanguages = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/master-data/languages/all`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setLanguages(data.data.languages);
      } else {
        showError('Failed to fetch languages');
      }
    } catch (error) {
      showError('Failed to fetch languages');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLanguages();
  }, []);

  const handleOpenModal = (language?: Language) => {
    if (language) {
      setEditingLanguage(language);
      setFormData({
        name: language.name,
        code: language.code,
        displayOrder: language.displayOrder,
        isActive: language.isActive,
      });
    } else {
      setEditingLanguage(null);
      setFormData({ name: '', code: '', displayOrder: languages.length, isActive: true });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingLanguage(null);
    setFormData({ name: '', code: '', displayOrder: 0, isActive: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = editingLanguage
        ? `${API_BASE}/master-data/languages/${editingLanguage._id}`
        : `${API_BASE}/master-data/languages`;
      const method = editingLanguage ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(editingLanguage ? 'Language updated successfully' : 'Language created successfully');
        handleCloseModal();
        fetchLanguages();
      } else {
        showError(data.error?.message || 'Failed to save language');
      }
    } catch (error) {
      showError('Failed to save language');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (language: Language) => {
    try {
      const response = await fetch(`${API_BASE}/master-data/languages/${language._id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isActive: !language.isActive }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(`Language ${language.isActive ? 'deactivated' : 'activated'} successfully`);
        fetchLanguages();
      } else {
        showError(data.error?.message || 'Failed to update language');
      }
    } catch (error) {
      showError('Failed to update language');
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
    if (selectedIds.size === filteredLanguages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLanguages.map((l) => l._id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`${API_BASE}/master-data/languages/bulk`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(`${data.data.modifiedCount} language(s) deleted successfully`);
        setSelectedIds(new Set());
        setShowBulkDeleteModal(false);
        fetchLanguages();
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
      { 'Name': 'Language 1', 'Code': 'L1', 'Display Order': 1, 'Active': 'Active' },
      { 'Name': 'Language 2', 'Code': 'L2', 'Display Order': 2, 'Active': 'Active' },
      { 'Name': 'Language 3', 'Code': 'L3', 'Display Order': 3, 'Active': 'Active' },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'Languages');
    XLSX.writeFile(wb, 'languages_template.xlsx');
  };

  const handleExport = () => {
    const excelData = languages.map(l => ({
      'Name': l.name,
      'Code': l.code,
      'Display Order': l.displayOrder,
      'Active': l.isActive ? 'Active' : 'Inactive',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, 'Languages');
    XLSX.writeFile(wb, `languages_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const importLanguagesFromMappedRows = async (mappedRows: Record<string, unknown>[]) => {
    const validRows = mappedRows.filter(
      (row) => String(row.name ?? '').trim().length > 0 && String(row.code ?? '').trim().length > 0
    );
    if (validRows.length === 0) {
      showError('Excel must have at least one row with Name and Code');
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
      const name = String(row.name ?? '').trim();
      const code = String(row.code ?? '').trim();
      const displayOrder = parseInt(String(row.displayOrder ?? '0'), 10) || 0;
      const activeValue = String(row.isActive ?? '').trim().toLowerCase();
      const isActive = activeValue === 'active' || activeValue === '' || activeValue === 'true';

      try {
        const response = await fetch(`${API_BASE}/master-data/languages`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ name, code, displayOrder, isActive }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
          successCount++;
        } else if (response.status === 409) {
          skippedCount++;
        } else {
          errorCount++;
          const errorMsg = data.error?.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
          errors.push(`${name} (${code}): ${errorMsg}`);
          console.error(`Import error for ${name} (${code}):`, { status: response.status, data });
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error?.message || 'Network error';
        errors.push(`${name} (${code}): ${errorMsg}`);
        console.error(`Import exception for ${name} (${code}):`, error);
      }

      setImportProgress(i + 1);
    }

    setIsImporting(false);
    setImportProgress(0);
    setImportTotal(0);

    if (successCount > 0 || skippedCount > 0) {
      let message = '';
      if (successCount > 0) message = `${successCount} language(s) imported successfully`;
      if (skippedCount > 0) {
        message += message ? `. ${skippedCount} skipped (already exist)` : `${skippedCount} language(s) skipped (already exist)`;
      }
      if (errorCount > 0) message += `. ${errorCount} failed`;
      showSuccess(message);
      if (errorCount > 0 && errors.length > 0) console.error('Import errors:', errors);
      fetchLanguages();
      return { ok: true, message };
    }
    showError(`Failed to import languages. ${errorCount} error(s)`);
    return { ok: false, message: `Failed: ${errorCount} error(s)` };
  };

  const filteredLanguages = languages.filter((language) => {
    const matchesSearch =
      language.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      language.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesActive = showInactive || language.isActive;
    return matchesSearch && matchesActive;
  });

  return (
    <div className="space-y-6">
      {/* Header – same card style as other list pages */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">Languages Master</h2>
            <p className="text-sm text-slate-600 mt-1">Manage languages for agent capabilities and farmer preferences</p>
          </div>
        <div className="flex items-center gap-3">
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
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              <Trash2 size={16} />
              Delete ({selectedIds.size})
            </button>
          )}
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Download size={16} />
            Template
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Upload size={16} />
            Export
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition-colors"
          >
            <Plus size={18} />
            Add Language
          </button>
        </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <ExcelUploadFlow
            mode="single-sheet"
            entityLabel="Languages"
            infoBullets={[
              'Download the template with Name, Code, Display Order, and Active columns.',
              'Upload your file, map columns if needed, and preview rows.',
              'Confirm to import languages (duplicates are skipped).',
            ]}
            template={{ label: 'Download template', onDownload: () => Promise.resolve(handleDownloadTemplate()) }}
            submitLabel="Upload languages"
            mapFields={LANGUAGES_MAP_FIELDS}
            disabled={isImporting}
            onImport={(rows) => importLanguagesFromMappedRows(rows)}
          />
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 max-w-md">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search languages..."
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
            <span className="text-sm font-bold text-slate-700">Importing languages...</span>
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
            Processing {importProgress} of {importTotal} languages...
          </p>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-lime-600" />
        </div>
      ) : filteredLanguages.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {searchTerm ? 'No languages match your search' : 'No languages found'}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-12">
                  <button
                    onClick={handleSelectAll}
                    className="p-1 hover:bg-slate-200 rounded transition-colors"
                    title="Select all"
                  >
                    {selectedIds.size === filteredLanguages.length && filteredLanguages.length > 0 ? (
                      <CheckSquare size={18} className="text-lime-600" />
                    ) : (
                      <Square size={18} className="text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Language
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Code
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Order
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredLanguages.map((language) => (
                <tr key={language._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleSelect(language._id)}
                      className="p-1 hover:bg-slate-200 rounded transition-colors"
                    >
                      {selectedIds.has(language._id) ? (
                        <CheckSquare size={18} className="text-lime-600" />
                      ) : (
                        <Square size={18} className="text-slate-400" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Globe size={16} className="text-lime-600" />
                      <span className="font-medium text-slate-800">{language.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-slate-100 text-slate-700 text-xs font-mono rounded">
                      {language.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{language.displayOrder}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(language)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                        language.isActive
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      {language.isActive ? (
                        <>
                          <CheckCircle size={12} /> Active
                        </>
                      ) : (
                        <>
                          <XCircle size={12} /> Inactive
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleOpenModal(language)}
                      className="p-2 text-slate-500 hover:text-lime-600 hover:bg-lime-50 rounded-lg transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">
                {editingLanguage ? 'Edit Language' : 'Add New Language'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Language Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter language name"
                  className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Language Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="e.g., HI, TE, MR"
                  maxLength={5}
                  className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">2-5 character code (auto-capitalized)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Display Order</label>
                <input
                  type="number"
                  value={formData.displayOrder}
                  onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })}
                  min="0"
                  className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border border-slate-200 text-lime-600 focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                />
                <label htmlFor="isActive" className="text-sm text-slate-700">
                  Active
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-lime-600 text-white rounded-lg hover:bg-lime-700 transition-colors disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  {editingLanguage ? 'Update' : 'Create'}
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
        title="Delete Languages"
        message={`Are you sure you want to delete ${selectedIds.size} language(s)? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default LanguagesMasterView;
