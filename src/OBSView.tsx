import { Wheel } from './Wheel';
import type { ViewState } from './types';
import type { Spin } from '../server/domain';
import type { wheelPresentation } from './wheelState';
export function OBSView({ state, error, presentation, clock, inSpin, result }: {
    state: ViewState | null;
    error: string;
    presentation: ReturnType<typeof wheelPresentation>;
    clock: number;
    inSpin: boolean;
    result: Spin | null;
}) {
    const entries = presentation.entries;
    return <main className="overlay">
    <div className="obs-brand">✦ ChatSpin {state?.demo && <span className="badge">DEMO</span>}</div>{error && <p role="alert">{error}</p>}<Wheel spin={presentation.spin} entries={entries} clock={clock}/>
    <span className="eyebrow">{inSpin ? 'THE COMMUNITY IS UP NEXT' : result ? 'THE SPOTLIGHT IS YOURS' : 'WAITING FOR THE NEXT SPIN'}</span>
    <h1>{inSpin ? 'Who’s up next?' : result?.text || 'Every voice deserves a turn.'}</h1>{result && <p>{result.mode === 'questions' ? result.label : 'Your turn to ask a question'}</p>}</main>;
}
