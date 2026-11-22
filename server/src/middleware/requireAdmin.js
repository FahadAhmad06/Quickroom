import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import config from '../config.js';
import Admin from '../models/Admin.js';
export default async function requireAdmin(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const payload = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', config.jwtSecret);
    if (payload.isSuper) {
      const owner = await Admin.findOneAndUpdate(
        { email: config.ownerEmail },
        { $setOnInsert: { name: 'Owner', passwordHash: await bcrypt.hash(config.ownerPassword || crypto.randomUUID(), 10), isEnabled: true } },
        { upsert: true, new: true }
      ).select('_id').lean();
      payload.adminId = String(owner._id);
    } else {
      const admin = await Admin.findOne({ email: payload.email, isEnabled: true }).select('_id email name').lean();
      if (!admin) throw new Error('admin removed or disabled');
      payload.adminId = String(admin._id);
    }
    req.admin = payload; next();
  } catch { res.status(401).json({ error: 'Please log in again.' }); }
}
