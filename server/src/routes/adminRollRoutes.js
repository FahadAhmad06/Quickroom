import { Router } from 'express';
import bcrypt from 'bcryptjs';
import AllowedRollNumber from '../models/AllowedRollNumber.js';
import Student from '../models/Student.js';
import ClassRoom from '../models/ClassRoom.js';
import asyncHandler from '../utils/asyncHandler.js';
import httpError from '../utils/httpError.js';
import normalizeRoll from '../utils/normalizeRoll.js';
import generatePin from '../utils/generatePin.js';
import { ownerFilter, adminObjectId, isOwner } from '../utils/adminFilter.js';

const r = Router(); // mounted behind requireAdmin

async function pinCapacity(req, classId, count) {
  if (!classId) return;
  const c = await ClassRoom.findOne({ _id: classId, ...ownerFilter(req) });
  if (!c) throw httpError(404, 'Class not found.');
  if (c.deletedAt) throw httpError(404, 'Class not found.');
  const [registered, activePins] = await Promise.all([
    Student.countDocuments({ classIds: c._id }),
    AllowedRollNumber.countDocuments({ classId: c._id, isRegistered: false, isEnabled: true, pinHash: { $ne: null } })
  ]);
  await ClassRoom.updateOne({ _id: c._id }, { registeredCount: registered, activePinCount: activePins });
  if (!c.registrationEnabled) throw httpError(403, 'Registration is disabled for this class.');
  if (registered + activePins + count > c.maxStrength) throw httpError(409, `Only ${Math.max(0, c.maxStrength - registered - activePins)} registration slots or PINs are available.`);
  if (count > 0) {
    const reserved = await ClassRoom.findOneAndUpdate(
      { _id: c._id, deletedAt: null, registrationEnabled: true, $expr: { $lte: [{ $add: ['$registeredCount', '$activePinCount', count] }, '$maxStrength'] } },
      { $inc: { activePinCount: count } },
      { new: true }
    );
    if (!reserved) throw httpError(409, 'No more PIN slots are available for this class.');
  }
  return c;
}

const view = a => ({
  _id: a._id, rollNumber: a.rollNumber, classId: a.classId, className: a.className, isEnabled: a.isEnabled, isRegistered: a.isRegistered,
  registeredStudent: a.registeredStudent, createdAt: a.createdAt
});

// Helper: find a roll number entry and verify the admin owns it.
async function findRoll(id, req) {
  const a = await AllowedRollNumber.findById(id);
  if (!a) throw httpError(404, 'Roll number not found.');
  if (!isOwner(req, a)) throw httpError(403, 'You do not have permission to manage this roll number.');
  return a;
}

async function findRollClass(id, req) {
  const c = await ClassRoom.findById(id);
  if (!c) throw httpError(404, 'Class not found.');
  if (c.deletedAt) throw httpError(404, 'Class not found.');
  if (!isOwner(req, c)) throw httpError(403, 'You do not have permission to manage this class.');
  return c;
}

r.get('/rolls', asyncHandler(async (req, res) => {
  const rows = await AllowedRollNumber.find(ownerFilter(req))
    .select('-pinHash -pinFailCount -pinLockedUntil')
    .populate('registeredStudent', 'name rollNumber').sort({ createdAt: -1 }).lean();
  res.json(rows.map(view));
}));

