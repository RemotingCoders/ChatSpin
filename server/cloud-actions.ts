import { checkReviewVersion } from './domain.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import {
  addQuestion,
  cleanupAnswerTranslations,
  approveQuestion,
  merge,
  split,
  spin,
  rememberAnswer,
  type State,
  type User,
} from './domain.js';
import { clearCollection } from './reset.js';
import { ApprovedAnswerTranslations } from './answer-translations.js';
import { questionPresentation } from './presentation.js';
const schema = z
  .object({
    type: z.string().max(30),
    id: z.string().max(100).optional(),
    target: z.string().max(100).optional(),
    text: z.string().max(2000).optional(),
    title: z.string().max(60).optional(),
    value: z.union([z.boolean(), z.string().max(30)]).optional(),
    expected: z.string().length(64).optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();
function applyDashboardAction(s: State, user: User, body: unknown) {
  const action = schema.parse(body),
    group = s.groups.find((g) => g.id === action.id);
  checkReviewVersion(group, action.expected);
  if (s.spin && s.spin.end > Date.now() && action.type !== 'ui-language')
    throw Object.assign(Error('Wait for the current spin to finish.'), { status: 409 });
  const enqueue = (id: string) => {
    s.aiJobs ||= [];
    if (!s.aiJobs.some((job) => job.id === id)) s.aiJobs.push({ id, attempts: 0, next: 0 });
  };
  switch (action.type) {
    case 'set-moderators':
      (s as State & { moderatorIds: string[] }).moderatorIds = [
        ...new Set(
          z
            .array(z.string().regex(/^\d{1,30}$/))
            .max(20)
            .parse(JSON.parse(action.text || '[]')),
        ),
      ];
      break;
    case 'approve-question':
      approveQuestion(s, action.id!);
      break;
    case 'ask': {
      const g = addQuestion(s, user, z.string().trim().min(3).max(500).parse(action.text));
      enqueue(g.id);
      break;
    }
    case 'support':
      if (!group || group.status !== 'pending') throw Error('Choose a pending question.');
      if (!group.supporters.includes(user.id)) group.supporters.push(user.id);
      break;
    case 'join':
      if (!s.registration) throw Error('Registration is closed.');
      if (!s.participants.some((p) => p.id === user.id))
        s.participants.push({ ...user, selected: false });
      break;
    case 'leave':
      s.participants = s.participants.filter((p) => p.id !== user.id);
      break;
    case 'settings':
      if (action.value === 'questions' || action.value === 'participants') s.mode = action.value;
      else s.odds = z.enum(['equal', 'support', 'manual']).parse(action.value);
      break;
    case 'registration':
      s.registration = z.boolean().parse(action.value);
      break;
    case 'exclude':
      s.excludeSelected = z.boolean().parse(action.value);
      break;
    case 'spin':
      spin(s, action.id);
      break;
    case 'answer':
    case 'live':
      if (!group) throw Error('Question not found.');
      rememberAnswer(group);
      group.answer =
        action.type === 'answer' ? z.string().trim().min(1).max(2000).parse(action.text) : '';
      group.status = group.answer ? 'written' : 'live';
      group.answerScope = action.value === 'permanent' ? 'permanent' : 'session';
      group.answerSession = s.liveSession;
      break;
    case 'reopen':
      if (!group) throw Error('Question not found.');
      rememberAnswer(group);
      group.status = 'pending';
      group.answer = '';
      group.aiProcessed = false;
      enqueue(group.id);
      break;
    case 'edit': {
      if (!group) throw Error('Question not found.');
      const language = s.questionLanguage || 'original';
      if (action.value && action.value !== language)
        throw Error('Question language changed. Reopen the question before editing its title.');
      const title = z.string().trim().min(1).max(60).parse(action.title);
      if (language === 'original') {
        group.title = title;
        group.customTitle = title;
      } else {
        const cached = group.translations?.[language];
        if (!cached || questionPresentation(s, group).pending)
          throw Error('Wait for translation before editing this title.');
        cached.title = title;
      }
      break;
    }
    case 'merge':
      merge(
        s,
        action.id!,
        action.target!,
        true,
        action.value === 'source' || action.value === 'target' ? action.value : undefined,
      );
      break;
    case 'split':
      split(s, action.id!, action.target!);
      break;
    case 'dismiss':
      if (group) delete group.review;
      break;
    case 'clear-questions':
    case 'clear-participants':
      if (action.confirmed !== true) throw Error('Confirm before clearing this collection.');
      clearCollection(
        s,
        action.type === 'clear-questions' ? 'questions' : 'participants',
        () => {},
      );
      break;
    case 'pause-replies':
      s.repliesPaused = z.boolean().parse(action.value);
      break;
    case 'limits':
      throw Object.assign(Error('AI budgets are managed by the service operator.'), {
        status: 403,
      });
    case 'new-session':
      if (action.confirmed !== true) throw Error('Confirm starting a new live session.');
      s.liveSession = randomBytes(12).toString('hex');
      cleanupAnswerTranslations(s, 'new-session');
      s.usage = { calls: 0, input: 0, output: 0 };
      s.aiBudget = { calls: 0, tokens: 0 };
      break;
    case 'ui-language':
      s.uiLanguage = z.enum(['en', 'es', 'ru', 'de']).parse(action.value);
      break;
    case 'question-language':
      if (!process.env.OPENAI_API_KEY && action.value !== 'original')
        throw Error('Configure OpenAI to translate questions.');
      s.questionLanguage = z.enum(['original', 'en', 'es', 'ru', 'de']).parse(action.value);
      break;
    case 'reprocess':
      for (const g of s.groups)
        if (g.status === 'pending') {
          g.aiProcessed = false;
          enqueue(g.id);
        }
      for (const job of s.aiJobs || []) {
        job.attempts = 0;
        job.next = 0;
        job.failed = false;
      }
      for (const g of s.groups) delete g.translationAttempts;
      new ApprovedAnswerTranslations(s, () => {}).retry();
      break;
    default:
      throw Error('Unknown action.');
  }
  return ['clear-questions', 'clear-participants', 'new-session'].includes(action.type);
}

export function cloudDashboardAction(...args: Parameters<typeof applyDashboardAction>) {
  try {
    return applyDashboardAction(...args);
  } catch (error) {
    if (error instanceof Error && !('status' in error)) Object.assign(error, { status: 400 });
    throw error;
  }
}
