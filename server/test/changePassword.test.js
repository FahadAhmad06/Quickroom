process.env.MONGO_URI = process.env.TEST_MONGO_URI_CHANGE_PASSWORD || 'mongodb://127.0.0.1:27999/quizroom_change_password_test';

import './helpers/env.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startMongod } from './helpers/mongod.js';

let mongod, server, base, mongoose, Admin, bcrypt, signToken;

const call = async (path, { auth, body } = {}) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body || {})
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

before(async () => {
  mongod = await startMongod(27999);
  ({ default: mongoose } = await import('mongoose'));
  ({ default: Admin } = await import('../src/models/Admin.js'));
  ({ default: bcrypt } = await import('bcryptjs'));
  ({ default: signToken } = await import('../src/utils/signToken.js'));
  const { default: app } = await import('../src/app.js');
  const { default: connectDb } = await import('../src/db.js');
  await connectDb();
  await mongoose.connection.db.dropDatabase();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api';
});

after(async () => {
  server?.close();
  await mongoose?.disconnect();
  await mongod?.stop();
});

describe('Teacher change password', () => {
  let teacher, token;

  before(async () => {
    teacher = await Admin.create({
      name: 'Test Teacher',
      email: 'teacher-change@test.local',
      passwordHash: await bcrypt.hash('Oldpass123!', 4)
    });
    token = 'Bearer ' + signToken({ email: teacher.email, isSuper: false, adminId: String(teacher._id), name: teacher.name });
  });

  test('rejects unauthenticated requests', async () => {
    const res = await call('/admin/teachers/change-password', { body: { currentPassword: 'Oldpass123!', newPassword: 'Fahad@123', confirmPassword: 'Fahad@123' } });
    assert.equal(res.status, 401);
  });

  test('rejects owner requests', async () => {
    const ownerToken = 'Bearer ' + signToken({ email: 'owner@test.local', isSuper: true, adminId: 'super' });
    const res = await call('/admin/teachers/change-password', { auth: ownerToken, body: { currentPassword: 'Oldpass123!', newPassword: 'Fahad@123', confirmPassword: 'Fahad@123' } });
    assert.equal(res.status, 403);
  });

  test('rejects empty fields', async () => {
    const res = await call('/admin/teachers/change-password', { auth: token });
    assert.equal(res.status, 400);
  });

  test('rejects mismatched passwords', async () => {
    const res = await call('/admin/teachers/change-password', { auth: token, body: { currentPassword: 'Oldpass123!', newPassword: 'Fahad@123', confirmPassword: 'Different@123' } });
    assert.equal(res.status, 400);
  });

  test('rejects weak passwords', async () => {
    for (const password of ['fahad@123', 'Fahad@abc', 'Fahad123', 'Fa@1']) {
      const res = await call('/admin/teachers/change-password', { auth: token, body: { currentPassword: 'Oldpass123!', newPassword: password, confirmPassword: password } });
      assert.equal(res.status, 400);
    }
  });

  test('rejects incorrect current password', async () => {
    const res = await call('/admin/teachers/change-password', { auth: token, body: { currentPassword: 'Wrong@123', newPassword: 'Fahad@123', confirmPassword: 'Fahad@123' } });
    assert.equal(res.status, 400);
  });

  test('rejects the same password', async () => {
    const res = await call('/admin/teachers/change-password', { auth: token, body: { currentPassword: 'Oldpass123!', newPassword: 'Oldpass123!', confirmPassword: 'Oldpass123!' } });
    assert.equal(res.status, 400);
  });

  test('updates successfully and old/new login behavior is correct', async () => {
    const change = await call('/admin/teachers/change-password', { auth: token, body: { currentPassword: 'Oldpass123!', newPassword: 'Fahad@123', confirmPassword: 'Fahad@123' } });
    assert.equal(change.status, 200);
    assert.equal(change.body.ok, true);
    assert.equal('passwordHash' in change.body, false);

    const saved = await Admin.findById(teacher._id).lean();
    assert.equal(await bcrypt.compare('Fahad@123', saved.passwordHash), true);

    const oldLogin = await call('/admin/login', { body: { email: teacher.email, password: 'Oldpass123!' } });
    assert.equal(oldLogin.status, 401);
    const newLogin = await call('/admin/login', { body: { email: teacher.email, password: 'Fahad@123' } });
    assert.equal(newLogin.status, 200);
  });
});
