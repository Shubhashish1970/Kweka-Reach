import React, { useCallback, useState } from 'react';
import * as XLSX from 'xlsx';
import { Info, Download, FileSpreadsheet, Map as MapIcon, CheckCircle2, ArrowLeft } from 'lucide-react';
import Button from './Button';
import StyledSelect from './StyledSelect';
import {
  autoMapHeaders,
  buildDualSheetXlsxFile,
  buildHierarchyXlsxFile,
  findHierarchySheetName,
  findSheetName,
  getHeadersFromRows,
  MAP_NONE,
  readSheetAsRows,
  rowsWithCanonicalKeys,
  selectOptionsFromHeaders,
  type MapFieldDef,
} from '../../utils/excelUploadMapping';

export type ExcelImportResult = { ok: boolean; message?: string; data?: unknown };

type Step = 1 | 2 | 3;

type BaseProps = {
  entityLabel: string;
  infoTitle?: string;
  infoBullets?: string[];
  template?: { label?: string; onDownload: () => void | Promise<void> };
  submitLabel?: string;
  disabled?: boolean;
  className?: string;
};

export type ExcelUploadFlowSingleProps = BaseProps & {
  mode: 'single-sheet';
  mapFields: MapFieldDef[];
  sheetName?: string;
  onImport: (rows: Record<string, unknown>[]) => Promise<ExcelImportResult>;
};

export type ExcelUploadFlowDualFfaProps = BaseProps & {
  mode: 'dual-sheet-ffa';
  activityFields: MapFieldDef[];
  farmerFields: MapFieldDef[];
  onImportFile: (file: File) => Promise<ExcelImportResult>;
};

export type ExcelUploadFlowOptionalProps = BaseProps & {
  mode: 'optional-file';
  mapFields: MapFieldDef[];
  onImport: (file: File | null) => Promise<ExcelImportResult>;
};

export type ExcelUploadFlowProps =
  | ExcelUploadFlowSingleProps
  | ExcelUploadFlowDualFfaProps
  | ExcelUploadFlowOptionalProps;

function defaultBullets(label: string): string[] {
  return [
    `Download the template and fill in columns for ${label}.`,
    'Upload your Excel file using the area below.',
    'Map columns to fields, preview the first rows, then confirm import.',
  ];
}

