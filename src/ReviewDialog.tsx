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
    const [title, setTitle] = useState(group.title), [answer, setAnswer] = useState(group.answer), [target, setTarget] = useState(group.review || ''), [scope, setScope] = useState(group.answerScope || 'session'), [choice, setChoice] = useState('');
    const targetGroup = groups.find(g => g.id === target);
    const conflict = !!group.answer && !!targetGroup?.answer && group.answer !== targetGroup.answer;
    return <div className="modal-backdrop" onClick={() => !busy && close()}>
    <section className="modal panel review-modal" role="dialog" aria-modal="true" aria-label="Review question" onClick={e => e.stopPropagation()}>
 <div className="panel-heading">
    <h2>Review question</h2>
    <button className="quiet" autoFocus disabled={busy} onClick={close} aria-label="Close question">×</button>
    </div>
 <div className="review-body">
    <h3>{group.text}</h3>{group.status === 'written' && group.answerActive === false && <p className="help">This answer belongs to an earlier live session. Save it again to approve reuse, or edit it first.</p>}<label>Group title<input value={title} maxLength={60} onChange={e => setTitle(e.target.value)}/>
    </label>
    <button className="secondary" disabled={busy || inSpin} onClick={() => act('edit', { id: group.id, title })}>Save title</button>
 <details className="review-details">
    <summary>Original questions · {group.questions.length} messages · {group.count} people</summary>{group.questions.map(q => <div className="original" key={q.id}>
        <small>{q.user.name} · {new Date(q.at).toLocaleString()}</small>
        <p>{q.text}</p>{group.questions.length > 1 && <button className="quiet" disabled={busy || inSpin} onClick={() => act('split', { id: group.id, target: q.id })}>Split into a separate question ↗</button>}</div>)}</details>
 <details className="review-details" open={!!group.review}>
    <summary>{group.review ? 'Grouping needs review' : 'Review grouping'}</summary>
    <label>Merge with an equivalent question<select value={target} onChange={e => { setTarget(e.target.value); setChoice(''); }}>
    <option value="">Select a group</option>{groups.filter(g => g.id !== group.id).map(g => <option key={g.id} value={g.id}>{g.title} ({g.status})</option>)}</select>
    </label>{targetGroup && <blockquote>{targetGroup.text}<p>{targetGroup.answer}</p>
        </blockquote>}
 {conflict && <label>These groups have different saved answers. Keep:<select value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="">Choose an answer</option>
        <option value="source">This question’s answer</option>
        <option value="target">Destination question’s answer</option>
        </select>
        </label>}
 <button className="secondary" disabled={!target || busy || inSpin || (conflict && !choice)} onClick={async () => {
            if (await act('merge', { id: group.id, target, value: choice }))
                close();
        }}>Approve equivalence & merge</button>{group.review && <button className="quiet" disabled={busy} onClick={() => act('dismiss', { id: group.id })}>Keep separate</button>}</details>
 <label>Written answer (optional)<textarea value={answer} maxLength={2000} onChange={e => setAnswer(e.target.value)}/>
    </label>
 <label>Reuse this answer<select value={scope} onChange={e => setScope(e.target.value as 'session' | 'permanent')}>
    <option value="session">This live session only</option>
    <option value="permanent">Across live sessions</option>
    </select>
    </label>
 {!!group.answerHistory?.length && <details>
        <summary>Previous answers</summary>{[...group.answerHistory].reverse().map((h, i) => <blockquote key={i}>
            <small>{new Date(h.at).toLocaleString()}</small>
            <p>{h.text}</p>
            <button className="quiet" disabled={busy} onClick={() => setAnswer(h.text)}>Use this version</button>
            </blockquote>)}</details>}
 </div>
    <div className="modal-actions review-actions">
    <p className="help">Approved text may be reused publicly in Twitch chat. Without text, mark answered live.</p>
    <button className="primary" disabled={busy || inSpin} onClick={async () => {
            const written = answer.trim();
            if (await act(written ? 'answer' : 'live', { id: group.id, text: written, value: scope })) {
                answered(!!written);
                close();
            }
        }}>{busy ? 'Saving…' : 'Mark answered'}</button>{group.status !== 'pending' && <button className="quiet" disabled={busy || inSpin} onClick={() => act('reopen', { id: group.id })}>Reopen question</button>}</div>
    </section>
    </div>;
}
