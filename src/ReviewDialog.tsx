import {useI18n} from './i18n';
import { useState } from 'react';
import type { Act, ViewGroup } from './types';
export function ReviewDialog({ group, groups, busy, inSpin, act, close, answered }: {
    group: ViewGroup;
    groups: ViewGroup[];
    busy: boolean;
    inSpin: boolean;
    act: Act;
    close: () => void;
    answered: (written: boolean) => void;
}) {
 const {t,formatDate}=useI18n();
    const [title, setTitle] = useState(group.title), [answer, setAnswer] = useState(group.answer), [target, setTarget] = useState(group.review || ''), [scope, setScope] = useState(group.answerScope || 'session'), [choice, setChoice] = useState('');
    const targetGroup = groups.find(g => g.id === target);
    const conflict = !!group.answer && !!targetGroup?.answer && group.answer !== targetGroup.answer;
    return <div className="modal-backdrop" onClick={() => !busy && close()}>
    <section className="modal panel review-modal" role="dialog" aria-modal="true" aria-label={t("Review question")} onClick={e => e.stopPropagation()}>
 <div className="panel-heading">
    <h2>{t("Review question")}</h2>
    <button className="quiet" autoFocus disabled={busy} onClick={close} aria-label={t("Close question")}>×</button>
    </div>
 <div className="review-body">
    <h3>{group.text}</h3>{group.status === 'written' && group.answerActive === false && <p className="help">{t("This answer belongs to an earlier live session. Save it again to approve reuse, or edit it first.")}</p>}<label>{t("Group title")}<input value={title} maxLength={60} onChange={e => setTitle(e.target.value)}/>
    </label>
    <button className="secondary" disabled={busy || inSpin} onClick={() => act('edit', { id: group.id, title,value:group.displayLanguage||'original' })}>{t("Save title")}</button>
 <details className="review-details">
    <summary>{t('Original messages: {v0} · People: {v1}',{v0:group.questions.length,v1:group.count})}</summary>{group.questions.map(q => <div className="original" key={q.id}>
        <small>{q.user.name} · {formatDate(new Date(q.at))}</small>
        <p>{q.text}</p>{group.questions.length > 1 && <button className="quiet" disabled={busy || inSpin} onClick={() => act('split', { id: group.id, target: q.id })}>{t("Split into a separate question \u2197")}</button>}</div>)}</details>
 <details className="review-details" open={!!group.review}>
    <summary>{group.review ? t("Grouping needs review") : t("Review grouping")}</summary>
    <label>{t("Merge with an equivalent question")}<select value={target} onChange={e => { setTarget(e.target.value); setChoice(''); }}>
    <option value="">{t("Select a group")}</option>{groups.filter(g => g.id !== group.id).map(g => <option key={g.id} value={g.id}>{g.title} ({g.status})</option>)}</select>
    </label>{targetGroup && <blockquote>{targetGroup.text}<p>{targetGroup.answer}</p>
        </blockquote>}
 {conflict && <label>{t("These groups have different saved answers. Keep:")}<select value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="">{t("Choose an answer")}</option>
        <option value="source">{t("This question\u2019s answer")}</option>
        <option value="target">{t("Destination question\u2019s answer")}</option>
        </select>
        </label>}
 <button className="secondary" disabled={!target || busy || inSpin || (conflict && !choice)} onClick={async () => {
            if (await act('merge', { id: group.id, target, value: choice }))
                close();
        }}>{t("Approve equivalence & merge")}</button>{group.review && <button className="quiet" disabled={busy} onClick={() => act('dismiss', { id: group.id })}>{t("Keep separate")}</button>}</details>
 <label>{t("Written answer (optional)")}<textarea value={answer} maxLength={2000} onChange={e => setAnswer(e.target.value)}/>
    </label>
 <label>{t("Reuse this answer")}<select value={scope} onChange={e => setScope(e.target.value as 'session' | 'permanent')}>
    <option value="session">{t("This live session only")}</option>
    <option value="permanent">{t("Across live sessions")}</option>
    </select>
    </label>
 {!!group.answerHistory?.length && <details>
        <summary>{t("Previous answers")}</summary>{[...group.answerHistory].reverse().map((h, i) => <blockquote key={i}>
            <small>{formatDate(new Date(h.at))}</small>
            <p>{h.text}</p>
            <button className="quiet" disabled={busy} onClick={() => setAnswer(h.text)}>{t("Use this version")}</button>
            </blockquote>)}</details>}
 </div>
    <div className="modal-actions review-actions">
    <p className="help">{t("Approved text may be reused publicly in Twitch chat. Without text, mark answered live.")}</p>
    <button className="primary" disabled={busy || inSpin} onClick={async () => {
            const written = answer.trim();
            if (await act(written ? 'answer' : 'live', { id: group.id, text: written, value: scope })) {
                answered(!!written);
                close();
            }
        }}>{busy ? t("Saving\u2026") : t("Mark answered")}</button>{group.status !== 'pending' && <button className="quiet" disabled={busy || inSpin} onClick={() => act('reopen', { id: group.id })}>{t("Reopen question")}</button>}</div>
    </section>
    </div>;
}
