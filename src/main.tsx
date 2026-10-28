import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { Dashboard } from './Dashboard';
import { OBSView } from './OBSView';
import { wheelPresentation } from './wheelState';
import type { ViewGroup } from './types';
import { request } from './api';
import { useWorkspace } from './useWorkspace';
import { ReviewDialog } from './ReviewDialog';
import { OperationsPanel } from './OperationsPanel';
function App() {
    const viewer = location.pathname === '/viewer', obs = location.pathname === '/obs';
    const { session, state, error, setError, clock, load } = useWorkspace(obs);
    const [busy, setBusy] = useState(false), [filter, setFilter] = useState('pending'), [search, setSearch] = useState('');
    const [selected, setSelected] = useState<string | null>(null), [text, setText] = useState('');
    const [now, setNow] = useState(Date.now()), [copied, setCopied] = useState(false);
    const [clearTarget, setClearTarget] = useState<'questions' | 'participants' | null>(null);
    const [notice, setNotice] = useState('');
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) {
                setSelected(null);
                setClearTarget(null);
            }
        };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [busy]);
    async function act(type: string, fields: Record<string, unknown> = {}) {
        setBusy(true);
        setError('');
        try {
            await request('/api/action', { type, ...fields });
            await load();
            return true;
        }
        catch (e) {
            setError((e as Error).message);
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    async function confirmClear() {
        if (!clearTarget)
            return;
        const target = clearTarget;
        if (await act(`clear-${target}`, { confirmed: true })) {
            if (target === 'questions') {
                setSelected(null);
            }
            setClearTarget(null);
            setNotice(target === 'questions' ? 'Questions cleared. Participants were kept. A session backup was saved.' : 'Participants cleared. Questions were kept. A session backup was saved.');
        }
    }
    const inSpin = !!state?.spin && state.spin.end > now + clock;
    const result = state?.spin && !inSpin ? state.spin : null;
    const groups = state?.groups || [], pending = groups.filter(g => g.status === 'pending');
    const group = groups.find(g => g.id === selected);
    const controller = session?.controller && !viewer;
    const nextEntries = state?.mode === 'participants' ? (state.participants || []).filter(p => !state.excludeSelected || !p.selected).map(p => ({ id: p.id, label: p.name, weight: 1 })) : pending.map(g => ({ id: g.id, label: g.title, weight: state?.odds === 'support' ? g.count : 1 }));
    const presentation = wheelPresentation(state?.entries || nextEntries, state?.spin || null, state?.mode || 'questions', now + clock);
    const entries = presentation.entries;
    const total = entries.reduce((s, c) => s + c.weight, 0);
    const showGroup = (g: ViewGroup) => setSelected(g.id);
    if (obs)
        return <OBSView state={state} error={error} presentation={presentation} clock={clock} inSpin={inSpin} result={result}/>;
    return <div className="app">
    <aside className="sidebar">
    <a className="brand" href="/">
    <span className="brand-icon">✦</span> ChatSpin<span className="brand-period">.</span>
    </a>
    <div className="workspace">
    <span className="avatar">{session?.user?.name.slice(0, 1).toUpperCase() || 'C'}</span>
    <div>
    <strong>{session?.user?.name || 'Your community'}</strong>
    <small>{session?.demo ? 'Demo workspace' : 'Twitch workspace'}</small>
    </div>
    </div>
    <span className="nav-label">WORKSPACE</span>
    <nav>
    <a className={!viewer ? 'active' : ''} href="/">
    <span>◉</span> Streamer dashboard</a>
    <a className={viewer ? 'active' : ''} href="/viewer">
    <span>♧</span> Viewer space</a>{state?.obsUrl && <a href={state.obsUrl} target="_blank" rel="noreferrer">
        <span>▣</span> OBS presentation ↗</a>}</nav>
    <div className="sidebar-bottom">
    <div className="mini-wheel">✧</div>
    <strong>A little less noise.<br />A lot more community.</strong>
    <p>Turn a busy chat into a great conversation.</p>
    <span className="hackathon">CODEX × TWITCHCON 2026</span>
    </div>
    </aside>
    <div className="main-shell">
    <header>
    <div className="breadcrumb">Workspace <span>/</span> <b>{viewer ? 'Viewer space' : 'Live dashboard'}</b>
    </div>
    <div className="header-actions">{session?.demo && <span className="badge">DEMO · SIMULATED DATA</span>}<span className="connection">
    <i className={session?.connection === 'Connected' && !session.demo ? 'online' : ''}/>{session?.demo ? 'Twitch disconnected' : session?.connection || 'Loading'}</span>{session?.user ? <button className="quiet" onClick={async () => { await request('/api/logout', {}); await load(); }}>Sign out</button> : <a className="button" href="/auth/twitch?role=streamer">Connect Twitch</a>}</div>
    </header>
    <main>
    <div className="page-title">
    <div>
    <span className="eyebrow">GIVE YOUR COMMUNITY A TURN</span>
    <h1>{viewer ? 'Your voice belongs here.' : 'Good questions. Great conversations.'}</h1>
    <p>{viewer ? 'Ask, support, and see what your streamer has answered.' : 'Bring the best of your chat into the spotlight.'}</p>
    </div>{controller && <button className="secondary" onClick={async () => {
                try {
                    await navigator.clipboard.writeText(state!.obsUrl!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                }
                catch {
                    setError('Open OBS presentation from the sidebar and copy its URL.');
                }
            }}>{copied ? '✓ Link copied' : '▣ Copy OBS link'}</button>}</div>{session?.storageNotice && <div className="notice" role="status">{session.storageNotice}</div>}{notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button>
        </div>}{error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>}
  {!session?.user ? <section className="welcome panel">
        <span className="welcome-star">✦</span>
        <h2>Every voice deserves a turn.</h2>
        <p>Collect questions, bring similar ones together, and let the wheel choose the next conversation.</p>
        <div className="welcome-actions">
        <a className="button primary" href={'/auth/twitch?role=' + (viewer ? 'viewer' : 'streamer')}>Connect with Twitch ↗</a>{session?.demoEnabled && <button className="secondary" onClick={async () => { await request('/api/demo', { role: viewer ? 'viewer' : 'streamer' }); await load(); }}>Explore the local demo</button>}</div>{!session?.configured && <div className="setup-note">Twitch setup required: add TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_BROADCASTER_ID to your server’s .env file. The local demo uses simulated data.</div>}</section> : !state ? <p>Loading your workspace…</p> : <>
  <div className="stats">
        <div>
        <span className="stat-icon purple">☷</span>
        <div>
        <strong>{pending.length}</strong>
        <small>Open questions</small>
        </div>
        <span className="stat-detail">Every question counts</span>
        </div>
        <div>
        <span className="stat-icon mint">♧</span>
        <div>
        <strong>{state.participants.length}</strong>
        <small>{viewer ? 'Your registration' : 'Participants registered'}</small>
        </div>
        <span className="stat-detail">Voluntary entries</span>
        </div>
        <div>
        <span className="stat-icon peach">✓</span>
        <div>
        <strong>{groups.filter(g => g.status !== 'pending').length}</strong>
        <small>Questions answered</small>
        </div>
        <span className="stat-detail">Good conversations happen</span>
        </div>
        </div>
  {controller ? <>
            <div className="mode-bar">
            <div className="tabs">
            <button className={state.mode === 'questions' ? 'chosen' : ''} disabled={inSpin || busy} onClick={() => act('settings', { value: 'questions' })}>◉ Question Wheel</button>
            <button className={state.mode === 'participants' ? 'chosen' : ''} disabled={inSpin || busy} onClick={() => act('settings', { value: 'participants' })}>♧ Participant Wheel</button>
            </div>
            <span className="muted">{state.mode === 'questions' ? 'Let a question take the stage.' : 'One person. One entry. Equal chances.'}</span>
            </div>
            <Dashboard state={state} presentation={presentation} entries={entries} clock={clock} inSpin={inSpin} busy={busy} act={act} result={result} groups={groups} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} showGroup={showGroup} total={total} session={session}/>
            <OperationsPanel state={state} busy={busy} inSpin={inSpin} act={act}/>
            <section className="panel session-controls">
            <div>
            <h2>Start fresh</h2>
            <p className="muted">Clear questions and participants separately. Each action saves a backup first.</p>
            </div>
            <div className="session-control-buttons">
            <button className="secondary" disabled={busy || inSpin || !groups.length} onClick={() => setClearTarget('questions')}>Clear questions and answers</button>
            <button className="secondary" disabled={busy || inSpin || !state.participants.length} onClick={() => setClearTarget('participants')}>Clear participants</button>
            </div>
            </section>
            <div className="bottom-note">
            <span>✧ {session.demo ? 'Demo grouping is curated. Live AI: ' : 'AI grouping: '}{session.ai}</span>
            <span>{state.usage.calls} calls · {state.usage.input + state.usage.output} tokens</span>
            </div>
            <section className="panel compact">
            <div>
            <h2>{session.demo ? 'Try a community question' : 'Twitch connection'}</h2>{!session.demo && <p className="muted">Public chat replies: {session.chatReplies || 'Reconnect Twitch to enable approved-answer replies'}</p>}<p className="muted">{session.demo ? 'Send a demo question here, then find it in the queue.' : 'Questions are detected automatically. Optional: !ask your question · !join · !leave'}</p>
            </div>{session.demo ? <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (await act('ask', { text }))
                            setText('');
                    }}>
                <input aria-label="Demo question" placeholder="What would you like to ask?" value={text} maxLength={500} onChange={e => setText(e.target.value)}/>
                <button className="secondary" disabled={busy}>Add question</button>
                </form> : <div>
                <a className="button secondary" href="/auth/twitch?role=streamer">Connect / reconnect</a>
                <button className="quiet" onClick={() => act('disconnect')}>Disconnect</button>
                </div>}</section>
            </> : <div className="viewer-grid">
            <section className="panel viewer-form">
            <h2>Ask your question</h2>
            <p className="muted">Similar questions can share a group. Your original words always stay yours.</p>
            <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (await act('ask', { text }))
                        setText('');
                }}>
            <textarea value={text} maxLength={500} minLength={3} required onChange={e => setText(e.target.value)} placeholder="What would you like to ask?" aria-label="Your question"/>
            <button className="primary" disabled={busy}>Submit question →</button>
            </form>
            <hr />
            <h2>Take a turn</h2>
            <p className="muted">{state.registration ? 'Registration is open. Join the participant wheel voluntarily.' : 'Registration is closed.'}</p>
            <button className="secondary" disabled={busy || (!state.registration && !state.participants.length)} onClick={() => act(state.participants.length ? 'leave' : 'join')}>{state.participants.length ? 'Leave participant wheel' : 'Join participant wheel'}</button>
            </section>
            <section className="panel">
            <h2>Your questions & community</h2>
            <p className="help">Approved written answers appear only with your matching questions.</p>{groups.map(g => <article className="viewer-question" key={g.id}>
                <span className="badge neutral">{g.status === 'written' ? 'Written answer' : g.status === 'live' ? 'Answered live · no saved text' : 'Open'}</span>
                <h3>{g.text}</h3>
                <p className="muted">{g.count} supporters {g.questions.length ? '· You asked this' : ''}</p>{g.answer && <blockquote>{g.answer}</blockquote>}{g.status === 'pending' && <button className="secondary" disabled={busy} onClick={() => act('support', { id: g.id })}>Support this question</button>}</article>)}{!groups.length && <p className="empty">Be the first to start a conversation.</p>}</section>
            </div>}</>}
  <footer>
    <span>ChatSpin <b>✦</b> Made for the moments between chat and conversation.</span>
    <span>Built with Codex</span>
    </footer>
    </main>
    </div>{clearTarget && controller && <div className="modal-backdrop" onClick={() => !busy && setClearTarget(null)}>
        <section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="clear-heading" onClick={e => e.stopPropagation()}>
        <h2 id="clear-heading">Clear all {clearTarget === 'questions' ? 'questions and answers' : clearTarget}?</h2>
        <p className="clear-description">{clearTarget === 'questions' ? 'This removes all questions, support, saved answers, and the question wheel result from this session. Registered participants are kept.' : 'This removes all registered participants and the participant wheel result from this session. Questions and saved answers are kept.'}</p>
        <p className="help">A session backup will be saved before anything is cleared. New chat messages can add new entries afterward.</p>
        <div className="modal-actions">
        <button className="secondary" autoFocus disabled={busy} onClick={() => setClearTarget(null)}>Cancel</button>
        <button className="primary" disabled={busy || inSpin} onClick={confirmClear}>Clear {clearTarget === 'questions' ? 'questions and answers' : clearTarget}</button>
        </div>{error && <p className="clear-error" role="alert">{error}</p>}</section>
        </div>}{group && controller && <ReviewDialog key={group.id} group={group} groups={groups} busy={busy} inSpin={inSpin} act={act} close={() => setSelected(null)} answered={written => setNotice(written ? 'Answer saved. The question is now answered.' : 'Question marked answered live.')}/>}</div>;
}
document.documentElement.classList.toggle('obs-page', location.pathname === '/obs');
createRoot(document.getElementById('root')!).render(<App />);
