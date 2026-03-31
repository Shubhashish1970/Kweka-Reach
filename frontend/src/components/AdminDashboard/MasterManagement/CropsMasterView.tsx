import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Loader2, Download, Search, CheckCircle, XCircle, CheckSquare, Square, Filter } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import ConfirmationModal from '../../shared/ConfirmationModal';
import * as XLSX from 'xlsx';
import ExcelUploadFlow from '../../shared/ExcelUploadFlow';
import { CROPS_MAP_FIELDS } from '../../../constants/excelUploadFields';

interface Crop {
  _id: string;
  name: string;
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

const CropsMasterView: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCrop, setEditingCrop] = useState<Crop | null>(null);
  const [formData, setFormData] = useState({ name: '', isActive: true });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const fetchCrops = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/master-data/crops/all`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setCrops(data.data.crops);
      } else {
        showError('Failed to fetch crops');
      }
    } catch (error) {
      showError('Failed to fetch crops');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCrops();
  }, []);

  const handleOpenModal = (crop?: Crop) => {
    if (crop) {
      setEditingCrop(crop);
      setFormData({ name: crop.name, isActive: crop.isActive });
    } else {
      setEditingCrop(null);
      setFormData({ name: '', isActive: true });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCrop(null);
    setFormData({ name: '', isActive: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showError('Crop name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = editingCrop
        ? `${API_BASE}/master-data/crops/${editingCrop._id}`
        : `${API_BASE}/master-data/crops`;
      const method = editingCrop ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(editingCrop ? 'Crop updated successfully' : 'Crop created successfully');
        handleCloseModal();
        fetchCrops();
      } else {
        showError(data.error?.message || 'Operation failed');
      }
    } catch (error) {
      showError('Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (crop: Crop) => {
    try {
      const response = await fetch(`${API_BASE}/master-data/crops/${crop._id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isActive: !crop.isActive }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(`Crop ${crop.isActive ? 'deactivated' : 'activated'} successfully`);
        fetchCrops();
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
    if (selectedIds.size === filteredCrops.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCrops.map((c) => c._id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`${API_BASE}/master-data/crops/bulk`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      const data = await response.json();
      if (data.success) {
        showSuccess(`${data.data.modifiedCount} crop(s) deleted successfully`);
        setSelectedIds(new Set());
        setShowBulkDeleteModal(false);
        fetchCrops();
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
      {
        'Name': 'Sample Crop 1',
        'Status (Active/Inactive)': 'Active',
      },
      {
        'Name': 'Sample Crop 2',
        'Status (Active/Inactive)': 'Active',
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'Crops');
    XLSX.writeFile(wb, 'crops_template.xlsx');
  };

  const handleDownloadData = () => {
    const excelData = crops.map(crop => ({
      'Name': crop.name,
      'Status': crop.isActive ? 'Active' : 'Inactive',
      'Created At': new Date(crop.createdAt).toLocaleDateString(),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, 'Crops');
    XLSX.writeFile(wb, `crops_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const importCropsFromMappedRows = async (mappedRows: Record<string, unknown>[]) => {
    const validRows = mappedRows.filter((row) => String(row.name ?? '').trim().length > 0);
    if (validRows.length === 0) {
      showError('Excel file must have at least one data row');
      return { ok: false, message: 'No rows with Name.' };
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
      const statusValue = String(row.isActive ?? '').trim().toLowerCase();
      const isActive = statusValue === 'active' || statusValue === '' || statusValue === 'true';

      try {
        const response = await fetch(`${API_BASE}/master-data/crops`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ name, isActive }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
          successCount++;
        } else if (response.status === 409) {
          skippedCount++;
        } else {
          errorCount++;
          const errorMsg = data.error?.message || data.error || `HTTP ${response.status}: ${response.statusText}`;
          errors.push(`${name}: ${errorMsg}`);
          console.error(`Import error for ${name}:`, { status: response.status, data });
        }
      } catch (error: any) {
        errorCount++;
        const errorMsg = error?.message || 'Network error';
        errors.push(`${name}: ${errorMsg}`);
        console.error(`Import exception for ${name}:`, error);
        if (errorCount > validRows.length * 0.5) {
          showError(`Import stopped: Too many errors (${errorCount}/${i + 1} processed). Please check the file format and try again.`);
          setIsImporting(false);
          setImportProgress(0);
          setImportTotal(0);
          return { ok: false, message: 'Too many errors.' };
        }
      }

      setImportProgress(i + 1);
    }

    setIsImporting(false);
    setImportProgress(0);
    setImportTotal(0);

    if (successCount > 0 || skippedCount > 0) {
      let message = '';
      if (successCount > 0) message = `${successCount} crop(s) imported successfully`;
      if (skippedCount > 0) {
        message += message ? `. ${skippedCount} skipped (already exist)` : `${skippedCount} crop(s) skipped (already exist)`;
      }
      if (errorCount > 0) message += `. ${errorCount} failed`;
      showSuccess(message);
      if (errorCount > 0 && errors.length > 0) console.error('Import errors:', errors);
      fetchCrops();
      return { ok: true, message };
    }
    showError(`Failed to import crops. ${errorCount} error(s)`);
    return { ok: false, message: `Failed: ${errorCount} error(s)` };
  };

  const filteredCrops = crops.filter(crop => {
    const matchesSearch = crop.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = showInactive || crop.isActive;
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
            <h2 className="text-xl font-black text-slate-900">Crops Master</h2>
            <p className="text-sm text-slate-600 mt-1">Manage crop types for call interactions</p>
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
            Add Crop
          </button>
        </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <ExcelUploadFlow
            mode="single-sheet"
            entityLabel="Crops"
            infoBullets={[
              'Download the template and fill Name (and optional Status).',
              'Upload your workbook, then map columns if headers differ.',
              'Preview rows and confirm to import crops.',
            ]}
            template={{ label: 'Download template', onDownload: () => Promise.resolve(handleDownloadTemplate()) }}
            submitLabel="Upload crops"
            mapFields={CROPS_MAP_FIELDS}
            disabled={isImporting}
            onImport={(rows) => importCropsFromMappedRows(rows)}
          />
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
              <div className="relative flex-1 min-w-0">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search crops..."
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
            <span className="text-sm font-bold text-slate-700">Importing crops...</span>
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
            Processing {importProgress} of {importTotal} crops...
          </p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-lime-600" />
          </div>
        ) : filteredCrops.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-500">No crops found</p>
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
                      {selectedIds.size === filteredCrops.length && filteredCrops.length > 0 ? (
                        <CheckSquare size={18} className="text-lime-600" />
                      ) : (
                        <Square size={18} className="text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-black text-slate-700 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredCrops.map((crop) => (
                  <tr key={crop._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleToggleSelect(crop._id)}
                        className="p-1 hover:bg-slate-200 rounded transition-colors"
                      >
                        {selectedIds.has(crop._id) ? (
                          <CheckSquare size={18} className="text-lime-600" />
                        ) : (
                          <Square size={18} className="text-slate-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-slate-900">{crop.name}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                          crop.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {crop.isActive ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {crop.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {formatDate(crop.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(crop)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleToggleActive(crop)}
                          className={`p-2 rounded-lg transition-colors ${
                            crop.isActive
                              ? 'text-red-600 hover:bg-red-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                          title={crop.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {crop.isActive ? <XCircle size={18} /> : <CheckCircle size={18} />}
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
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-xl font-black text-slate-900">
                {editingCrop ? 'Edit Crop' : 'Add New Crop'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">
                  Crop Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full min-h-12 px-4 py-3 border border-slate-200 rounded-xl bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400"
                  placeholder="Enter crop name"
                  disabled={isSubmitting}
                />
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
                  {editingCrop ? 'Update' : 'Create'}
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
        title="Delete Crops"
        message={`Are you sure you want to delete ${selectedIds.size} crop(s)? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default CropsMasterView;
