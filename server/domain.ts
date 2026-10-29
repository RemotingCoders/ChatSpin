import {seedDemoTranslations} from './demoTranslations.js';
import {questionPresentation,type QuestionLanguage,type QuestionTranslation} from './presentation.js';
import { createHash, randomInt, randomUUID } from 'node:crypto';
export type User = {
    id: string;
    name: string;
    login?: string;
};
export type Question = {
    id: string;
    user: User;
    text: string;
    at: number;
    messageId?: string;
};
export type Group = {
 customTitle?:string;translations?:Partial<Record<'en'|'es'|'ru'|'de',QuestionTranslation>>;translationAttempts?:Partial<Record<'en'|'es'|'ru'|'de',{source:string;attempts:number;next:number}>>;
    id: string;
    title: string;
    text: string;
    questions: Question[];
    supporters: string[];
    status: 'pending' | 'live' | 'written';
    answer: string;
    embedding?: {
        model: string;
        vector: number[];
    };
    aiProcessed?: boolean;
    review?: string;
    contextual?: boolean;
    answerScope?: 'session' | 'permanent';
    answerSession?: string;
    answerHistory?: {
        text: string;
        at: number;
    }[];
};
export type Spin = {
    id: string;
    mode: 'questions' | 'participants';
    candidates: {
        id: string;
        label: string;
        weight: number;
    }[];
    winner: string;
    label: string;
    text: string;
    start: number;
    end: number;
};
export type State = {
 questionLanguage?:QuestionLanguage;uiLanguage?:'en'|'es'|'ru'|'de';
    groups: Group[];
    participants: (User & {
        selected: boolean;
    })[];
    registration: boolean;
    excludeSelected: boolean;
    mode: 'questions' | 'participants';
    odds: 'equal' | 'support' | 'manual';
    spin: Spin | null;
    usage: {
        calls: number;
        input: number;
        output: number;
    };
    demo: boolean;
    settings?: {
        aiCallLimit: number;
        aiTokenLimit: number;
        retentionDays: number;
        maxGroups: number;
    };
    aiBudget?: {
        calls: number;
        tokens: number;
    };
    liveSession?: string;
    aiJobs?: {
        id: string;
        attempts: number;
        next: number;
        failed?: boolean;
    }[];
    pendingMessages?: {
        user: User;
        text: string;
        messageId: string;
        at: number;
        originalId?: string;
        detected?: boolean;
        attempts: number;
        next: number;
    }[];
    repliesPaused?: boolean;
    replyJobs?: {
        questionText?: string;
        groupId: string;
        userId: string;
        messageId: string;
        answer: string;
        parts: string[];
        next: number;
        created: number;
        sending?: boolean;
    }[];
    replyLog?: {
        at: number;
        messageId: string;
        groupId: string;
        user: string;
        answer: string;
        status: string;
    }[];
    replyHistory?: Record<string, number>;
};
export const emptyState = (demo = false): State => ({ liveSession: randomUUID(), groups: [], participants: [], registration: true, excludeSelected: true, mode: 'questions', odds: 'equal', spin: null, usage: { calls: 0, input: 0, output: 0 }, demo });
export const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export const momentQuestion = (text: string) => /\b(?:what are you (?:doing|trying|working)|what.*(?:right now|at the moment)|qué (?:estás|estas) (?:haciendo|intentando|construyendo)|en qu[eé] (?:estás|estas) trabajando)\b/iu.test(text);
export const support = (g: Group) => new Set([...g.questions.map(q => q.user.id), ...g.supporters]).size;
import { settings } from './limits.js';
export function addQuestion(s: State, user: User, text: string, messageId?: string, at = Date.now()) {
    const now = at;
    const exact = s.groups.find(g => g.questions.some(q => normalize(q.text) === normalize(text)) && (g.status === 'pending' ? withinWindow(g, now) : answerIsActive(s, g) && (!g.contextual || withinWindow(g, now))));
    if (exact?.questions.some(q => q.user.id === user.id && normalize(q.text) === normalize(text)))
        return exact;
    const q: Question = { id: randomUUID(), user, text, at, ...(messageId ? { messageId } : {}) };
    if (exact) {
        exact.questions.push(q);
        return exact;
    }
    if (s.groups.length >= settings(s).maxGroups)
        throw new Error('Question limit reached. Archive or clear questions before adding more.');
    const group: Group = { id: randomUUID(), title: text.slice(0, 48), text, contextual: momentQuestion(text), questions: [q], supporters: [], status: 'pending', answer: '' };
    s.groups.push(group);
    return group;
}
export const CONTEXT_WINDOW_MS = 5 * 60 * 1000;
export const withinWindow = (g: Group, now: number) => g.questions.every(q => Math.abs(now - q.at) <= CONTEXT_WINDOW_MS);
export const answerIsActive = (s: State, g: Group) => g.status === 'written' && Boolean(g.answer.trim()) && (g.answerScope === 'permanent' || !g.answerSession || g.answerSession === s.liveSession);
export function rememberAnswer(g: Group) {
    if (g.answer.trim()) {
        g.answerHistory ||= [];
        g.answerHistory.push({ text: g.answer, at: Date.now() });
        g.answerHistory = g.answerHistory.slice(-20);
    }
}
export function merge(s: State, from: string, to: string, approved = false, choice?: 'source' | 'target') {
    const source = s.groups.find(g => g.id === from), target = s.groups.find(g => g.id === to);
    if (!source || !target || source === target)
        throw new Error('Choose two different groups.');
    if (target.status !== 'pending' && !approved) {
        source.review = target.id;
        return;
    }
    if (source.answer && target.answer && source.answer !== target.answer && !choice)
        throw new Error('Both groups have different saved answers. Choose which answer to keep.');
    const history = [...(target.answerHistory || []), ...(source.answerHistory || [])];
    if (source.answer)
        history.push({ text: source.answer, at: Date.now() });
    if (target.answer)
        history.push({ text: target.answer, at: Date.now() });
    if ((source.answer && !target.answer) || choice === 'source') {
        target.answer = source.answer;
        target.status = source.status;
        target.answerScope = source.answerScope;
        target.answerSession = source.answerSession;
    }
    target.answerHistory = history.slice(-20);
    target.contextual = source.contextual || target.contextual;
    target.questions.push(...source.questions);
    target.supporters = [...new Set([...target.supporters, ...source.supporters])];
    s.groups = s.groups.filter(g => g !== source);
}
export function split(s: State, groupId: string, questionId: string) {
    const group = s.groups.find(g => g.id === groupId);
    const q = group?.questions.find(q => q.id === questionId);
    if (!group || !q || group.questions.length < 2)
        throw new Error('A group must retain at least one original.');
    group.questions = group.questions.filter(x => x.id !== questionId);
    const fresh: Group = { id: randomUUID(), title: q.text.slice(0, 48), text: q.text, questions: [q], supporters: [], status: 'pending', answer: '' };
    s.groups.push(fresh);
    return fresh;
}
export function eligibleEntries(s: State) {
    return s.mode === 'questions'
        ? s.groups.filter(g => g.status === 'pending' && (s.demo || g.aiProcessed === true) && !questionPresentation(s,g).pending).map(g => ({ id: g.id, label: questionPresentation(s,g).title, weight: s.odds === 'support' ? support(g) : 1 }))
        : s.participants.filter(p => !s.excludeSelected || !p.selected).map(p => ({ id: p.id, label: p.name, weight: 1 }));
}
export function spin(s: State, manualId?: string, now = Date.now()): Spin {
    if (s.spin && s.spin.end > now)
        throw new Error('A spin is already in progress.');
    const candidates = eligibleEntries(s);
    if (!candidates.length)
        throw new Error('No eligible entries yet.');
    let winner;
    if (s.mode === 'questions' && (s.odds === 'manual' || manualId)) {
        winner = candidates.find(c => c.id === manualId);
        if (!winner)
            throw new Error('Choose an eligible question.');
    }
    else {
        let ticket = randomInt(candidates.reduce((sum, c) => sum + c.weight, 0));
        winner = candidates.find(c => (ticket -= c.weight) < 0)!;
    }
    const question = s.groups.find(g => g.id === winner.id);
    s.spin = { id: randomUUID(), mode: s.mode, candidates, winner: winner.id, label: winner.label, text: question?questionPresentation(s,question).text:winner.label, start: now, end: now + (manualId ? 0 : 6000) };
    if (s.mode === 'participants')
        s.participants.find(p => p.id === winner.id)!.selected = true;
    return s.spin;
}
export function demoState() {
    const s = emptyState(true);
    const entries = [
        ['Finding your first community', 'What would you focus on to grow a small Twitch community?', 12],
        ['Your streaming setup', 'What equipment would you recommend for someone starting out?', 8],
        ['Avoiding creator burnout', 'How do you keep streaming without burning out?', 6],
        ['The next chapter', 'What is one thing you want to try on stream this year?', 4],
        ['A little advice', '¿Qué consejo le darías a tu yo de hace cinco años?', 1],
        ['Behind the scenes', 'How do you plan a stream before going live?', 3],
    ] as const;
    for (const [title, text, count] of entries) {
        const g = addQuestion(s, { id: `sample-${title}`, name: ['pixelpilot', 'mintbyte', 'lunarose', 'cozycat', 'mateo', 'orbit'][s.groups.length] }, text);
        g.title = title;
        g.supporters = Array.from({ length: count - 1 }, (_, i) => `${title}-${i}`);
    }
    seedDemoTranslations(s.groups);
    s.participants = ['pixelpilot', 'lunarose', 'cozycat', 'mintbyte', 'orbit'].map(name => ({ id: `sample-${name}`, name, selected: false }));
    return s;
}

