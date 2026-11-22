import { Router } from 'express';
import Result from '../models/Result.js';
import Paper from '../models/Paper.js';
import Admin from '../models/Admin.js';
import AllowedRollNumber from '../models/AllowedRollNumber.js';
import Attempt from '../models/Attempt.js';
import Student from '../models/Student.js';
import ClassRoom from '../models/ClassRoom.js';
import asyncHandler from '../utils/asyncHandler.js';
import httpError from '../utils/httpError.js';
import rankResults from '../utils/rankResults.js';
import scoreFields from '../utils/scoreFields.js';
import normalizeRoll from '../utils/normalizeRoll.js';
import { ownerFilter } from '../utils/adminFilter.js';
import displayName from '../utils/displayName.js';

const r = Router();

async function assignedTeacherAdminIdForRoll(rollNumber) {
  if (!rollNumber) return null;
  const allowed = await AllowedRollNumber.findOne({ rollNumber: String(rollNumber).toUpperCase() }).select('adminId').lean();
  return allowed?.adminId ? String(allowed.adminId) : null;
}

// Helper: get the paper codes this admin owns. Super-admin: null (no restriction).
async function adminPaperCodes(req) {
  if (req.admin.isSuper) return null;
  const papers = await Paper.find(ownerFilter(req)).select('code').lean();
  return papers.map(p => p.code);
}

// Ranks are always computed per paper over all of that paper's results.
r.get('/results', asyncHandler(async (req, res) => {
  const codes = await adminPaperCodes(req);
  const f = {};
  if (codes !== null) f.paperCode = { $in: codes };
  if (req.query.paper) {
    const code = String(req.query.paper).toUpperCase();
    // Verify admin owns this paper before filtering to it.
    if (codes !== null && !codes.includes(code)) throw httpError(403, 'You do not have permission to view results for this paper.');
    f.paperCode = code;
  }
  res.json(rankResults(await Result.find(f).lean()));
}));

// Unified registered-student list. Includes PIN registrations and Class Code registrations.
// Regular admins are scoped by the classes and roll allowlist entries they own.
r.get('/students', asyncHandler(async (req, res) => {
  let classFilter = {};
  let rollFilter = {};
  if (!req.admin.isSuper) {
    classFilter = { adminId: req.admin.adminId };
    rollFilter = { adminId: req.admin.adminId };
  }

  const [classes, rolls] = await Promise.all([
    ClassRoom.find(classFilter).select('_id name code').lean(),
    AllowedRollNumber.find(rollFilter).select('rollNumber registeredStudent classId className isEnabled').populate('registeredStudent', 'name rollNumber registrationMethod createdAt').lean()
  ]);
  const classMap = new Map(classes.map(c => [String(c._id), c]));
  const classIds = classes.map(c => c._id);
  const students = await Student.find(
    req.admin.isSuper ? { classIds: { $exists: true, $ne: [] } } : { classIds: { $in: classIds } }
  ).select('name rollNumber registrationMethod classIds createdAt').lean();

  const byRoll = new Map();
  for (const student of students) {
    const studentClasses = (student.classIds || [])
      .map(id => classMap.get(String(id)))
      .filter(Boolean);
    byRoll.set(student.rollNumber, {
      _id: student._id,
      name: student.name,
      rollNumber: student.rollNumber,
      registrationMethod: student.registrationMethod || 'legacy',
      classes: studentClasses.map(c => ({ _id: c._id, name: c.name, code: c.code })),
      createdAt: student.createdAt
    });
  }

  for (const roll of rolls) {
    if (!roll.registeredStudent) continue;
    const c = roll.classId ? classMap.get(String(roll.classId)) : null;
    const existing = byRoll.get(roll.rollNumber);
    byRoll.set(roll.rollNumber, {
      _id: roll.registeredStudent._id,
      allowlistId: roll._id,
      name: roll.registeredStudent.name,
      rollNumber: roll.rollNumber,
      registrationMethod: roll.registeredStudent.registrationMethod || (roll.classId ? 'pin' : 'legacy'),
      classes: c ? [{ _id: c._id, name: c.name, code: c.code }] : (existing?.classes || (roll.className ? [{ name: roll.className }] : [])),
      createdAt: roll.registeredStudent.createdAt || existing?.createdAt || roll.createdAt,
      isEnabled: roll.isEnabled !== false
    });
  }

  res.json([...byRoll.values()].sort((a, b) => a.rollNumber.localeCompare(b.rollNumber)));
}));

