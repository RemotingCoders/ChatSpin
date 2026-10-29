import type { Group, State, User } from '../server/domain';
import type { WheelEntry } from './wheelState';
export type ViewGroup = Group & {
    reviewVersion?:string;displayLanguage?:'original'|'en'|'es'|'ru'|'de';originalText?:string;originalTitle?:string;translationPending?:boolean;readiness?:import('../server/presentation').QuestionReadiness;count: number;answerActive?:boolean;
};
export type ViewState = Omit<State, 'groups'> & {
    groups: ViewGroup[];
    hosted?:boolean;moderatorIds?:string[];
    obsUrl?: string;
    entries?: WheelEntry[];
    serverTime: number;translationStatus?:string;translationPending?:boolean;
};
export type Session = {
    user: User | null;
    controller: boolean;
    demo: boolean;
    demoEnabled: boolean;
    configured: boolean;
    connection: string;
    uiLanguage?:'en'|'es'|'ru'|'de';storageNotice?:string;chatReplies?: string;
    ai: string;
};
export type Act = (type: string, fields?: Record<string, unknown>) => Promise<boolean>;