r.get('/rolls/export', asyncHandler(async (req, res) => {
  const filter = { ...ownerFilter(req) };
  if (req.query.classId) {
    const c = await findRollClass(req.query.classId, req);
    filter.classId = c._id;
  }
  const rows = await AllowedRollNumber.find(filter).select('rollNumber className isEnabled isRegistered pinHash').populate('registeredStudent', 'name').sort({ createdAt: -1 }).lean();
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [
    ['Roll Number', 'Student Name', 'Class Name', 'PIN', 'Status'].map(esc).join(','),
    ...rows.map(a => [
      a.rollNumber,
      a.registeredStudent?.name || '',
      a.className || '',
      a.pinHash ? 'Shown once at generation' : '',
      a.isRegistered ? 'Registered' : a.isEnabled ? 'Available' : 'Disabled'
    ].map(esc).join(','))
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="registration-pins.csv"');
  res.send('\ufeff' + csv);
}));

r.post('/rolls', asyncHandler(async (req, res) => {
  const rollNumber = normalizeRoll(req.body?.rollNumber);
  if (!rollNumber) throw httpError(400, 'Enter a roll number.');
  if (await AllowedRollNumber.exists({ rollNumber })) throw httpError(409, 'This roll number is already on the list.');
  const c = req.body?.classId ? await pinCapacity(req, req.body.classId, 1) : null;
  const pin = String(req.body?.pin || '').trim() || generatePin();
  if (pin.length < 6) throw httpError(400, 'PIN must be at least 6 characters.');
  const a = await AllowedRollNumber.create({
    rollNumber, pinHash: await bcrypt.hash(pin, 10),
    createdBy: req.admin.email,
    adminId: adminObjectId(req), // always from verified JWT, never from request body
    classId: c?._id || null, className: c?.name || null
  });
  res.status(201).json({ ...view(a), pin });
}));

r.post('/rolls/bulk', asyncHandler(async (req, res) => {
  const lines = String(req.body?.rollNumbers || '').split(/[\n,]/).map(normalizeRoll).filter(Boolean);
  const unique = [...new Set(lines)];
  if (!unique.length) throw httpError(400, 'Enter at least one roll number.');
  if (!req.body?.classId) throw httpError(400, 'Select a class for bulk registration PINs.');
  const existing = new Set((await AllowedRollNumber.find({ rollNumber: { $in: unique } }).select('rollNumber').lean()).map(x => x.rollNumber));
  const toCreate = unique.filter(x => !existing.has(x));
  const c = await pinCapacity(req, req.body.classId, toCreate.length);
  const created = [];
  for (const rollNumber of unique) {
    if (existing.has(rollNumber)) continue;
    const pin = generatePin();
    await AllowedRollNumber.create({
      rollNumber, pinHash: await bcrypt.hash(pin, 10),
      createdBy: req.admin.email,
      adminId: adminObjectId(req),
      classId: c._id, className: c.name
    });
    created.push({ rollNumber, pin });
  }
  res.status(201).json({ created, skipped: unique.filter(r => existing.has(r)) });
}));

r.post('/rolls/:id/regenerate', asyncHandler(async (req, res) => {
  const a = await findRoll(req.params.id, req);
  if (a.isRegistered) throw httpError(400, 'This roll number is already registered.');
  const pin = generatePin();
  a.pinHash = await bcrypt.hash(pin, 10); a.pinFailCount = 0; a.pinLockedUntil = null;
  await a.save();
  res.json({ ...view(a), pin });
}));

r.post('/rolls/:id/disable', asyncHandler(async (req, res) => {
  const a = await findRoll(req.params.id, req);
  a.isEnabled = false; await a.save();
  res.json(view(a));
}));

r.post('/rolls/:id/enable', asyncHandler(async (req, res) => {
  const a = await findRoll(req.params.id, req);
  a.isEnabled = true; await a.save();
  res.json(view(a));
}));

// Removes the allowlist entry; if a student has registered on it, deletes that student's
// account too (their past attempts/results are untouched). The roll number can be re-added fresh.
r.delete('/rolls/:id', asyncHandler(async (req, res) => {
  const a = await findRoll(req.params.id, req);
  if (a.isRegistered && a.registeredStudent) await Student.deleteOne({ _id: a.registeredStudent });
  await a.deleteOne();
  if (a.classId) {
    const registered = await Student.countDocuments({ classIds: a.classId });
    await ClassRoom.updateOne({ _id: a.classId }, { registeredCount: registered, $inc: { activePinCount: a.pinHash ? -1 : 0 } });
  }
  res.json({ ok: true });
}));

export default r;
