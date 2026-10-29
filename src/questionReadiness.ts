import type { QuestionReadiness } from '../server/presentation';
export const readinessLabel: Record<QuestionReadiness, string> = {
  manual_review: 'Manual review required — AI is not configured',
  answered: 'Answered',
  ready: 'Ready for the wheel',
  grouping: 'Checking for previous answers…',
  grouping_failed: 'Question check failed — review or retry',
  translation: 'Waiting for translation…',
  translation_failed: 'Translation failed — retry required',
};
export const needsManualReview = (readiness?: QuestionReadiness) =>
  readiness === 'manual_review' || readiness === 'grouping' || readiness === 'grouping_failed';
