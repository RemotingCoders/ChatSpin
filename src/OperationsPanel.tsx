import { useState } from 'react';
import type { Act, ViewState } from './types';
export function OperationsPanel({ state, busy, inSpin, act }: {
    state: ViewState;
    busy: boolean;
    inSpin: boolean;
    act: Act;
}) {
    const [confirm, setConfirm] = useState<'new-session' | 'rotate-obs' | null>(null);
    const [limits, setLimits] = useState(state.settings || { aiCallLimit: 200, aiTokenLimit: 200000, retentionDays: 30, maxGroups: 2000 });
    return <section className="panel operations-panel">
    <h2>Live session & automation</h2>
    <p className="help">Starting a new live session keeps your history and stops reuse of session-only answers. Permanent answers remain active.</p>
    <div className="operations-buttons">
    <button className="secondary" disabled={busy || inSpin} onClick={() => setConfirm('new-session')}>Start new live session</button>
    <button className="secondary" disabled={busy || inSpin} onClick={() => act('pause-replies', { value: !state.repliesPaused })}>{state.repliesPaused ? 'Resume public replies' : 'Pause public replies'}</button>
    <button className="secondary" disabled={busy || inSpin} onClick={() => act('reprocess')}>Reprocess open questions</button>
    <button className="quiet" disabled={busy} onClick={() => setConfirm('rotate-obs')}>Regenerate OBS link</button>
    </div>
 {confirm && <div role="alert">
        <p>{confirm === 'rotate-obs' ? 'Invalidate the current OBS link? You must update OBS afterward.' : 'Start a new live session and expire session-only answers? Questions and history are kept.'}</p>
        <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        <button className="primary" disabled={busy} onClick={async () => {
                if (await act(confirm, { confirmed: true }))
                    setConfirm(null);
            }}>Confirm</button>
        </div>}
 <details>
    <summary>AI limits & retention</summary>
    <p className="help">Budget used: {state.aiBudget?.calls || 0} calls · {state.aiBudget?.tokens || 0} tokens, including failed-call reservations.</p>{(['aiCallLimit', 'aiTokenLimit', 'retentionDays', 'maxGroups'] as const).map((key, i) => <label key={key}>{['AI calls per live session', 'AI tokens per live session', 'Keep questions for days', 'Maximum question groups'][i]}<input type="number" value={limits[key]} onChange={e => setLimits({ ...limits, [key]: Number(e.target.value) })}/>
        </label>)}<p className="help">Expired questions are archived before hourly removal. Backups are retained separately.</p>
    <button className="secondary" disabled={busy} onClick={() => act('limits', { text: JSON.stringify(limits) })}>Save limits</button>
    </details>
 <details>
    <summary>Public reply history · {state.replyLog?.length || 0}</summary>{state.replyLog?.slice().reverse().map((row, i) => <article className="original" key={i}>
        <small>{new Date(row.at).toLocaleString()} · {row.user} · {row.status}</small>
        <p>{row.answer}</p>
        </article>)}{!state.replyLog?.length && <p>No automatic replies yet.</p>}</details>
    </section>;
}
