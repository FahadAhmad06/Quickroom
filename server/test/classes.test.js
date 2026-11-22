process.env.TEST_MONGO_URI = process.env.TEST_MONGO_URI_CLASSES || 'mongodb://127.0.0.1:27017/quizroom_classes_test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI;

import './helpers/env.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startMongod } from './helpers/mongod.js';

let mongod, server, base, mongoose, Admin, Student, ClassRoom, AllowedRollNumber, Paper, Attempt, Result, signToken;

const call = async (path, { method = 'GET', auth, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

before(async () => {
  mongod = await startMongod(27995);
  ({ default: mongoose } = await import('mongoose'));
  const { default: app } = await import('../src/app.js');
  const { default: connectDb } = await import('../src/db.js');
  ({ default: Admin } = await import('../src/models/Admin.js'));
  ({ default: Student } = await import('../src/models/Student.js'));
  ({ default: ClassRoom } = await import('../src/models/ClassRoom.js'));
  ({ default: AllowedRollNumber } = await import('../src/models/AllowedRollNumber.js'));
  ({ default: Paper } = await import('../src/models/Paper.js'));
  ({ default: Attempt } = await import('../src/models/Attempt.js'));
  ({ default: Result } = await import('../src/models/Result.js'));
  ({ default: signToken } = await import('../src/utils/signToken.js'));
  await connectDb();
  await mongoose.connection.db.dropDatabase();
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port + '/api';
});

after(async () => {
  server?.close();
  await mongoose?.disconnect();
  await mongod?.stop();
});

async function createTeacher(email) {
  const bcrypt = await import('bcryptjs');
  const admin = await Admin.create({ email, name: email.split('@')[0], passwordHash: await bcrypt.default.hash('pass123', 4) });
  const token = 'Bearer ' + signToken({ email, isSuper: false, adminId: String(admin._id) });
  return { admin, token };
}

describe('ClassRoom ownership and registration', () => {
  test('owner account can create a class with a valid derived Admin identity', async () => {
    const ownerToken = 'Bearer ' + signToken({ email: 'owner@test.local', isSuper: true, adminId: 'super' });
    const created = await call('/admin/classes', { method: 'POST', auth: ownerToken, body: { name: 'Owner Class', maxStrength: 15 } });
    assert.equal(created.status, 201);
    const db = await ClassRoom.findById(created.body._id).lean();
    assert.ok(db.adminId);
  });

  test('teacher creates a class with the authenticated adminId', async () => {
    const teacher = await createTeacher('class-owner@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'BSCS Semester 3', maxStrength: 2, code: 'BSCS301', adminId: '000000000000000000000000' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.registeredCount, 0);
    const db = await ClassRoom.findById(created.body._id).lean();
    assert.equal(String(db.adminId), String(teacher.admin._id));
  });

  test('unauthorized creation and cross-teacher access are rejected', async () => {
    const teacherA = await createTeacher('class-a@test.local');
    const teacherB = await createTeacher('class-b@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacherA.token, body: { name: 'Teacher A Class', maxStrength: 10 } });
    assert.equal(created.status, 201);
    assert.equal((await call('/admin/classes')).status, 401);
    assert.equal((await call('/admin/classes/' + created.body._id + '/members', { auth: teacherB.token })).status, 403);
  });

  test('PIN and Class Code methods fill the same class and enforce capacity', async () => {
    const teacher = await createTeacher('capacity@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'Capacity 2', maxStrength: 2, code: 'CAP2' } });
    assert.equal(created.status, 201);
    const pin = await call('/admin/rolls', { method: 'POST', auth: teacher.token, body: { rollNumber: 'PIN-CAP-1', pin: 'PIN123456', classId: created.body._id } });
    assert.equal(pin.status, 201);
    const first = await call('/students/register', { method: 'POST', body: { name: 'PIN Student', rollNumber: 'PIN-CAP-1', pin: pin.body.pin, password: 'pass123', confirmPassword: 'pass123' } });
    assert.equal(first.status, 201);
    const second = await call('/students/register', { method: 'POST', body: { name: 'Code Student', rollNumber: 'CODE-CAP-1', classCode: 'CAP2', password: 'pass123', confirmPassword: 'pass123' } });
    assert.equal(second.status, 201);
    assert.equal((await call('/students/register', { method: 'POST', body: { name: 'Third Student', rollNumber: 'CODE-CAP-2', classCode: 'CAP2', password: 'pass123', confirmPassword: 'pass123' } })).status, 409);
    const duplicate = await call('/students/register', { method: 'POST', body: { name: 'Duplicate', rollNumber: 'CODE-CAP-1', classCode: 'CAP2', password: 'pass123', confirmPassword: 'pass123' } });
    assert.equal(duplicate.status, 409);
    const students = await call('/admin/students', { auth: teacher.token });
    assert.equal(students.status, 200);
    assert.ok(students.body.some(s => s.rollNumber === 'PIN-CAP-1' && s.registrationMethod === 'pin' && s.classes.some(c => c.name === 'Capacity 2')));
    assert.ok(students.body.some(s => s.rollNumber === 'CODE-CAP-1' && s.registrationMethod === 'class_code' && s.classes.some(c => c.name === 'Capacity 2')));
  });

  test('concurrent registrations cannot exceed available seats', async () => {
    const teacher = await createTeacher('concurrent@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'Concurrent 1', maxStrength: 1, code: 'CONCURRENT1' } });
    const [a, b] = await Promise.all([
      call('/students/register', { method: 'POST', body: { name: 'Concurrent A', rollNumber: 'CONA', classCode: 'CONCURRENT1', password: 'pass123', confirmPassword: 'pass123' } }),
      call('/students/register', { method: 'POST', body: { name: 'Concurrent B', rollNumber: 'CONB', classCode: 'CONCURRENT1', password: 'pass123', confirmPassword: 'pass123' } })
    ]);
    assert.equal([a.status, b.status].sort().join(','), '201,409');
  });

  test('capacity decrease preserves students and blocks new registrations', async () => {
    const teacher = await createTeacher('decrease@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'Decrease', maxStrength: 3, code: 'DECREASE1' } });
    for (const roll of ['DEC1', 'DEC2']) {
      const r = await call('/students/register', { method: 'POST', body: { name: roll, rollNumber: roll, classCode: 'DECREASE1', password: 'pass123', confirmPassword: 'pass123' } });
      assert.equal(r.status, 201);
    }
    const reduced = await call('/admin/classes/' + created.body._id, { method: 'PATCH', auth: teacher.token, body: { maxStrength: 1 } });
    assert.equal(reduced.status, 200);
    assert.equal(reduced.body.registeredCount, 2);
    assert.equal(reduced.body.remainingSeats, 0);
    assert.equal((await call('/students/register', { method: 'POST', body: { name: 'Blocked', rollNumber: 'DEC3', classCode: 'DECREASE1', password: 'pass123', confirmPassword: 'pass123' } })).status, 409);
  });

  test('paper assignment is owner-checked and class export works', async () => {
    const teacher = await createTeacher('paper@test.local');
    const other = await createTeacher('paper-other@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'Paper Class', maxStrength: 20 } });
    const paper = await call('/admin/papers', { method: 'POST', auth: teacher.token, body: { title: 'Assigned Paper', perQ: 60, timingMode: 'perQuestion', customDuration: 0, tabSwitchLimitEnabled: false, tabSwitchLimit: 0, shuffle: false, questions: [{ type: 'mcq', text: 'One', options: ['A', 'B'], correct: 0 }], assignAllClasses: false, assignedClassIds: [created.body._id] } });
    assert.equal(paper.status, 201);
    const forbidden = await call('/admin/papers', { method: 'POST', auth: other.token, body: { title: 'Foreign', perQ: 60, questions: [{ type: 'mcq', text: 'One', options: ['A', 'B'], correct: 0 }], assignedClassIds: [created.body._id] } });
    assert.equal(forbidden.status, 400);
    const exported = await call('/admin/classes/' + created.body._id + '/export', { auth: teacher.token });
    assert.equal(exported.status, 200);
  });

  test('delete requires ownership and safely cleans class relationships', async () => {
    const teacher = await createTeacher('delete-owner@test.local');
    const other = await createTeacher('delete-other@test.local');
    const created = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'Delete Me', maxStrength: 20, code: 'DELETE-ME' } });
    assert.equal(created.status, 201);
    const otherClass = await call('/admin/classes', { method: 'POST', auth: teacher.token, body: { name: 'Other Retained Class', maxStrength: 20, code: 'RETAIN-ME' } });
    assert.equal(otherClass.status, 201);

    const registeredPin = await call('/admin/rolls', { method: 'POST', auth: teacher.token, body: { rollNumber: 'DELETE-PIN-REGISTERED', pin: 'DELETE123', classId: created.body._id } });
    assert.equal(registeredPin.status, 201);
    const registration = await call('/students/register', { method: 'POST', body: { name: 'Deleted Class Student', rollNumber: 'DELETE-PIN-REGISTERED', pin: registeredPin.body.pin, password: 'pass123', confirmPassword: 'pass123' } });
    assert.equal(registration.status, 201);

    const unregisteredPin = await call('/admin/rolls', { method: 'POST', auth: teacher.token, body: { rollNumber: 'DELETE-PIN-UNUSED', pin: 'UNUSED123', classId: created.body._id } });
    assert.equal(unregisteredPin.status, 201);

    const sharedPaper = await call('/admin/papers', { method: 'POST', auth: teacher.token, body: {
      title: 'Shared Paper', perQ: 60, timingMode: 'perQuestion', customDuration: 0,
      tabSwitchLimitEnabled: false, tabSwitchLimit: 0, shuffle: false,
      questions: [{ type: 'mcq', text: 'One', options: ['A', 'B'], correct: 0 }],
      assignAllClasses: false,
      assignedClassIds: [created.body._id, otherClass.body._id]
    } });
    assert.equal(sharedPaper.status, 201);

    const student = await Student.findOne({ rollNumber: 'DELETE-PIN-REGISTERED' });
    const attempt = await Attempt.create({ paperCode: 'SHARED1', paperTitle: 'Shared Paper', name: student.name, roll: student.rollNumber, student: student._id, submitted: true, needsGrading: false });
    const result = await Result.create({ paperCode: 'SHARED1', paperTitle: 'Shared Paper', name: student.name, roll: student.rollNumber, correct: 1, total: 1, attempt: attempt._id, adminId: teacher.admin._id });

    assert.equal((await call('/admin/classes/' + created.body._id, { method: 'DELETE' })).status, 401);
    assert.equal((await call('/admin/classes/' + created.body._id, { method: 'DELETE', auth: other.token })).status, 403);
    assert.equal((await call('/admin/classes/' + created.body._id, { method: 'DELETE', auth: teacher.token })).status, 200);

    const deletedClass = await ClassRoom.findById(created.body._id);
    assert.ok(deletedClass.deletedAt);
    assert.equal(deletedClass.registrationEnabled, false);
    assert.equal(deletedClass.classCodeEnabled, false);
    assert.equal(await Student.countDocuments({ _id: student._id }), 1);
    const updatedStudent = await Student.findById(student._id).lean();
    assert.deepEqual(updatedStudent.classIds.map(String), []);

    assert.equal(await AllowedRollNumber.countDocuments({ _id: unregisteredPin.body._id }), 0);
    const registeredRoll = await AllowedRollNumber.findById(registeredPin.body._id).lean();
    assert.equal(registeredRoll.classId, null);
    assert.equal(registeredRoll.isRegistered, true);

    const retainedPaper = await Paper.findById(sharedPaper.body._id).lean();
    assert.deepEqual(retainedPaper.assignedClassIds.map(String), [String(otherClass.body._id)]);
    assert.equal(await Attempt.countDocuments({ _id: attempt._id }), 1);
    assert.equal(await Result.countDocuments({ _id: result._id }), 1);

    const classList = await call('/admin/classes', { auth: teacher.token });
    assert.equal(classList.status, 200);
    assert.equal(classList.body.some(c => c._id === created.body._id), false);
  });
});
