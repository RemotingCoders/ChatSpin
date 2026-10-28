import {useI18n} from './i18n';
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
 const {t,formatDate}=useI18n();
    const entries = presentation.entries;
    return <main className="overlay">
    <div className="obs-brand">✦ ChatSpin {state?.demo && <span className="badge">{t("DEMO")}</span>}</div>{error && <p role="alert">{t(error)}</p>}<Wheel spin={presentation.spin} entries={entries} clock={clock}/>
    <span className="eyebrow">{inSpin ? t("THE COMMUNITY IS UP NEXT") : result ? t("THE SPOTLIGHT IS YOURS") : t("WAITING FOR THE NEXT SPIN")}</span>
    <h1>{inSpin ? t("Who\u2019s up next?") : result?.text || t("Every voice deserves a turn.")}</h1>{result && <p>{result.mode === 'questions' ? result.label : t("Your turn to ask a question")}</p>}</main>;
}