// A deliberate owner review may bypass model grouping, never the selected translation.
export function approveQuestion(s:State,id:string){
 const group=s.groups.find(g=>g.id===id);
 if(!group||group.status!=='pending')throw Error('Choose a pending question.');
 group.aiProcessed=true;delete group.review;
 s.aiJobs=s.aiJobs?.filter(job=>job.id!==id);
}

/** Drop derived answer text and work that no longer belongs to active content.
 * This never changes the approved originals or previously created backups. */
export function cleanupAnswerTranslations(s:State,mode:'prune'|'clear'|'new-session'='prune'){
 const data=s as State&{answerTranslationJobs?:{groupId:string;source:string;questionText?:string}[];approvedAnswerTranslations?:Record<string,{source:string}>;answerLanguageCache?:Record<string,unknown>};
 const before=JSON.stringify([data.answerTranslationJobs,data.approvedAnswerTranslations,data.answerLanguageCache]);
 if(mode==='clear'){
  delete data.answerTranslationJobs;delete data.approvedAnswerTranslations;delete data.answerLanguageCache;
 }else{
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const active=new Map(s.groups.filter(g=>answerIsActive(s,g)).map(g=>[g.id,hash(g.answer)]));
  const sources=new Set(active.values());
  if(data.answerTranslationJobs)data.answerTranslationJobs=mode==='new-session'?[]:data.answerTranslationJobs.filter(j=>active.get(j.groupId)===j.source);
  if(data.approvedAnswerTranslations)for(const [key,value]of Object.entries(data.approvedAnswerTranslations))if(!sources.has(value.source))delete data.approvedAnswerTranslations[key];
  const questions=new Set(s.groups.flatMap(g=>g.questions.map(q=>hash(q.text.trim()))));
  for(const job of data.answerTranslationJobs||[])if(job.questionText)questions.add(hash(job.questionText.trim()));
  if(data.answerLanguageCache)for(const key of Object.keys(data.answerLanguageCache))if(mode==='new-session'||!questions.has(key))delete data.answerLanguageCache[key];
 }
 return before!==JSON.stringify([data.answerTranslationJobs,data.approvedAnswerTranslations,data.answerLanguageCache]);
}

// Optimistic edit token excludes votes and AI metadata so chat activity cannot block editing.
export function reviewVersion(g:Group){return createHash('sha256').update(JSON.stringify([g.title,g.customTitle,g.answer,g.status,g.answerScope,g.answerSession,Object.entries(g.translations||{}).map(([language,value])=>[language,value.title])])).digest('hex');}
export function checkReviewVersion(g:Group|undefined,expected?:string){if(expected&&(!g||reviewVersion(g)!==expected))throw Object.assign(Error('This question was edited by someone else. Reopen it before saving.'),{status:409});}
