import {useI18n} from './i18n';
import { useState } from 'react';
import type { Act, ViewState } from './types';
export function OperationsPanel({ state, busy, inSpin, act }: {
    state: ViewState;
    busy: boolean;
    inSpin: boolean;
    act: Act;
}) {
 const {t,formatDate}=useI18n();
    const [confirm, setConfirm] = useState<'new-session' | 'rotate-obs' | null>(null);
    const [limits, setLimits] = useState(state.settings || { aiCallLimit: 200, aiTokenLimit: 200000, retentionDays: 30, maxGroups: 2000 });
    return <section className="panel operations-panel">
    <h2>{t("Live session & automation")}</h2>
    <fieldset className="language-settings"><legend>{t('Language settings')}</legend><label>{t('Question language')}<select aria-label={t('Question language')} disabled={busy||inSpin} value={state.questionLanguage||'original'} onChange={e=>act('question-language',{value:e.target.value})}><option value="original">{t('Original language')}</option><option value="en">{t('English')}</option><option value="es">{t('Spanish')}</option><option value="ru">{t('Russian')}</option><option value="de">{t('German')}</option></select></label><p className="help">{t('Translations keep original messages unchanged.')}</p>{state.groups.some(g=>g.translationPending)&&<p className="help" role="status">{t('Translation pending — showing original text.')}</p>}{state.translationStatus&&state.translationStatus!=='Ready'&&<p className="help">{t(state.translationStatus)}</p>}</fieldset>
    <p className="help">{t("Starting a new live session keeps your history and stops reuse of session-only answers. Permanent answers remain active.")}</p>
    <div className="operations-buttons">
    <button className="secondary" disabled={busy || inSpin} onClick={() => setConfirm('new-session')}>{t("Start new live session")}</button>
    <button className="secondary" disabled={busy || inSpin} onClick={() => act('pause-replies', { value: !state.repliesPaused })}>{state.repliesPaused ? t("Resume public replies") : t("Pause public replies")}</button>
    <button className="secondary" disabled={busy || inSpin} onClick={() => act('reprocess')}>{t("Reprocess open questions")}</button>
    <button className="quiet" disabled={busy} onClick={() => setConfirm('rotate-obs')}>{t("Regenerate OBS link")}</button>
    </div>
 {confirm && <div role="alert">
        <p>{confirm === 'rotate-obs' ? t("Invalidate the current OBS link? You must update OBS afterward.") : t("Start a new live session and expire session-only answers? Questions and history are kept.")}</p>
        <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>{t("Cancel")}</button>
        <button className="primary" disabled={busy} onClick={async () => {
                if (await act(confirm, { confirmed: true }))
                    setConfirm(null);
            }}>{t("Confirm")}</button>
        </div>}
 <details>
    <summary>{t("AI limits & retention")}</summary>
    <p className="help">{t("Budget used: ")}{state.aiBudget?.calls || 0}{t(" calls \u00B7 ")}{state.aiBudget?.tokens || 0}{t(" tokens, including failed-call reservations.")}</p>{(['aiCallLimit', 'aiTokenLimit', 'retentionDays', 'maxGroups'] as const).map((key, i) => <label key={key}>{[t("AI calls per live session"), t("AI tokens per live session"), t("Keep questions for days"), t("Maximum question groups")][i]}<input type="number" value={limits[key]} onChange={e => setLimits({ ...limits, [key]: Number(e.target.value) })}/>
        </label>)}<p className="help">{t("Expired questions are archived before hourly removal. Backups are retained separately.")}</p>
    <button className="secondary" disabled={busy} onClick={() => act('limits', { text: JSON.stringify(limits) })}>{t("Save limits")}</button>
    </details>
 <details>
    <summary>{t("Public reply history \u00B7 ")}{state.replyLog?.length || 0}</summary>{state.replyLog?.slice().reverse().map((row, i) => <article className="original" key={i}>
        <small>{formatDate(new Date(row.at))} · {row.user} · {t(row.status)}</small>
        <p>{row.answer}</p>
        </article>)}{!state.replyLog?.length && <p>{t("No automatic replies yet.")}</p>}</details>
    </section>;
}
