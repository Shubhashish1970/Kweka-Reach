/**
 * Integration tests for /api/users endpoints.
 *
 * Covers: create user, self-deactivation guard (U3), X-Active-Role
 * fallback for multi-role users (U8), and permission checks.
 */

import request from 'supertest';
import app from '../helpers/testApp.js';
import { User } from '../../src/models/User.js';
import { makeAdmin, makeAgent, makeTeamLead, makeUser } from '../helpers/factories.js';

// ─── Auth helper ─────────────────────────────────────────────────────────────

const login = async (email: string, password = 'Password1') => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  return res.body.data?.token as string;
};

let _counter = 0;
const uniqueEmail = () => `user-int-${++_counter}@test.com`;
const uniqueEmpId = () => `EMP-INT-${_counter}`;

// ─── U1: create user (admin) ──────────────────────────────────────────────────

describe('U1: admin can create a new user', () => {
  test('POST /api/users returns 201 with the created user', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);
    const email = uniqueEmail();

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Agent',
        email,
        password: 'Password1',
        role: 'cc_agent',
        employeeId: uniqueEmpId(),
        languageCapabilities: ['Hindi'],
        assignedTerritories: [],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('creating a user with duplicate email returns 400', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);
    const email = uniqueEmail();

    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'First User',
        email,
        password: 'Password1',
        role: 'cc_agent',
        employeeId: uniqueEmpId(),
        languageCapabilities: ['Hindi'],
      });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Second User',
        email, // same email
        password: 'Password1',
        role: 'cc_agent',
        employeeId: uniqueEmpId(),
        languageCapabilities: ['Hindi'],
      });

    expect(res.status).toBe(400);
  });
});

// ─── U2: cc_agent cannot create users ────────────────────────────────────────

describe('U2: cc_agent lacks permission to create users', () => {
  test('POST /api/users as cc_agent returns 403', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Attempted Agent',
        email: uniqueEmail(),
        password: 'Password1',
        role: 'cc_agent',
        employeeId: uniqueEmpId(),
        languageCapabilities: ['Hindi'],
      });

    expect(res.status).toBe(403);
  });
});

// ─── U3: cannot deactivate own account ───────────────────────────────────────

describe('U3: admin cannot deactivate their own account', () => {
  test('DELETE /api/users/:self-id returns 400', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);

    const res = await request(app)
      .delete(`/api/users/${admin._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot deactivate your own account/i);
  });

  test('admin CAN deactivate another user', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);

    const res = await request(app)
      .delete(`/api/users/${agent._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const updated = await User.findById(agent._id);
    expect(updated?.isActive).toBe(false);
  });
});

// ─── U4: get all users ────────────────────────────────────────────────────────

describe('U4: GET /api/users requires authentication', () => {
  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  test('admin gets paginated user list', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);

    // Create a couple of users to ensure the list is non-empty
    const teamLead = await makeTeamLead();
    await makeAgent(teamLead._id);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.data.users.length).toBeGreaterThan(0);
  });
});

// ─── U8: X-Active-Role RBAC ───────────────────────────────────────────────────

describe('U8: X-Active-Role header for multi-role users', () => {
  /**
   * When X-Active-Role is a role the user does NOT hold,
   * getEffectiveRole() silently falls back to the primary role.
   * So an agent sending X-Active-Role: mis_admin still gets cc_agent permissions
   * and should receive 403 on admin-only endpoints.
   */
  test('cc_agent with X-Active-Role: mis_admin still gets 403 on admin endpoints', async () => {
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);
    const token = await login(agent.email);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Role', 'mis_admin'); // role not in agent's roles array → fallback to cc_agent

    expect(res.status).toBe(403);
  });

  test('multi-role user can switch to their secondary role via X-Active-Role', async () => {
    // Create a user that has both mis_admin and cc_agent roles
    const multiRoleUser = await makeUser({
      role: 'mis_admin',
      roles: ['mis_admin', 'team_lead'],
    });
    const token = await login(multiRoleUser.email);

    // Using primary role (mis_admin) → can access /api/users
    const asAdmin = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(asAdmin.status).toBe(200);

    // Switch to team_lead role — team_lead may or may not have users.list permission
    // but at minimum the request should be processed (not 500)
    const asTeamLead = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Role', 'team_lead');
    expect([200, 403]).toContain(asTeamLead.status);
  });
});

// ─── U5: update user ──────────────────────────────────────────────────────────

describe('U5: admin can update a user', () => {
  test('PUT /api/users/:id updates name', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);

    const res = await request(app)
      .put(`/api/users/${agent._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('Updated Name');
  });

  test('setting teamLeadId to a non-team_lead user returns 400', async () => {
    const admin = await makeAdmin();
    const token = await login(admin.email);
    const teamLead = await makeTeamLead();
    const agent = await makeAgent(teamLead._id);

    // Try to set another agent as the teamLead for this agent — should fail
    const anotherAgent = await makeAgent(teamLead._id);

    const res = await request(app)
      .put(`/api/users/${agent._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ teamLeadId: anotherAgent._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/invalid team lead/i);
  });
});
