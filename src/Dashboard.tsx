import type { Spin } from '../server/domain';
import type { ViewState, ViewGroup, Session, Act } from './types';
import { Wheel } from './Wheel';
import { wheelPresentation, type WheelEntry } from './wheelState';
export function Dashboard({ state, presentation, entries, clock, inSpin, busy, act, result, groups, filter, setFilter, search, setSearch, showGroup, total, session }: {
    state: ViewState;
    presentation: ReturnType<typeof wheelPresentation>;
    entries: WheelEntry[];
    clock: number;
    inSpin: boolean;
    busy: boolean;
    act: Act;
    result: Spin | null;
    groups: ViewGroup[];
    filter: string;
    setFilter: (value: string) => void;
    search: string;
    setSearch: (value: string) => void;
    showGroup: (g: ViewGroup) => void;
    total: number;
    session: Session;
}) {
    return <div className="dashboard-grid">
    <section className="panel wheel-panel">
    <div className="panel-heading">
    <h2>{state.mode === 'questions' ? 'The question wheel' : 'The participant wheel'}</h2>
    <span className="badge neutral">{entries.length} ELIGIBLE</span>
    </div>
    <p className="muted">A small spin. A new conversation.</p>
    <Wheel spin={presentation.spin} entries={entries} clock={clock}/>
    <div className="wheel-controls">{state.mode === 'questions' ? <>
        <label htmlFor="odds">Selection method</label>
        <select id="odds" value={state.odds} disabled={busy || inSpin} onChange={e => act('settings', { value: e.target.value })}>
        <option value="equal">Equal chances</option>
        <option value="support">By support</option>
        <option value="manual">Manual selection</option>
        </select>
        <p className="help">{state.odds === 'equal' ? 'Every open group has the same chance, including single questions.' : state.odds === 'support' ? 'Chances follow distinct supporters. One person counts once per group.' : 'Choose “Spotlight” on an open question to select it directly.'}</p>
        </> : <>
        <label className="check">
        <input type="checkbox" checked={state.registration} disabled={inSpin} onChange={e => act('registration', { value: e.target.checked })}/> Registration open</label>
        <label className="check">
        <input type="checkbox" checked={state.excludeSelected} disabled={inSpin} onChange={e => act('exclude', { value: e.target.checked })}/> Exclude previously selected people</label>
        <p className="help">Use !join to enter and !leave to withdraw. No microphone or call is started.</p>
        </>}<button className="primary spin-button" disabled={busy || inSpin || !entries.length || (state.mode === 'questions' && state.odds === 'manual')} onClick={() => act('spin')}>{inSpin ? '✦ Finding the next voice…' : '✦ Spin the wheel'}<span>↗</span>
    </button>
    <small className="wheel-caption">{session.demo ? 'Demo spin · simulated community' : 'Chosen securely · synchronized with OBS'}</small>
    </div>
    <details className="chances">
    <summary>View exact chances</summary>{result && <p className="help">{presentation.spin ? 'The wheel shows the last draw. These chances apply to the next spin.' : 'The wheel is ready for the next draw. The last result remains in the spotlight.'}</p>}{entries.map((e, i) => <div key={e.id}>
        <span>{i + 1}. {e.label}</span>
        <b>{state.mode === 'questions' && state.odds === 'manual' ? 'Manual' : `${(e.weight / total * 100).toFixed(2)}%`}</b>
        </div>)}{!entries.length && <p>No eligible entries yet.</p>}</details>
    </section>
    <div className="right-stack">
    <section className={'panel spotlight ' + (result ? 'has-result' : '')}>
    <div className="panel-heading">
    <h2>
    <span className="mint-text">✧</span> In the spotlight</h2>
    <span className="live-label">{inSpin ? 'SPINNING' : result ? 'SELECTED' : 'READY'}</span>
    </div>
    <div className="spotlight-content">
    <span className="spotlight-orbit">{inSpin ? '✦' : result ? '✧' : '◌'}</span>
    <span className="eyebrow">{inSpin ? 'A MOMENT OF POSSIBILITY' : result ? 'THE SPOTLIGHT IS YOURS' : 'THE NEXT CONVERSATION STARTS HERE'}</span>
    <h2>{inSpin ? 'Who’s up next?' : result?.text || 'Make room for a new voice.'}</h2>
    <p>{result ? result.label : 'Spin the wheel to bring a community question into the spotlight.'}</p>{result?.mode === 'questions' && <button className="secondary" onClick={() => {
                const g = groups.find(g => g.id === result.winner);
                if (g)
                    showGroup(g);
            }}>Review & answer →</button>}</div>
    </section>
    <section className="panel queue">
    <div className="panel-heading">
    <h2>{state.mode === 'questions' ? 'Question queue' : 'Participant queue'}</h2>
    <span className="muted">{state.mode === 'questions' ? groups.length : state.participants.length} total</span>
    </div>{state.mode === 'questions' ? <>
        <div className="queue-toolbar">
        <div className="filter-tabs">{['pending', 'answered', 'all'].map(f => <button key={f} className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)}>{f === 'pending' ? 'Open' : f === 'answered' ? 'Answered' : 'All'}</button>)}</div>
        <input aria-label="Search questions" placeholder="⌕ Search questions" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <div className="question-list">{groups.filter(g => (filter === 'all' || (filter === 'pending' ? g.status === 'pending' : g.status !== 'pending')) && (g.text + g.title).toLowerCase().includes(search.toLowerCase())).map((g, i) => <div className="question-row" key={g.id}>
            <span className="question-number">{String(i + 1).padStart(2, '0')}</span>
            <button className="question-text" onClick={() => showGroup(g)}>
            <strong>{g.title}</strong>
            <small>{g.questions[0]?.user.name} <span>·</span> {g.status === 'pending' ? g.review ? 'Needs review' : `${g.questions.length} original${g.questions.length === 1 ? '' : 's'}` : g.status === 'written' ? g.answerActive === false ? 'Answer expired — review before reuse' : 'Written answer available' : 'Answered live · no saved text'}</small>
            </button>
            <span className="support-count" title={`${g.count} unique ${g.count === 1 ? 'supporter' : 'supporters'}`} aria-label={`${g.count} unique ${g.count === 1 ? 'supporter' : 'supporters'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3"/>
            <path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>
            </svg>
            <strong>{g.count}</strong>
            </span>{g.status === 'pending' && <button className="spotlight-button" disabled={inSpin || busy} onClick={() => act('spin', { id: g.id })}>Spotlight ↗</button>}</div>)}{!groups.some(g => (filter === 'all' || (filter === 'pending' ? g.status === 'pending' : g.status !== 'pending')) && (g.text + g.title).toLowerCase().includes(search.toLowerCase())) && <p className="empty">No questions here yet. Ask a question in Twitch chat; no command is needed.</p>}</div>
        </> : <div className="question-list">{state.participants.map(p => <div className="question-row" key={p.id}>
            <span className="avatar small">{p.name[0].toUpperCase()}</span>
            <strong>{p.name}</strong>
            <span className="muted">{p.selected ? 'Previously selected' : 'Ready for a turn'}</span>
            </div>)}{!state.participants.length && <p className="empty">No registrations yet. Use !join in Twitch chat.</p>}</div>}</section>
    </div>
    </div>;
}
