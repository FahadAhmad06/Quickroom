import connectDb from '../src/db.js';
import Student from '../src/models/Student.js';
import AllowedRollNumber from '../src/models/AllowedRollNumber.js';
import Paper from '../src/models/Paper.js';
import ClassRoom from '../src/models/ClassRoom.js';

await connectDb();

const legacyArchived = await ClassRoom.find({ archived: true, deletedAt: null }).select('_id').lean();
const legacyClassIds = legacyArchived.map(c => c._id);
if (legacyClassIds.length) {
  await Promise.all([
    ClassRoom.updateMany({ _id: { $in: legacyClassIds } }, {
      $set: { deletedAt: new Date(), registrationEnabled: false, classCodeEnabled: false, registeredCount: 0, activePinCount: 0 }
    }),
    Student.updateMany({ classIds: { $in: legacyClassIds } }, { $pullAll: { classIds: legacyClassIds } }),
    AllowedRollNumber.deleteMany({ classId: { $in: legacyClassIds }, isRegistered: false }),
    AllowedRollNumber.updateMany({ classId: { $in: legacyClassIds }, isRegistered: true }, {
      $set: { classId: null, isEnabled: false }
    }),
    Paper.updateMany({ assignedClassIds: { $in: legacyClassIds } }, { $pullAll: { assignedClassIds: legacyClassIds } })
  ]);
}

const [students, rolls, papers] = await Promise.all([
  Student.updateMany({ classIds: { $exists: false } }, { $set: { classIds: [] } }),
  AllowedRollNumber.updateMany({ classId: { $exists: false } }, { $set: { classId: null, className: null } }),
  Paper.updateMany(
    { assignmentVersion: { $exists: false } },
    { $set: { assignmentVersion: 1, assignedClassIds: [], assignAllClasses: false } }
  )
]);

console.log(JSON.stringify({
  studentsUpdated: students.modifiedCount,
  rollsUpdated: rolls.modifiedCount,
  legacyPapersMarked: papers.modifiedCount,
  legacyArchivedClassesRemoved: legacyClassIds.length
}));
process.exit(0);
