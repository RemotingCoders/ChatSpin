import 'express-session';
import type {User} from './domain.js';
declare module 'express-session' {
    interface SessionData {
        user: User;
        demo: boolean;
        demoController: boolean;
        oauth: {
            state: string;
            role: string;
            at: number;
        };
    }
}
