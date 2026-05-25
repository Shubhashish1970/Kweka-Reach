import axios from 'axios';
import {
  authenticateEms,
  fetchEmsActivities,
  formatDateFromParam,
  getFfaEmsDefaultDateFromDisplay,
  getFfaEmsDefaultDateFromIso,
  isEmsFfaApiEnabled,
  parseFfaEmsDefaultDateFrom,
  resolveEmsApiBase,
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

    const activities = await fetchEmsActivities(EMS_BASE, new Date(2025, 4, 1));
    expect(activities).toEqual([]);
    expect(axios.get).toHaveBeenCalledWith(
      `${EMS_BASE}/EMS/activities?limit=100&dateFrom=01%2F05%2F2025`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
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

    const activities = await fetchEmsActivities(EMS_BASE, new Date(2025, 4, 1));
    expect(activities).toHaveLength(1);
    expect(activities[0].activityId).toBe('A-1');
    expect(activities[0].farmers[0].mobileNumber).toBe('9876543210');
  });
});