r.delete('/students/:roll', asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  const allowed = await AllowedRollNumber.findOne({ rollNumber: roll }).lean();
  if (allowed) throw httpError(409, 'Use the Roll & PIN Management page to delete this PIN-registered student.');
  const student = await Student.findOne({ rollNumber: roll }).lean();
  if (!student) throw httpError(404, 'Student not found.');
  if (!req.admin.isSuper) {
    const ownedClasses = await ClassRoom.find({ adminId: req.admin.adminId }).select('_id').lean();
    const ownedIds = ownedClasses.map(c => String(c._id));
    if (!(student.classIds || []).some(id => ownedIds.includes(String(id)))) {
      throw httpError(403, 'This student is not in your workspace.');
    }
  }
  await Student.deleteOne({ _id: student._id });
  await Promise.all((student.classIds || []).map(async id => {
    const count = await Student.countDocuments({ classIds: id });
    await ClassRoom.updateOne({ _id: id }, { registeredCount: count });
  }));
  res.json({ ok: true });
}));

// Student Profile data: one student's info, assigned teacher, and complete quiz history. Used by
// both the Owner's global Students page and the Owner's Teacher Profile → Student drill-down.
// A regular admin may only open a student registered under their own roll numbers; the optional
// ?teacherId= is the explicit check for "opened via this teacher's profile" (independent of the
// Owner's normal full access) — it 404s if the roll isn't actually assigned to that teacher.
r.get('/students/:roll', asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  let allowed = await AllowedRollNumber.findOne({ rollNumber: roll })
    .populate('registeredStudent', 'name rollNumber registrationMethod classIds createdAt').lean();
  let student = allowed?.registeredStudent || null;
  if (!student) {
    student = await Student.findOne({ rollNumber: roll }).select('name rollNumber registrationMethod classIds createdAt').lean();
  }
  if (!student) throw httpError(404, 'Student not found.');

  if (!req.admin.isSuper) {
    const ownedClassIds = (await ClassRoom.find({ adminId: req.admin.adminId }).select('_id').lean()).map(c => String(c._id));
    const inOwnedClass = (student.classIds || []).some(id => ownedClassIds.includes(String(id)));
    const isOwnedRoll = allowed && String(allowed.adminId) === req.admin.adminId;
    if (!inOwnedClass && !isOwnedRoll) throw httpError(403, 'This student is not in your workspace.');
  }
  if (req.query.teacherId) {
    const classes = await ClassRoom.find({ _id: { $in: student.classIds || [] }, adminId: req.query.teacherId }).select('_id').lean();
    const isOwnedRoll = allowed && String(allowed.adminId || '') === String(req.query.teacherId);
    if (!classes.length && !isOwnedRoll) throw httpError(404, 'This student is not assigned to that teacher.');
  }

  const teacherDoc = allowed?.adminId ? await Admin.findById(allowed.adminId).select('name email').lean() : null;
  const classIds = student.classIds || [];
  const classes = classIds.length ? await ClassRoom.find({ _id: { $in: classIds } }).select('_id name code').lean() : [];
  const results = await Result.find({ roll }).sort({ createdAt: -1 }).lean();

  res.json({
    name: student.name, roll, email: results[0]?.email || '',
    registeredAt: student.createdAt,
    registrationMethod: student.registrationMethod || (allowed?.classId ? 'pin' : 'legacy'),
    classes: classes.map(c => ({ _id: c._id, name: c.name, code: c.code })),
    teacher: teacherDoc ? { id: teacherDoc._id, name: displayName(teacherDoc) } : null,
    results: results.map(scoreFields)
  });
}));

