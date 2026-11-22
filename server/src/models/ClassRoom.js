import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
  maxStrength: { type: Number, required: true, min: 1, max: 100000 },
  registeredCount: { type: Number, default: 0, min: 0 },
  activePinCount: { type: Number, default: 0, min: 0 },
  registrationEnabled: { type: Boolean, default: true },
  classCodeEnabled: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null, index: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true }
}, { timestamps: true });

schema.index({ adminId: 1, deletedAt: 1, name: 1 });
export default mongoose.model('ClassRoom', schema);
