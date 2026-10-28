import type { Group, State, User } from '../server/domain';
import type { WheelEntry } from './wheelState';
export type ViewGroup = Group & {
    count: number;answerActive?:boolean;
};
export type ViewState = Omit<State, 'groups'> & {
    groups: ViewGroup[];
    obsUrl?: string;
    entries?: WheelEntry[];
    serverTime: number;
};
export type Session = {
    user: User | null;
    controller: boolean;
    demo: boolean;
    demoEnabled: boolean;
    configured: boolean;
    connection: string;
    storageNotice?:string;chatReplies?: string;
    ai: string;
};
export type Act = (type: string, fields?: Record<string, unknown>) => Promise<boolean>;