r.get('/suspended', asyncHandler(async (req, res) => {
  const now = new Date();
  await Attempt.deleteMany({
    submitted: false,
    qEnd: { $ne: null, $lte: now },
    examStatus: { $in: ['in_progress', 'suspended'] }
  });

  const codes = await adminPaperCodes(req);
  const match = { submitted: false, examStatus: 'suspended' };
  if (codes !== null) match.paperCode = { $in: codes };
  const attempts = await Attempt.find(match).sort({ suspendedAt: -1 }).lean();
  const teacherById = new Map();
  const teacherIds = [...new Set(attempts.map(a => (a.teacherId ? String(a.teacherId) : null)).filter(Boolean))];
  if (teacherIds.length) {
    const docs = await Admin.find({ _id: { $in: teacherIds } }).select('_id name email').lean();
    docs.forEach(doc => teacherById.set(String(doc._id), doc));
  }
  if (!req.admin.isSuper) {
    const admin = await Admin.findById(req.admin.adminId).select('name email').lean();
    if (admin) teacherById.set(String(admin._id), admin);
  }
  const rows = await Promise.all(attempts.map(async a => {
    const assignedTeacherId = await assignedTeacherAdminIdForRoll(a.roll);
    const assignedTeacher = assignedTeacherId ? teacherById.get(String(assignedTeacherId)) || null : null;
    return {
      _id: a._id,
      attemptId: a._id,
      studentName: a.name,
      studentEmail: a.email,
      paperTitle: a.paperTitle,
      paperCode: a.paperCode,
      tabSwitchCount: a.tabSwitchCount || 0,
      tabSwitchLimitEnabled: typeof a.tabSwitchLimitEnabled === 'boolean' ? a.tabSwitchLimitEnabled : true,
      tabSwitchLimit: Number.isInteger(a.tabSwitchLimit) && a.tabSwitchLimit >= 0 ? a.tabSwitchLimit : 3,
      suspendedAt: a.suspendedAt,
      suspensionReason: a.suspensionReason || 'Tab switch limit reached',
      examStatus: a.examStatus || 'suspended',
      remainingTime: a.qEnd ? Math.max(0, a.qEnd.getTime() - Date.now()) : 0,
      teacherName: assignedTeacher?.name || a.teacherName || null,
      teacherEmail: assignedTeacher?.email || null,
      assignedTeacherId: assignedTeacherId || null,
      adminId: a.adminId || null
    };
  }));
  res.json(rows);
}));

r.post('/attempts/:id/resume', asyncHandler(async (req, res) => {
  const a = await Attempt.findById(req.params.id);
  if (!a || a.submitted) throw httpError(404, 'Attempt not found.');
  const codes = await adminPaperCodes(req);
  if (codes !== null && !codes.includes(a.paperCode)) throw httpError(403, 'You do not have permission to resume this exam.');
  if (a.examStatus !== 'suspended') throw httpError(409, 'This attempt is not suspended.');
  if (a.qEnd && Date.now() >= a.qEnd.getTime()) throw httpError(409, 'This exam deadline has already expired.');

  const assignedTeacherId = await assignedTeacherAdminIdForRoll(a.roll);
  if (!req.admin.isSuper && assignedTeacherId && String(assignedTeacherId) !== String(req.admin.adminId)) {
    throw httpError(403, 'You are not assigned to this student and cannot resume their exam.');
  }
  if (!req.admin.isSuper && !assignedTeacherId) {
    throw httpError(403, 'This student is not assigned to your roster.');
  }

  a.examStatus = 'in_progress';
  a.resumedAt = new Date();
  a.resumedBy = req.admin.isSuper ? null : req.admin.adminId;
  a.suspensionReason = null;
  a.suspendedAt = null;
  await a.save();
  res.json({ ok: true, examStatus: 'in_progress', attemptId: a._id, qEnd: a.qEnd });
}));

r.delete('/attempts/:id', asyncHandler(async (req, res) => {
  const a = await Attempt.findById(req.params.id);
  if (!a) {
    return res.json({ ok: true, deleted: false, reason: 'not_found' });
  }
  if (a.submitted) {
    return res.json({ ok: true, deleted: false, reason: 'already_submitted' });
  }
  const codes = await adminPaperCodes(req);
  if (codes !== null && !codes.includes(a.paperCode)) throw httpError(403, 'You do not have permission to delete this exam request.');
  const deleted = await Attempt.deleteOne({ _id: req.params.id });
  if (!deleted.deletedCount) {
    return res.json({ ok: true, deleted: false, reason: 'not_found' });
  }
  res.json({ ok: true, deleted: true });
}));

r.delete('/attempts/suspended', asyncHandler(async (req, res) => {
  const codes = await adminPaperCodes(req);
  const match = { submitted: false, examStatus: 'suspended' };
  if (codes !== null) match.paperCode = { $in: codes };
  const deleted = await Attempt.deleteMany(match);
  res.json({ ok: true, deletedCount: deleted.deletedCount || 0 });
}));

r.delete('/results/:id', asyncHandler(async (req, res) => {
  const result = await Result.findById(req.params.id);
  if (!result) throw httpError(404, 'Result not found');
  // Verify admin owns the paper this result belongs to.
  const codes = await adminPaperCodes(req);
  if (codes !== null && !codes.includes(result.paperCode)) {
    throw httpError(403, 'You do not have permission to delete this result.');
  }
  const d = await Result.deleteOne({ _id: req.params.id });
  if (!d.deletedCount) throw httpError(404, 'Result not found');
  res.json({ ok: true });
}));

export default r;