export const ExcelUploadFlow: React.FC<ExcelUploadFlowProps> = (props) => {
  const {
    entityLabel,
    infoTitle = `How to add ${entityLabel} via Excel`,
    infoBullets = defaultBullets(entityLabel),
    template,
    submitLabel = 'Import',
    disabled = false,
    className = '',
  } = props;

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const [singleHeaders, setSingleHeaders] = useState<string[]>([]);
  const [singleRows, setSingleRows] = useState<Record<string, unknown>[]>([]);
  const [singleMapping, setSingleMapping] = useState<Record<string, string>>({});

  const [actHeaders, setActHeaders] = useState<string[]>([]);
  const [farmHeaders, setFarmHeaders] = useState<string[]>([]);
  const [actRows, setActRows] = useState<Record<string, unknown>[]>([]);
  const [farmRows, setFarmRows] = useState<Record<string, unknown>[]>([]);
  const [actMapping, setActMapping] = useState<Record<string, string>>({});
  const [farmMapping, setFarmMapping] = useState<Record<string, string>>({});

  const resetAll = useCallback(() => {
    setStep(1);
    setFile(null);
    setParseError(null);
    setSubmitError(null);
    setDoneMessage(null);
    setBusy(false);
    setSingleHeaders([]);
    setSingleRows([]);
    setSingleMapping({});
    setActHeaders([]);
    setFarmHeaders([]);
    setActRows([]);
    setFarmRows([]);
    setActMapping({});
    setFarmMapping({});
  }, []);

  const downloadTemplate = async () => {
    if (!template?.onDownload) return;
    await template.onDownload();
  };

  const parseAndGoStep2 = async () => {
    setParseError(null);
    setSubmitError(null);

    if (props.mode === 'optional-file' && !file) {
      setSingleHeaders([]);
      setSingleRows([]);
      setSingleMapping({});
      setStep(2);
      return;
    }

    if (!file) {
      setParseError('Please choose an Excel file.');
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });

      if (props.mode === 'single-sheet') {
        const name =
          props.sheetName && wb.SheetNames.includes(props.sheetName)
            ? props.sheetName
            : wb.SheetNames[0];
        if (!name) {
          setParseError('Workbook has no sheets.');
          return;
        }
        const rows = readSheetAsRows(wb, name);
        const headers = getHeadersFromRows(rows);
        setSingleRows(rows);
        setSingleHeaders(headers);
        setSingleMapping(autoMapHeaders(headers, props.mapFields));
        setStep(2);
        return;
      }

      if (props.mode === 'optional-file') {
        const name = findHierarchySheetName(wb);
        if (!name) {
          setParseError('Workbook has no sheets.');
          return;
        }
        const rows = readSheetAsRows(wb, name);
        const headers = getHeadersFromRows(rows);
        setSingleRows(rows);
        setSingleHeaders(headers);
        setSingleMapping(autoMapHeaders(headers, props.mapFields));
        setStep(2);
        return;
      }

      if (props.mode === 'dual-sheet-ffa') {
        const actName = findSheetName(wb, ['Activities', 'activities']);
        const farmName = findSheetName(wb, ['Farmers', 'farmers']);
        if (!actName || !farmName) {
          setParseError('Workbook must include sheets named Activities and Farmers.');
          return;
        }
        const aRows = readSheetAsRows(wb, actName);
        const fRows = readSheetAsRows(wb, farmName);
        const ah = getHeadersFromRows(aRows);
        const fh = getHeadersFromRows(fRows);
        setActRows(aRows);
        setFarmRows(fRows);
        setActHeaders(ah);
        setFarmHeaders(fh);
        setActMapping(autoMapHeaders(ah, props.activityFields));
        setFarmMapping(autoMapHeaders(fh, props.farmerFields));
        setStep(2);
        return;
      }
    } catch {
      setParseError('Could not read the Excel file.');
    }
  };

  const validateMapping = (fields: MapFieldDef[], mapping: Record<string, string>): string | null => {
    for (const f of fields) {
      if (!f.required) continue;
      const v = mapping[f.key];
      if (!v || v === MAP_NONE) return `Map a column for "${f.label}".`;
    }
    return null;
  };

  const runSubmit = async () => {
    setSubmitError(null);

    if (props.mode === 'single-sheet') {
      const err = validateMapping(props.mapFields, singleMapping);
      if (err) {
        setSubmitError(err);
        return;
      }
      setBusy(true);
      try {
        const mapped = rowsWithCanonicalKeys(singleRows, props.mapFields, singleMapping);
        const res = await props.onImport(mapped);
        if (res.ok) {
          setDoneMessage(res.message ?? 'Import completed.');
          setStep(3);
        } else {
          setSubmitError(res.message ?? 'Import failed.');
        }
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Import failed.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (props.mode === 'optional-file') {
      if (!file) {
        setBusy(true);
        try {
          const res = await props.onImport(null);
          if (res.ok) {
            setDoneMessage(res.message ?? 'Completed.');
            setStep(3);
          } else {
            setSubmitError(res.message ?? 'Request failed.');
          }
        } catch (e) {
          setSubmitError(e instanceof Error ? e.message : 'Request failed.');
        } finally {
          setBusy(false);
        }
        return;
      }
      const err = validateMapping(props.mapFields, singleMapping);
      if (err) {
        setSubmitError(err);
        return;
      }
      setBusy(true);
      try {
        const mappedFile = buildHierarchyXlsxFile(singleRows, props.mapFields, singleMapping);
        const res = await props.onImport(mappedFile);
        if (res.ok) {
          setDoneMessage(res.message ?? 'Completed.');
          setStep(3);
        } else {
          setSubmitError(res.message ?? 'Request failed.');
        }
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Request failed.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (props.mode === 'dual-sheet-ffa') {
      const e1 = validateMapping(props.activityFields, actMapping);
      if (e1) {
        setSubmitError(e1);
        return;
      }
      const e2 = validateMapping(props.farmerFields, farmMapping);
      if (e2) {
        setSubmitError(e2);
        return;
      }
      setBusy(true);
      try {
        const outFile = buildDualSheetXlsxFile(
          actRows,
          farmRows,
          props.activityFields,
          props.farmerFields,
          actMapping,
          farmMapping
        );
        const res = await props.onImportFile(outFile);
        if (res.ok) {
          setDoneMessage(res.message ?? 'Import completed.');
          setStep(3);
        } else {
          setSubmitError(res.message ?? 'Import failed.');
        }
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Import failed.');
      } finally {
        setBusy(false);
      }
    }
  };

  const mapFieldBlock = (
    title: string,
    fields: MapFieldDef[],
    headers: string[],
    mapping: Record<string, string>,
    setMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-amber-800">
        <MapIcon size={18} className="text-amber-600 shrink-0" />
        <span className="text-sm font-bold text-slate-900">{title}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
              {f.label}
              {f.required ? ' *' : ''}
            </label>
            <StyledSelect
              value={mapping[f.key] ?? MAP_NONE}
              onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
              options={selectOptionsFromHeaders(headers)}
              placeholder="Select column..."
              disabled={disabled || busy || headers.length === 0}
            />
          </div>
        ))}
      </div>
    </div>
  );

  const previewRows = (
    rows: Record<string, unknown>[],
    fields: MapFieldDef[],
    mapping: Record<string, string>,
    label: string
  ) => {
    const canonical = rowsWithCanonicalKeys(rows, fields, mapping).slice(0, 8);
    if (canonical.length === 0) {
      return <p className="text-xs text-slate-500">No rows to preview.</p>;
    }
    const keys = fields.filter((f) => mapping[f.key] && mapping[f.key] !== MAP_NONE).map((f) => f.key);
    return (
      <div className="mt-3">
        <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">{label}</div>
        <div className="overflow-auto rounded-xl border border-slate-200 max-h-48">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-500">
              <tr>
                {keys.map((k) => (
                  <th key={k} className="text-left px-2 py-2 font-semibold uppercase tracking-wider">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {canonical.map((r, i) => (
                <tr key={i} className="bg-white">
                  {keys.map((k) => (
                    <td key={k} className="px-2 py-1.5 text-slate-800 truncate max-w-[160px]">
                      {String(r[k] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const infoBar = (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-4">
      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
        <Info className="w-5 h-5 text-blue-600" />
      </div>
      <div>
        <div className="text-sm font-bold text-blue-900 mb-1">{infoTitle}</div>
        <ul className="text-sm text-blue-700 leading-relaxed space-y-1 list-disc list-inside">
          {infoBullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className={`space-y-4 ${className}`}>
      {step === 1 && (
        <>
          {infoBar}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center shrink-0">
                  <Download className="w-5 h-5 text-lime-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900">1. Get the template</div>
                  <p className="text-xs text-slate-600 mt-1">
                    Use the official columns so mapping and import stay reliable.
                  </p>
                  {template && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3 h-10 rounded-xl border border-slate-200"
                      onClick={() => void downloadTemplate()}
                      disabled={disabled}
                    >
                      <Download size={16} />
                      {template.label ?? 'Download template'}
                    </Button>
                  )}
                  {!template && (
                    <p className="text-xs text-slate-500 mt-2">Prepare your file using the field list in the next step.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-sky-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900">2. Upload your Excel file</div>
                  <p className="text-xs text-slate-600 mt-1">
                    {props.mode === 'optional-file'
                      ? 'Optional: add a Sales Hierarchy workbook, or continue without a file.'
                      : 'Choose .xlsx or .xls, then continue to column mapping.'}
                  </p>
                  <label
                    className={`mt-3 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors min-h-12 ${
                      disabled ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <FileSpreadsheet size={20} className="text-slate-500" />
                    <span className="text-sm font-medium text-slate-700 truncate">
                      {file ? file.name : props.mode === 'optional-file' ? 'Choose file (optional)' : 'Choose file'}
                    </span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      disabled={disabled}
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        setParseError(null);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
          {parseError && <div className="text-sm text-red-600">{parseError}</div>}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="primary" size="sm" disabled={disabled} onClick={() => void parseAndGoStep2()}>
              Continue to map & preview
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            onClick={() => {
              setStep(1);
              setSubmitError(null);
            }}
            disabled={busy}
          >
            <ArrowLeft size={16} />
            Back to upload
          </button>

          {props.mode === 'optional-file' && !file && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900">
              No file selected. Confirm to run without a custom hierarchy file.
            </div>
          )}

          {props.mode === 'single-sheet' &&
            mapFieldBlock('Map your columns', props.mapFields, singleHeaders, singleMapping, setSingleMapping)}
          {props.mode === 'optional-file' &&
            file &&
            mapFieldBlock('Map your columns', props.mapFields, singleHeaders, singleMapping, setSingleMapping)}

          {props.mode === 'dual-sheet-ffa' && (
            <>
              {mapFieldBlock('Activities sheet', props.activityFields, actHeaders, actMapping, setActMapping)}
              {mapFieldBlock('Farmers sheet', props.farmerFields, farmHeaders, farmMapping, setFarmMapping)}
            </>
          )}

          {props.mode === 'single-sheet' &&
            previewRows(singleRows, props.mapFields, singleMapping, 'Preview (first rows)')}
          {props.mode === 'optional-file' &&
            file &&
            previewRows(singleRows, props.mapFields, singleMapping, 'Preview (first rows)')}

          {props.mode === 'dual-sheet-ffa' && (
            <>
              {previewRows(actRows, props.activityFields, actMapping, 'Activities preview')}
              {previewRows(farmRows, props.farmerFields, farmMapping, 'Farmers preview')}
            </>
          )}

          {submitError && <div className="text-sm text-red-600">{submitError}</div>}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={busy}
              disabled={disabled}
              onClick={() => void runSubmit()}
            >
              {submitLabel}
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <div className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-lime-700" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Import complete</div>
              <p className="text-sm text-slate-600 mt-1">{doneMessage}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={resetAll}>
                Upload another file
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExcelUploadFlow;
