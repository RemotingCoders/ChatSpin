import { useI18n } from './i18n';
import { readinessLabel, needsManualReview } from './questionReadiness';
import type { Spin } from '../server/domain';
import type { ViewState, ViewGroup, Session, Act } from './types';
import { Wheel } from './Wheel';
import { wheelPresentation, type WheelEntry } from './wheelState';
export function Dashboard({
  state,
  presentation,
  entries,
  clock,
  inSpin,
  busy,
  act,
  result,
  groups,
  filter,
  setFilter,
  search,
  setSearch,
  showGroup,
  total,
  session,
}: {
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
  const { t, formatDate } = useI18n();
  return (
    <div className="dashboard-grid">
      <section className="panel wheel-panel">
        <div className="panel-heading">
          <h2>
            {state.mode === 'questions' ? t('The question wheel') : t('The participant wheel')}
          </h2>
          <span className="badge neutral">
            {entries.length}
            {t(' ELIGIBLE')}
          </span>
        </div>
        <p className="muted">{t('A small spin. A new conversation.')}</p>
        <Wheel
          spin={presentation.spin}
          entries={entries}
          clock={clock}
          centerAction={
            <button
              className="wheel-center-action"
              aria-label={inSpin ? t('✦ Finding the next voice…') : t('✦ Spin the wheel')}
              title={t('✦ Spin the wheel')}
              disabled={
                busy ||
                inSpin ||
                !entries.length ||
                (state.mode === 'questions' && state.odds === 'manual')
              }
              onClick={() => act('spin')}
            >
              {t('✦ Spin the wheel').replace('✦', '').trim()}
            </button>
          }
        />
        <div className="wheel-controls">
          {state.mode === 'questions' ? (
            <>
              <label htmlFor="odds">{t('Selection method')}</label>
              <select
                id="odds"
                value={state.odds}
                disabled={busy || inSpin}
                onChange={(e) => act('settings', { value: e.target.value })}
              >
                <option value="equal">{t('Equal chances')}</option>
                <option value="support">{t('By support')}</option>
                <option value="manual">{t('Manual selection')}</option>
              </select>
              <p className="help">
                {state.odds === 'equal'
                  ? t('Every open group has the same chance, including single questions.')
                  : state.odds === 'support'
                    ? t('Chances follow distinct supporters. One person counts once per group.')
                    : t('Choose \u201CSpotlight\u201D on an open question to select it directly.')}
              </p>
            </>
          ) : (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={state.registration}
                  disabled={inSpin}
                  onChange={(e) => act('registration', { value: e.target.checked })}
                />
                {t(' Registration open')}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={state.excludeSelected}
                  disabled={inSpin}
                  onChange={(e) => act('exclude', { value: e.target.checked })}
                />
                {t(' Exclude previously selected people')}
              </label>
              <p className="help">
                {t('Use !join to enter and !leave to withdraw. No microphone or call is started.')}
              </p>
            </>
          )}
          <small className="wheel-caption">
            {session.demo
              ? t('Demo spin \u00B7 simulated community')
              : t('Chosen securely \u00B7 synchronized with OBS')}
          </small>
        </div>
        <details className="chances">
          <summary>{t('View exact chances')}</summary>
          {result && (
            <p className="help">
              {presentation.spin
                ? t('The wheel shows the last draw. These chances apply to the next spin.')
                : t(
                    'The wheel is ready for the next draw. The last result remains in the spotlight.',
                  )}
            </p>
          )}
          {entries.map((e, i) => (
            <div key={e.id}>
              <span>
                {i + 1}. {e.label}
              </span>
              <b>
                {state.mode === 'questions' && state.odds === 'manual'
                  ? t('Manual')
                  : `${((e.weight / total) * 100).toFixed(2)}%`}
              </b>
            </div>
          ))}
          {!entries.length && <p>{t('No eligible entries yet.')}</p>}
        </details>
      </section>
      <div className="right-stack">
        <section className={'panel spotlight ' + (result ? 'has-result' : '')}>
          <div className="panel-heading">
            <h2>
              <span className="mint-text">✧</span>
              {t(' In the spotlight')}
            </h2>
            <span className="live-label">
              {inSpin ? t('SPINNING') : result ? t('SELECTED') : t('READY')}
            </span>
          </div>
          <div className="spotlight-content">
            <span className="spotlight-orbit">{inSpin ? '✦' : result ? '✧' : '◌'}</span>
            <span className="eyebrow">
              {inSpin
                ? t('A MOMENT OF POSSIBILITY')
                : result
                  ? t('THE SPOTLIGHT IS YOURS')
                  : t('THE NEXT CONVERSATION STARTS HERE')}
            </span>
            <h2>
              {inSpin ? t('Who\u2019s up next?') : result?.text || t('Make room for a new voice.')}
            </h2>
            <p>
              {result
                ? result.label
                : t('Spin the wheel to bring a community question into the spotlight.')}
            </p>
            {result?.mode === 'questions' && (
              <button
                className="secondary"
                onClick={() => {
                  const g = groups.find((g) => g.id === result.winner);
                  if (g) showGroup(g);
                }}
              >
                {t('Review & answer \u2192')}
              </button>
            )}
          </div>
        </section>
        <section className="panel queue">
          <div className="panel-heading">
            <h2>{state.mode === 'questions' ? t('Question queue') : t('Participant queue')}</h2>
            <span className="muted">
              {state.mode === 'questions' ? groups.length : state.participants.length}
              {t(' total')}
            </span>
          </div>
          {state.mode === 'questions' ? (
            <>
              <div className="queue-toolbar">
                <div className="filter-tabs">
                  {['pending', 'answered', 'all'].map((f) => (
                    <button
                      key={f}
                      className={filter === f ? 'selected' : ''}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'pending' ? t('Open') : f === 'answered' ? t('Answered') : t('All')}
                    </button>
                  ))}
                </div>
                <input
                  aria-label={t('Search questions')}
                  placeholder={t('\u2315 Search questions')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="question-list">
                {groups
                  .filter(
                    (g) =>
                      (filter === 'all' ||
                        (filter === 'pending' ? g.status === 'pending' : g.status !== 'pending')) &&
                      (g.text + g.title).toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((g, i) => (
                    <div className="question-row" key={g.id}>
                      <span className="question-number">{String(i + 1).padStart(2, '0')}</span>
                      <button className="question-text" onClick={() => showGroup(g)}>
                        <strong>{g.title}</strong>
                        {g.status === 'pending' && g.readiness && (
                          <small role="status">{t(readinessLabel[g.readiness])}</small>
                        )}
                        <small>
                          {g.questions[0]?.user.name} <span>·</span>{' '}
                          {g.status === 'pending'
                            ? g.review
                              ? t('Needs review')
                              : t('{v0} original{v1}', {
                                  v0: g.questions.length,
                                  v1: g.questions.length === 1 ? '' : 's',
                                })
                            : g.status === 'written'
                              ? g.answerActive === false
                                ? t('Answer expired \u2014 review before reuse')
                                : t('Written answer available')
                              : t('Answered live \u00B7 no saved text')}
                        </small>
                      </button>
                      <span
                        className="support-count"
                        title={t('{v0} unique {v1}', {
                          v0: g.count,
                          v1: g.count === 1 ? 'supporter' : t('supporters'),
                        })}
                        aria-label={t('{v0} unique {v1}', {
                          v0: g.count,
                          v1: g.count === 1 ? 'supporter' : t('supporters'),
                        })}
                      >
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="9" cy="8" r="3" />
                          <path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" />
                        </svg>
                        <strong>{g.count}</strong>
                      </span>
                      {session.controller && needsManualReview(g.readiness) && (
                        <button
                          className="secondary"
                          disabled={inSpin || busy}
                          title={t(
                            'Approve this as a new question after checking previous answers.',
                          )}
                          onClick={() => act('approve-question', { id: g.id })}
                        >
                          {t('Approve question')}
                        </button>
                      )}
                      {g.status === 'pending' && (
                        <button
                          className="spotlight-button"
                          disabled={
                            inSpin || busy || !state.entries?.some((entry) => entry.id === g.id)
                          }
                          onClick={() => act('spin', { id: g.id })}
                        >
                          {t('Spotlight \u2197')}
                        </button>
                      )}
                    </div>
                  ))}
                {!groups.some(
                  (g) =>
                    (filter === 'all' ||
                      (filter === 'pending' ? g.status === 'pending' : g.status !== 'pending')) &&
                    (g.text + g.title).toLowerCase().includes(search.toLowerCase()),
                ) && (
                  <p className="empty">
                    {t(
                      'No questions here yet. Ask a question in Twitch chat; no command is needed.',
                    )}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="question-list">
              {state.participants.map((p) => (
                <div className="question-row" key={p.id}>
                  <span className="avatar small">{p.name[0].toUpperCase()}</span>
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {p.selected ? t('Previously selected') : t('Ready for a turn')}
                  </span>
                </div>
              ))}
              {!state.participants.length && (
                <p className="empty">{t('No registrations yet. Use !join in Twitch chat.')}</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
