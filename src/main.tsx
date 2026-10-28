import {I18nProvider,useI18n} from './i18n';
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
import {LanguagePicker} from './LanguagePicker';
import { OperationsPanel } from './OperationsPanel';
function App() {
 const {t,formatDate,language,setLanguage,hasPreference}=useI18n();
    const viewer = location.pathname === '/viewer', obs = location.pathname === '/obs';
    const { session, state, error, setError, clock, load } = useWorkspace(obs);
    useEffect(()=>{const shared=obs?state?.uiLanguage:session?.uiLanguage;if(shared&&(obs||!hasPreference))setLanguage(shared,false);},[obs,state?.uiLanguage,session?.uiLanguage,hasPreference]);
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
            setNotice(target === 'questions' ? "Questions cleared. Participants were kept. A session backup was saved." : "Participants cleared. Questions were kept. A session backup was saved.");
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
        return <OBSView state={state} error={t(error)} presentation={presentation} clock={clock} inSpin={inSpin} result={result}/>;
    return <div className="app">
    <aside className="sidebar">
    <a className="brand" href="/">
    <span className="brand-icon">✦</span> ChatSpin<span className="brand-period">.</span>
    </a>
    <div className="workspace">
    <span className="avatar">{session?.user?.name.slice(0, 1).toUpperCase() || 'C'}</span>
    <div>
    <strong>{session?.user?.name || t("Your community")}</strong>
    <small>{session?.demo ? t("Demo workspace") : t("Twitch workspace")}</small>
    </div>
    </div>
    <span className="nav-label">{t("WORKSPACE")}</span>
    <nav>
    <a className={!viewer ? 'active' : ''} href="/">
    <span>◉</span>{t(" Streamer dashboard")}</a>
    <a className={viewer ? 'active' : ''} href="/viewer">
    <span>♧</span>{t(" Viewer space")}</a>{state?.obsUrl && <a href={state.obsUrl} target="_blank" rel="noreferrer">
        <span>▣</span>{t(" OBS presentation \u2197")}</a>}</nav>
    <div className="sidebar-bottom">
    <div className="mini-wheel">✧</div>
    <strong>{t("A little less noise.")}<br />{t("A lot more community.")}</strong>
    <p>{t("Turn a busy chat into a great conversation.")}</p>
    <span className="hackathon">CODEX × TWITCHCON 2026</span>
    </div>
    </aside>
    <div className="main-shell">
    <header>
    <div className="breadcrumb">{t("Workspace ")}<span>/</span> <b>{viewer ? t("Viewer space") : t("Live dashboard")}</b>
    </div>
    <div className="header-actions"><LanguagePicker act={act} controller={!!session?.controller&&!viewer}/>{session?.demo && <span className="badge">{t("DEMO \u00B7 SIMULATED DATA")}</span>}<span className="connection">
    <i className={session?.connection === 'Connected' && !session.demo ? 'online' : ''}/>{session?.demo ? t("Twitch disconnected") : session?.connection || t("Loading")}</span>{session?.user ? <button className="quiet" onClick={async () => { await request('/api/logout', {}); await load(); }}>{t("Sign out")}</button> : <a className="button" href="/auth/twitch?role=streamer">{t("Connect Twitch")}</a>}</div>
    </header>
    <main>
    <div className="page-title">
    <div>
    <span className="eyebrow">{t("GIVE YOUR COMMUNITY A TURN")}</span>
    <h1>{viewer ? t("Your voice belongs here.") : t("Good questions. Great conversations.")}</h1>
    <p>{viewer ? t("Ask, support, and see what your streamer has answered.") : t("Bring the best of your chat into the spotlight.")}</p>
    </div>{controller && <button className="secondary" onClick={async () => {
                try {
                    await navigator.clipboard.writeText(state!.obsUrl!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                }
                catch {
                    setError("Open OBS presentation from the sidebar and copy its URL.");
                }
            }}>{copied ? t("\u2713 Link copied") : t("\u25A3 Copy OBS link")}</button>}</div>{session?.storageNotice && <div className="notice" role="status">{t(session.storageNotice)}</div>}{notice && <div className="notice" role="status">{t(notice)}<button onClick={() => setNotice('')} aria-label={t("Dismiss notification")}>×</button>
        </div>}{error && <div className="error" role="alert">{t(error)}<button onClick={() => setError('')} aria-label={t("Dismiss error")}>×</button>
        </div>}
  {!session?.user ? <section className="welcome panel">
        <span className="welcome-star">✦</span>
        <h2>{t("Every voice deserves a turn.")}</h2>
        <p>{t("Collect questions, bring similar ones together, and let the wheel choose the next conversation.")}</p>
        <div className="welcome-actions">
        <a className="button primary" href={'/auth/twitch?role=' + (viewer ? 'viewer' : 'streamer')}>{t("Connect with Twitch \u2197")}</a>{session?.demoEnabled && <button className="secondary" onClick={async () => { await request('/api/demo', { role: viewer ? 'viewer' : 'streamer' }); await load(); }}>{t("Explore the local demo")}</button>}</div>{!session?.configured && <div className="setup-note">{t("Twitch setup required: add TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_BROADCASTER_ID to your server\u2019s .env file. The local demo uses simulated data.")}</div>}</section> : !state ? <p>{t("Loading your workspace\u2026")}</p> : <>
  <div className="stats">
        <div>
        <span className="stat-icon purple">☷</span>
        <div>
        <strong>{pending.length}</strong>
        <small>{t("Open questions")}</small>
        </div>
        <span className="stat-detail">{t("Every question counts")}</span>
        </div>
        <div>
        <span className="stat-icon mint">♧</span>
        <div>
        <strong>{state.participants.length}</strong>
        <small>{viewer ? t("Your registration") : t("Participants registered")}</small>
        </div>
        <span className="stat-detail">{t("Voluntary entries")}</span>
        </div>
        <div>
        <span className="stat-icon peach">✓</span>
        <div>
        <strong>{groups.filter(g => g.status !== 'pending').length}</strong>
        <small>{t("Questions answered")}</small>
        </div>
        <span className="stat-detail">{t("Good conversations happen")}</span>
        </div>
        </div>
  {controller ? <>
            <div className="mode-bar">
            <div className="tabs">
            <button className={state.mode === 'questions' ? 'chosen' : ''} disabled={inSpin || busy} onClick={() => act('settings', { value: 'questions' })}>{t("\u25C9 Question Wheel")}</button>
            <button className={state.mode === 'participants' ? 'chosen' : ''} disabled={inSpin || busy} onClick={() => act('settings', { value: 'participants' })}>{t("\u2667 Participant Wheel")}</button>
            </div>
            <span className="muted">{state.mode === 'questions' ? t("Let a question take the stage.") : t("One person. One entry. Equal chances.")}</span>
            </div>
            <Dashboard state={state} presentation={presentation} entries={entries} clock={clock} inSpin={inSpin} busy={busy} act={act} result={result} groups={groups} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} showGroup={showGroup} total={total} session={session}/>
            <OperationsPanel state={state} busy={busy} inSpin={inSpin} act={act}/>
            <section className="panel session-controls">
            <div>
            <h2>{t("Start fresh")}</h2>
            <p className="muted">{t("Clear questions and participants separately. Each action saves a backup first.")}</p>
            </div>
            <div className="session-control-buttons">
            <button className="secondary" disabled={busy || inSpin || !groups.length} onClick={() => setClearTarget('questions')}>{t("Clear questions and answers")}</button>
            <button className="secondary" disabled={busy || inSpin || !state.participants.length} onClick={() => setClearTarget('participants')}>{t("Clear participants")}</button>
            </div>
            </section>
            <div className="bottom-note">
            <span>✧ {session.demo ? t("Demo grouping is curated. Live AI: ") : t("AI grouping: ")}{t(session.ai)}</span>
            <span>{state.usage.calls}{t(" calls \u00B7 ")}{state.usage.input + state.usage.output} {t("tokens")}</span>
            </div>
            <section className="panel compact">
            <div>
            <h2>{session.demo ? t("Try a community question") : t("Twitch connection")}</h2>{!session.demo && <p className="muted">{t("Public chat replies: ")}{t(session.chatReplies || "Reconnect Twitch to enable approved-answer replies")}</p>}<p className="muted">{session.demo ? t("Send a demo question here, then find it in the queue.") : t("Questions are detected automatically. Optional: !ask your question \u00B7 !join \u00B7 !leave")}</p>
            </div>{session.demo ? <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (await act('ask', { text }))
                            setText('');
                    }}>
                <input aria-label={t("Demo question")} placeholder={t("What would you like to ask?")} value={text} maxLength={500} onChange={e => setText(e.target.value)}/>
                <button className="secondary" disabled={busy}>{t("Add question")}</button>
                </form> : <div>
                <a className="button secondary" href="/auth/twitch?role=streamer">{t("Connect / reconnect")}</a>
                <button className="quiet" onClick={() => act('disconnect')}>{t("Disconnect")}</button>
                </div>}</section>
            </> : <div className="viewer-grid">
            <section className="panel viewer-form">
            <h2>{t("Ask your question")}</h2>
            <p className="muted">{t("Similar questions can share a group. Your original words always stay yours.")}</p>
            <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (await act('ask', { text }))
                        setText('');
                }}>
            <textarea value={text} maxLength={500} minLength={3} required onChange={e => setText(e.target.value)} placeholder={t("What would you like to ask?")} aria-label={t("Your question")}/>
            <button className="primary" disabled={busy}>{t("Submit question \u2192")}</button>
            </form>
            <hr />
            <h2>{t("Take a turn")}</h2>
            <p className="muted">{state.registration ? t("Registration is open. Join the participant wheel voluntarily.") : t("Registration is closed.")}</p>
            <button className="secondary" disabled={busy || (!state.registration && !state.participants.length)} onClick={() => act(state.participants.length ? 'leave' : 'join')}>{state.participants.length ? t("Leave participant wheel") : t("Join participant wheel")}</button>
            </section>
            <section className="panel">
            <h2>{t("Your questions & community")}</h2>
            <p className="help">{t("Approved written answers appear only with your matching questions.")}</p>{groups.map(g => <article className="viewer-question" key={g.id}>
                <span className="badge neutral">{g.status === 'written' ? t("Written answer") : g.status === 'live' ? t("Answered live \u00B7 no saved text") : t("Open")}</span>
                <h3>{g.text}</h3>
                <p className="muted">{g.count}{t(" supporters ")}{g.questions.length ? t("\u00B7 You asked this") : ''}</p>{g.answer && <blockquote>{g.answer}</blockquote>}{g.status === 'pending' && <button className="secondary" disabled={busy} onClick={() => act('support', { id: g.id })}>{t("Support this question")}</button>}</article>)}{!groups.length && <p className="empty">{t("Be the first to start a conversation.")}</p>}</section>
            </div>}</>}
  <footer>
    <span>ChatSpin <b>✦</b>{t(" Made for the moments between chat and conversation.")}</span>
    <span>{t("Built with Codex")}</span>
    </footer>
    </main>
    </div>{clearTarget && controller && <div className="modal-backdrop" onClick={() => !busy && setClearTarget(null)}>
        <section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="clear-heading" onClick={e => e.stopPropagation()}>
        <h2 id="clear-heading">{clearTarget==='questions'?t('Clear all questions and answers?'):t('Clear all participants?')}</h2>
        <p className="clear-description">{clearTarget === 'questions' ? t("This removes all questions, support, saved answers, and the question wheel result from this session. Registered participants are kept.") : t("This removes all registered participants and the participant wheel result from this session. Questions and saved answers are kept.")}</p>
        <p className="help">{t("A session backup will be saved before anything is cleared. New chat messages can add new entries afterward.")}</p>
        <div className="modal-actions">
        <button className="secondary" autoFocus disabled={busy} onClick={() => setClearTarget(null)}>{t("Cancel")}</button>
        <button className="primary" disabled={busy || inSpin} onClick={confirmClear}>{t("Clear ")}{clearTarget === 'questions' ? t("questions and answers") : t(clearTarget)}</button>
        </div>{error && <p className="clear-error" role="alert">{t(error)}</p>}</section>
        </div>}{group && controller && <ReviewDialog key={group.id} group={group} groups={groups} busy={busy} inSpin={inSpin} act={act} close={() => setSelected(null)} answered={written => setNotice(written ? "Answer saved. The question is now answered." : "Question marked answered live.")}/>}</div>;
}
document.documentElement.classList.toggle('obs-page', location.pathname === '/obs');
createRoot(document.getElementById('root')!).render(<I18nProvider><App /></I18nProvider>);
