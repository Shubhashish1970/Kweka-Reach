import { compareEmsReportByHierarchy } from '../../src/services/emsReportService.js';

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
