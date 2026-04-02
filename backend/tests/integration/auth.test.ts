import request from 'supertest';
import app from '../helpers/testApp.js';
import { User } from '../../src/models/User.js';
import { PasswordResetToken } from '../../src/models/PasswordResetToken.js';
import { hashPassword } from '../../src/utils/password.js';

const PLAIN_PASSWORD = 'Password1';

const createActiveUser = async (overrides: Record<string, unknown> = {}) => {
  const hashedPwd = await hashPassword(PLAIN_PASSWORD);
  return User.create({
    name: 'Test Admin',
    email: 'admin@test.com',
    password: hashedPwd,
    role: 'mis_admin',
    employeeId: 'EMP-ADMIN-001',
    languageCapabilities: ['English'],
    assignedTerritories: [],
    isActive: true,
    ...overrides,
  });
};

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('A1: valid credentials return 200 with token and user object', async () => {
    await createActiveUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user.email).toBe('admin@test.com');
    expect(res.body.data.user.role).toBe('mis_admin');
    // Password must never be returned
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('A2: unknown email returns 401 (not 404 — no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  test('A3: correct email, wrong password returns 401', async () => {
    await createActiveUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'WrongPass1' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  test('A4: inactive user cannot login', async () => {
    await createActiveUser({ isActive: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/inactive/i);
  });

  test('A5: login with uppercase email matches lowercase record', async () => {
    await createActiveUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ADMIN@TEST.COM', password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@test.com');
  });

  test('invalid email format returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: PLAIN_PASSWORD });

    expect(res.status).toBe(400);
  });

  test('missing password returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com' });

    expect(res.status).toBe(400);
  });

  test('missing email returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: PLAIN_PASSWORD });

    expect(res.status).toBe(400);
  });

  test('response includes roles array', async () => {
    await createActiveUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.user.roles)).toBe(true);
    expect(res.body.data.user.roles).toContain('mis_admin');
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  test('A9: missing Authorization header returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('A10: invalid Bearer token returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  test('A10b: malformed Authorization header (no Bearer prefix) returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'plain-token-no-bearer');
    expect(res.status).toBe(401);
  });

  test('A11: valid token for a deactivated user returns 401', async () => {
    const user = await createActiveUser();

    // Obtain a valid token while active
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: PLAIN_PASSWORD });
    const token: string = loginRes.body.data.token;

    // Deactivate the user
    await User.findByIdAndUpdate(user._id, { isActive: false });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  test('valid token returns user profile without password', async () => {
    await createActiveUser();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: PLAIN_PASSWORD });
    const token: string = loginRes.body.data.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@test.com');
    expect(res.body.data.user.password).toBeUndefined();
  });
});

// ─── Forgot password ─────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  test('A12: non-existent email returns 200 (prevents user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Must use the same generic message whether the account exists or not
    expect(res.body.message).toMatch(/if an account/i);
  });

  test('invalid email format returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-valid' });

    expect(res.status).toBe(400);
  });

  test('A8: new reset request invalidates the previous token', async () => {
    const user = await createActiveUser();

    // First request
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    const firstToken = await PasswordResetToken.findOne({
      userId: user._id,
      used: false,
    });
    expect(firstToken).not.toBeNull();

    // Second request — should invalidate the first
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    const firstTokenAfter = await PasswordResetToken.findById(firstToken!._id);
    expect(firstTokenAfter?.used).toBe(true);

    const newToken = await PasswordResetToken.findOne({
      userId: user._id,
      used: false,
    });
    expect(newToken).not.toBeNull();
    expect(newToken!._id.toString()).not.toBe(firstToken!._id.toString());
  });

  test('inactive user gets the generic response (not an error)', async () => {
    await createActiveUser({ isActive: false });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account/i);
  });
});

// ─── Reset password ───────────────────────────────────────────────────────────

describe('POST /api/auth/reset-password', () => {
  test('A13: password without uppercase returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'sometoken', password: 'password1' });

    expect(res.status).toBe(400);
  });

  test('A13b: password without a number returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'sometoken', password: 'PasswordNoNum' });

    expect(res.status).toBe(400);
  });

  test('A13c: password shorter than 6 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'sometoken', password: 'Ab1' });

    expect(res.status).toBe(400);
  });

  test('A6: already-used token is rejected', async () => {
    const user = await createActiveUser();
    const token = 'used-reset-token-001';

    await PasswordResetToken.create({
      userId: user._id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      used: false,
    });

    // Use it once
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'NewPass1' });

    // Attempt to use it again
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'AnotherPass1' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/invalid or expired/i);
  });

  test('A7: expired token is rejected', async () => {
    const user = await createActiveUser();
    const token = 'expired-reset-token-002';

    await PasswordResetToken.create({
      userId: user._id,
      token,
      expiresAt: new Date(Date.now() - 1000), // already expired
      used: false,
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'NewPass1' });

    expect(res.status).toBe(400);
  });

  test('valid token allows password reset and marks token as used', async () => {
    const user = await createActiveUser();
    const token = 'valid-reset-token-003';

    await PasswordResetToken.create({
      userId: user._id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      used: false,
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'NewPass1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Token should now be marked used
    const usedToken = await PasswordResetToken.findOne({ token });
    expect(usedToken?.used).toBe(true);

    // New password should work for login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'NewPass1' });

    expect(loginRes.status).toBe(200);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  test('authenticated logout returns 200', async () => {
    await createActiveUser();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: PLAIN_PASSWORD });
    const token: string = loginRes.body.data.token;

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('unauthenticated logout returns 401', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});
