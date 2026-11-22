import { Router } from 'express';
import ClassRoom from '../models/ClassRoom.js';
import Student from '../models/Student.js';
import AllowedRollNumber from '../models/AllowedRollNumber.js';
import Paper from '../models/Paper.js';
import asyncHandler from '../utils/asyncHandler.js';
import httpError from '../utils/httpError.js';
import { ownerFilter, adminObjectId, isOwner } from '../utils/adminFilter.js';

const r = Router();
const cleanCode = value => String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').toUpperCase().slice(0, 30);

async function uniqueCode(preferred) {
  if (preferred) {
    if (await ClassRoom.exists({ code: preferred })) throw httpError(409, 'This class code is already in use.');
    return preferred;
  }
  for (let i = 0; i < 20; i++) {
    const code = 'CLS' + Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!(await ClassRoom.exists({ code }))) return code;
  }
  throw httpError(500, 'Could not generate a unique class code.');
}

async function findClass(id, req) {
  const c = await ClassRoom.findById(id);
  if (!c) throw httpError(404, 'Class not found.');
  if (c.deletedAt) throw httpError(404, 'Class not found.');
  if (!isOwner(req, c)) throw httpError(403, 'You do not have permission to manage this class.');
  return c;
}

async function classView(c) {
  const [registered, members, activePins] = await Promise.all([
    Student.countDocuments({ classIds: c._id }),
    Student.find({ classIds: c._id }).select('name rollNumber registrationMethod createdAt').sort({ rollNumber: 1 }).lean(),
    AllowedRollNumber.countDocuments({ classId: c._id, isRegistered: false, isEnabled: true, pinHash: { $ne: null } })
  ]);
  if (c.registeredCount !== registered) await ClassRoom.updateOne({ _id: c._id }, { registeredCount: registered });
  return {
    _id: c._id, name: c.name, code: c.code, maxStrength: c.maxStrength,
    registeredCount: registered, remainingSeats: Math.max(0, c.maxStrength - registered),
    registrationEnabled: c.registrationEnabled, classCodeEnabled: c.classCodeEnabled,
    activePinCount: activePins,
    canRegister: c.registrationEnabled && registered < c.maxStrength,
    members, createdAt: c.createdAt, updatedAt: c.updatedAt
  };
}

r.get('/classes', asyncHandler(async (req, res) => {
  const classes = await ClassRoom.find({ ...ownerFilter(req), deletedAt: null }).sort({ name: 1 }).lean();
  res.json(await Promise.all(classes.map(classView)));
}));

r.post('/classes', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const maxStrength = Number(req.body?.maxStrength);
  if (!name) throw httpError(400, 'Enter a class name.');
  if (!Number.isInteger(maxStrength) || maxStrength < 1 || maxStrength > 100000) throw httpError(400, 'Maximum strength must be an integer from 1 to 100000.');
  if (await ClassRoom.exists({ ...ownerFilter(req), name, deletedAt: null })) throw httpError(409, 'A class with this name already exists.');
  const code = await uniqueCode(cleanCode(req.body?.code));
  const c = await ClassRoom.create({
    name, code, maxStrength, adminId: adminObjectId(req),
    registrationEnabled: req.body?.registrationEnabled !== false,
    classCodeEnabled: req.body?.classCodeEnabled !== false
  });
  res.status(201).json(await classView(c));
}));

r.patch('/classes/:id', asyncHandler(async (req, res) => {
  const c = await findClass(req.params.id, req), b = req.body || {};
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 120);
    if (!name) throw httpError(400, 'Enter a class name.');
    c.name = name;
  }
  if (b.maxStrength !== undefined) {
    const maxStrength = Number(b.maxStrength);
    if (!Number.isInteger(maxStrength) || maxStrength < 1 || maxStrength > 100000) throw httpError(400, 'Maximum strength must be an integer from 1 to 100000.');
    c.maxStrength = maxStrength;
  }
  if (b.registrationEnabled !== undefined) c.registrationEnabled = b.registrationEnabled === true;
  if (b.classCodeEnabled !== undefined) c.classCodeEnabled = b.classCodeEnabled === true;
  await c.save();
  res.json(await classView(c));
}));

r.post('/classes/:id/regenerate-code', asyncHandler(async (req, res) => {
  const c = await findClass(req.params.id, req);
  c.code = await uniqueCode(cleanCode(req.body?.code));
  await c.save();
  res.json(await classView(c));
}));

r.delete('/classes/:id', asyncHandler(async (req, res) => {
  const c = await findClass(req.params.id, req);
  c.deletedAt = new Date();
  c.registrationEnabled = false;
  c.classCodeEnabled = false;
  c.registeredCount = 0;
  c.activePinCount = 0;
  await c.save();

  await Promise.all([
    Student.updateMany({ classIds: c._id }, { $pull: { classIds: c._id } }),
    AllowedRollNumber.deleteMany({ classId: c._id, isRegistered: false }),
    AllowedRollNumber.updateMany(
      { classId: c._id, isRegistered: true },
      { $set: { classId: null, isEnabled: false } }
    ),
    Paper.updateMany({ assignedClassIds: c._id }, { $pull: { assignedClassIds: c._id } })
  ]);

  res.json({
    ok: true,
    deleted: true,
    deletionMode: 'soft',
    message: 'Class removed from active management. Historical attempts and results were preserved.'
  });
}));

r.get('/classes/:id/members', asyncHandler(async (req, res) => {
  const c = await findClass(req.params.id, req);
  res.json(await classView(c));
}));

r.get('/classes/:id/export', asyncHandler(async (req, res) => {
  const c = await findClass(req.params.id, req);
  const members = await Student.find({ classIds: c._id }).select('name rollNumber registrationMethod createdAt').sort({ rollNumber: 1 }).lean();
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [
    ['Class Name', 'Class Code', 'Student Name', 'Roll Number', 'Email', 'Registration Method', 'Registered At'].map(esc).join(','),
    ...members.map(s => [c.name, c.code, s.name, s.rollNumber, '', s.registrationMethod === 'pin' ? 'Registration PIN' : s.registrationMethod === 'class_code' ? 'Class Code' : 'Legacy', s.createdAt ? new Date(s.createdAt).toISOString() : ''].map(esc).join(','))
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + c.code + '-students.csv"');
  res.send('\ufeff' + csv);
}));

export default r;
