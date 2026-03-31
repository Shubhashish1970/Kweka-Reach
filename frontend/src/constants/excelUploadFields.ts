import type { MapFieldDef } from '../utils/excelUploadMapping';

/** FFA Activity Monitoring – Activities sheet (keys match backend import). */
export const FFA_ACTIVITY_MAP_FIELDS: MapFieldDef[] = [
  { key: 'activityId', label: 'Activity ID', required: true },
  { key: 'type', label: 'Type', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'officerId', label: 'Officer ID', required: true },
  { key: 'officerName', label: 'Officer Name', required: true },
  { key: 'location', label: 'Location', required: true },
  { key: 'territory', label: 'Territory', required: true },
  { key: 'state', label: 'State', required: true },
  { key: 'territoryName', label: 'Territory Name' },
  { key: 'zoneName', label: 'Zone Name' },
  { key: 'buName', label: 'BU' },
  { key: 'tmEmpCode', label: 'TM Emp Code' },
  { key: 'tmName', label: 'TM Name' },
  { key: 'crops', label: 'Crops' },
  { key: 'products', label: 'Products' },
];

/** FFA Activity Monitoring – Farmers sheet. */
export const FFA_FARMER_MAP_FIELDS: MapFieldDef[] = [
  { key: 'activityId', label: 'Activity ID', required: true },
  { key: 'farmerId', label: 'Farmer ID' },
  { key: 'name', label: 'Name', required: true },
  { key: 'mobileNumber', label: 'Mobile Number', required: true },
  { key: 'location', label: 'Location', required: true },
  { key: 'photoUrl', label: 'Photo URL' },
  { key: 'crops', label: 'Crops' },
];

/** Data Management – optional Sales Hierarchy remap → standard column titles. */
export const HIERARCHY_MAP_FIELDS: MapFieldDef[] = [
  { key: 'territoryCode', label: 'Territory Code' },
  { key: 'territoryName', label: 'Territory Name', required: true },
  { key: 'regionCode', label: 'Region Code' },
  { key: 'region', label: 'Region', required: true },
  { key: 'zoneCode', label: 'Zone Code' },
  { key: 'zoneName', label: 'Zone Name', required: true },
  { key: 'bu', label: 'BU', required: true },
];

export const CROPS_MAP_FIELDS: MapFieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'isActive', label: 'Status / Active' },
];

export const LANGUAGES_MAP_FIELDS: MapFieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'code', label: 'Code', required: true },
  { key: 'displayOrder', label: 'Display Order' },
  { key: 'isActive', label: 'Active' },
];

export const STATE_LANGUAGE_MAP_FIELDS: MapFieldDef[] = [
  { key: 'state', label: 'State', required: true },
  { key: 'primaryLanguage', label: 'Primary Language', required: true },
  { key: 'secondaryLanguages', label: 'Secondary Languages' },
  { key: 'isActive', label: 'Status' },
];

export const PRODUCTS_MAP_FIELDS: MapFieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'category', label: 'Category' },
  { key: 'segment', label: 'Segment' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'productCode', label: 'Product Code' },
  { key: 'focusProducts', label: 'Focus Products' },
  { key: 'isActive', label: 'Status' },
];
