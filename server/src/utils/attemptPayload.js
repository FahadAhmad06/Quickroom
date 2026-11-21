// What the student receives: questions and options only - never correct answers, and for
// subjective questions never the rubric, key concepts, or model answer.
// serverNow lets the client correct for a skewed device clock; the server stays the timing authority.
export default function attemptPayload(attempt, paper) {
  const a = attempt.toObject ? attempt.toObject() : attempt;
  return {
    attemptId: a._id, perQ: paper.perQ ?? a.perQ ?? 0, timingMode: a.timingMode || paper.timingMode || 'perQuestion',
    customDuration: a.customDuration ?? paper.customDuration ?? 0, preview: a.preview,
    tabSwitchLimitEnabled: typeof a.tabSwitchLimitEnabled === 'boolean'
      ? a.tabSwitchLimitEnabled
      : (typeof paper.tabSwitchLimitEnabled === 'boolean' ? paper.tabSwitchLimitEnabled : true),
    tabSwitchLimit: typeof a.tabSwitchLimit === 'number'
      ? a.tabSwitchLimit
      : (typeof paper.tabSwitchLimit === 'number' ? paper.tabSwitchLimit : 3),
    tabSwitchCount: a.tabSwitchCount || 0,
    examStatus: a.examStatus || 'in_progress',
    suspensionReason: a.suspensionReason || null,
    idx: a.idx, answers: a.answers, subjectiveText: a.subjectiveText || [], qEnd: a.qEnd, startedAt: a.startedAt,
    serverNow: Date.now(),
    title: a.paperTitle || paper.title || 'Quiz',
    run: a.run.map(q => q.type === 'subjective'
      ? { type: 'subjective', text: q.text, maxMarks: q.maxMarks, instructions: q.instructions }
      : { type: q.type || 'mcq', text: q.text, options: q.options })
  };
}
