import axios from 'axios';
import {
  authenticateEms,
  fetchEmsActivities,
  formatDateFromParam,
  formatEmsDateTimeFromParam,
  parseEmsActivityDate,
  getFfaEmsDefaultDateFromDisplay,
  getFfaEmsDefaultDateFromIso,
  isEmsFfaApiEnabled,
  parseFfaEmsDefaultDateFrom,
  resolveEmsApiBase,
  resolveEmsActivitiesLimit,
} from '../../src/services/emsFfaClient.js';

const EMS_BASE = 'https://emsapiuat.naclind.com/api';

describe('emsFfaClient', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...origEnv,
      FFA_EMS_CTID: 'test-ctid',
      FFA_EMS_SECTKEY: 'test-sectkey',
      FFA_EMS_TOKEN: '',
    };
  });

  afterEach(() => {
    process.env = origEnv;
    jest.restoreAllMocks();
  });

  test('isEmsFfaApiEnabled when ctid and sectkey set', () => {
    expect(isEmsFfaApiEnabled()).toBe(true);
    delete process.env.FFA_EMS_CTID;
    expect(isEmsFfaApiEnabled()).toBe(false);
  });

  test('resolveEmsApiBase normalizes auth URL to /api base', () => {
    expect(resolveEmsApiBase(`${EMS_BASE}/EMS/authenticate`)).toBe(EMS_BASE);
    expect(resolveEmsApiBase(EMS_BASE)).toBe(EMS_BASE);
  });

  test('formatDateFromParam uses DD/MM/YYYY', () => {
    expect(formatDateFromParam(new Date(2025, 4, 1))).toBe('01/05/2025');
  });

  test('formatEmsDateTimeFromParam uses DD-MM-YYYY HH:mm:ss', () => {
    expect(formatEmsDateTimeFromParam(new Date(2026, 4, 8, 22, 28, 44))).toBe(
      '08-05-2026 22:28:44'
    );
  });

  test('parseEmsActivityDate parses NACL prod datetime and slash legacy', () => {
    const prod = parseEmsActivityDate('08-05-2026 22:28:44');
    expect(prod.getFullYear()).toBe(2026);
    expect(prod.getMonth()).toBe(4);
    expect(prod.getDate()).toBe(8);
    expect(prod.getHours()).toBe(22);
    expect(prod.getMinutes()).toBe(28);

    const legacy = parseEmsActivityDate('01/05/2025');
    expect(legacy.getMonth()).toBe(4);
    expect(legacy.getDate()).toBe(1);
  });

  test('resolveEmsActivitiesLimit defaults to 0 for full and incremental', () => {
    delete process.env.FFA_EMS_ACTIVITIES_LIMIT_FULL;
    delete process.env.FFA_EMS_ACTIVITIES_LIMIT_INCREMENTAL;
    expect(resolveEmsActivitiesLimit('full')).toBe(0);
    expect(resolveEmsActivitiesLimit('incremental')).toBe(0);
    process.env.FFA_EMS_ACTIVITIES_LIMIT_INCREMENTAL = '250';
    expect(resolveEmsActivitiesLimit('incremental')).toBe(250);
  });

  test('getFfaEmsDefaultDateFromDisplay and ISO conversion', () => {
    process.env.FFA_EMS_DEFAULT_DATE_FROM = '1/5/2025';
    expect(getFfaEmsDefaultDateFromDisplay()).toBe('01/05/2025');
    expect(getFfaEmsDefaultDateFromIso()).toBe('2025-05-01');
    expect(parseFfaEmsDefaultDateFrom('01/05/2025').getMonth()).toBe(4);
  });

  test('authenticateEms returns odat[0].token', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {
        styp: 'S',
        senm: 'valid User...!',
        odat: [{ token: 'session-token-abc' }],
      },
    });

    const token = await authenticateEms(EMS_BASE);
    expect(token).toBe('session-token-abc');
    expect(axios.post).toHaveBeenCalledWith(
      `${EMS_BASE}/EMS/authenticate`,
      expect.objectContaining({ ctid: 'test-ctid', sectkey: 'test-sectkey' }),
      expect.any(Object)
    );
  });

  test('fetchEmsActivities returns empty array when Success false no data', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { styp: 'S', odat: [{ token: 'tok' }] },
    });
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { Success: false, message: 'No data available' },
    });

    const activities = await fetchEmsActivities(EMS_BASE, new Date(2025, 4, 1), 0);
    expect(activities).toEqual([]);
    expect(axios.get).toHaveBeenCalledWith(
      `${EMS_BASE}/EMS/activities?limit=0&dateFrom=01%2F05%2F2025`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    );
  });

  test('fetchEmsActivities maps NACL PascalCase Data.Activities (Postman shape)', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { styp: 'S', odat: [{ token: 'tok' }] },
    });
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: {
        Success: true,
        Data: {
          Activities: [
            {
              ActivityId: '5245',
              Type: 'Dealer Activity',
              Date: '17-06-2025 12:00:00',
              OfficerId: '22532',
              OfficerName: 'A Gopal',
              Location: '',
              Territory: 'Manvi',
              TerritoryName: 'Manvi',
              ZoneName: 'BELLARY',
              BuName: 'INK BU',
              State: 'KARNATAKA',
              Crops: [],
              Products: [],
              Farmers: [
                {
                  FarmerId: 'F-1',
                  Name: 'Test Farmer',
                  MobileNumber: '9876543210',
                  Location: 'Village',
                },
              ],
            },
          ],
        },
      },
    });

    const activities = await fetchEmsActivities(EMS_BASE, new Date(2025, 4, 11), 0);
    expect(activities).toHaveLength(1);
    expect(activities[0].activityId).toBe('5245');
    expect(activities[0].type).toBe('Dealer Activity');
    expect(activities[0].state).toBe('KARNATAKA');
    expect(activities[0].farmers[0].name).toBe('Test Farmer');
    expect(axios.get).toHaveBeenCalledWith(
      `${EMS_BASE}/EMS/activities?limit=0&dateFrom=11%2F05%2F2025`,
      expect.any(Object)
    );
  });

  test('fetchEmsActivities uses datetime dateFrom for incremental', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { styp: 'S', odat: [{ token: 'tok' }] },
    });
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { Success: true, Data: { Activities: [] } },
    });

    await fetchEmsActivities(EMS_BASE, new Date(2026, 5, 3, 15, 6, 7), 0, true);
    expect(axios.get).toHaveBeenCalledWith(
      `${EMS_BASE}/EMS/activities?limit=0&dateFrom=03-06-2026%2015%3A06%3A07`,
      expect.any(Object)
    );
  });

  test('fetchEmsActivities maps vendor-shaped activities', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { styp: 'S', odat: [{ token: 'tok' }] },
    });
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        data: {
          activities: [
            {
              activityId: 'A-1',
              type: 'Field Day',
              date: '01/05/2025',
              officerId: 'FDA-1',
              officerName: 'Officer',
              location: 'Loc',
              territory: 'Telangana',
              state: 'Telangana',
              farmers: [
                { farmerId: 'F-1', name: 'Farmer', mobileNumber: '9876543210', location: 'V' },
              ],
            },
          ],
        },
      },
    });

    const activities = await fetchEmsActivities(EMS_BASE, new Date(2025, 4, 1), 100);
    expect(activities).toHaveLength(1);
    expect(activities[0].activityId).toBe('A-1');
    expect(axios.get).toHaveBeenCalledWith(
      `${EMS_BASE}/EMS/activities?limit=100&dateFrom=01%2F05%2F2025`,
      expect.any(Object)
    );
    expect(activities[0].farmers[0].mobileNumber).toBe('9876543210');
  });
});
