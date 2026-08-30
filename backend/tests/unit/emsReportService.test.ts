import { compareEmsReportByHierarchy, computePurchaseIntentionPct, isWillingNo, isWillingYes } from '../../src/services/emsReportService.js';

describe('compareEmsReportByHierarchy', () => {
  it('sorts by BU when groupBy is bu', () => {
    const rows = [
      { groupLabel: 'Crop', buName: 'Crop' },
      { groupLabel: 'Agri', buName: 'Agri' },
    ];
    rows.sort((a, b) => compareEmsReportByHierarchy(a, b, 'bu'));
    expect(rows.map((r) => r.groupLabel)).toEqual(['Agri', 'Crop']);
  });

  it('sorts by BU then Zone when groupBy is zone', () => {
    const rows = [
      { groupLabel: 'South', buName: 'B', zoneName: 'South' },
      { groupLabel: 'North', buName: 'A', zoneName: 'North' },
      { groupLabel: 'East', buName: 'A', zoneName: 'East' },
    ];
    rows.sort((a, b) => compareEmsReportByHierarchy(a, b, 'zone'));
    expect(rows.map((r) => r.groupLabel)).toEqual(['East', 'North', 'South']);
  });

  it('sorts by BU, Zone, Region when groupBy is region', () => {
    const rows = [
      { groupLabel: 'Telangana', buName: 'B', zoneName: 'Z1', regionName: 'Telangana' },
      { groupLabel: 'Karnataka', buName: 'A', zoneName: 'Z1', regionName: 'Karnataka' },
    ];
    rows.sort((a, b) => compareEmsReportByHierarchy(a, b, 'region'));
    expect(rows.map((r) => r.groupLabel)).toEqual(['Karnataka', 'Telangana']);
  });

  it('sorts by BU, Zone, Region, Territory when groupBy is territory', () => {
    const rows = [
      { groupLabel: 'Warangal', buName: 'B', zoneName: 'Z', regionName: 'TS', territoryName: 'Warangal' },
      { groupLabel: 'Sirsilla', buName: 'A', zoneName: 'Z', regionName: 'TS', territoryName: 'Sirsilla' },
    ];
    rows.sort((a, b) => compareEmsReportByHierarchy(a, b, 'territory'));
    expect(rows.map((r) => r.groupLabel)).toEqual(['Sirsilla', 'Warangal']);
  });

  it('sorts MDO rows within territory hierarchy when groupBy is fda', () => {
    const rows = [
      { groupLabel: 'MDO Z', buName: 'A', zoneName: 'Z', regionName: 'TS', territoryName: 'T1' },
      { groupLabel: 'MDO A', buName: 'A', zoneName: 'Z', regionName: 'TS', territoryName: 'T1' },
    ];
    rows.sort((a, b) => compareEmsReportByHierarchy(a, b, 'fda'));
    expect(rows.map((r) => r.groupLabel)).toEqual(['MDO A', 'MDO Z']);
  });
});

describe('purchase intention helpers', () => {
  it('counts willing no when non-purchase reason is captured without explicit No toggle', () => {
    expect(
      isWillingNo({
        hasPurchased: false,
        willingToPurchase: null,
        nonPurchaseReason: 'Price',
      })
    ).toBe(true);
  });

  it('does not count purchased farmers as willing no', () => {
    expect(
      isWillingNo({
        hasPurchased: true,
        willingToPurchase: null,
        nonPurchaseReason: 'Price',
      })
    ).toBe(false);
  });

  it('counts willing yes only for not purchased with explicit yes', () => {
    expect(isWillingYes({ hasPurchased: false, willingToPurchase: true })).toBe(true);
    expect(isWillingYes({ hasPurchased: true, willingToPurchase: true })).toBe(false);
  });
});
