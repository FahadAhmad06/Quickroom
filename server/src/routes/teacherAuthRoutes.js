import { Router } from 'express';
import bcrypt from 'bcryptjs';
import Admin from '../models/Admin.js';
import asyncHandler from '../utils/asyncHandler.js';
import httpError from '../utils/httpError.js';
import makeLimiter from '../middleware/rateLimit.js';

const r = Router();

r.post('/change-password', makeLimiter({
  max: 10,
  message: 'Too many password change attempts. Please try again later.'
}), asyncHandler(async (req, res) => {
  if (req.admin.isSuper) throw httpError(403, 'The owner account password is managed separately.');

  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');

  if (!currentPassword) throw httpError(400, 'Enter your current password.');
  if (!newPassword) throw httpError(400, 'Enter a new password.');
  if (!confirmPassword) throw httpError(400, 'Confirm your new password.');
  if (newPassword !== confirmPassword) throw httpError(400, 'New passwords do not match.');
  if (newPassword.length < 6) throw httpError(400, 'Password must be at least 6 characters.');
  if (!/[A-Z]/.test(newPassword)) throw httpError(400, 'Password must contain at least 1 uppercase letter.');
  if (!/[0-9]/.test(newPassword)) throw httpError(400, 'Password must contain at least 1 number.');
  if (!/[^A-Za-z0-9\s]/.test(newPassword)) throw httpError(400, 'Password must contain at least 1 special character.');

  const teacher = await Admin.findById(req.admin.adminId);
  if (!teacher || !teacher.isEnabled) throw httpError(401, 'Please log in again.');
  if (await bcrypt.compare(newPassword, teacher.passwordHash)) {
    throw httpError(400, 'New password must be different from your current password.');
  }
  if (!await bcrypt.compare(currentPassword, teacher.passwordHash)) {
    throw httpError(400, 'Current password is incorrect.');
  }

  teacher.passwordHash = await bcrypt.hash(newPassword, 10);
  await teacher.save();
  res.json({ ok: true, message: 'Password changed successfully.' });
}));

export default r;
