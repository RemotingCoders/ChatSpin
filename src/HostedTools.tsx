import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { request } from './api';
import { parseModeratorIds, type BackupSummary, type BackupPreview } from './hostedSettings';
import type { Act, ViewState } from './types';
export function HostedTools({
  state,
  busy,
  inSpin,
  act,
}: {
  state: ViewState;
  busy: boolean;
  inSpin: boolean;
  act: Act;
}) {
  const { t, formatDate } = useI18n();
  const [moderators, setModerators] = useState((state.moderatorIds || []).join(', '));
  const [backups, setBackups] = useState<BackupSummary[] | null>(null),
    [preview, setPreview] = useState<BackupPreview | null>(null),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(
    () => setModerators((state.moderatorIds || []).join(', ')),
    [JSON.stringify(state.moderatorIds)],
  );
  const disabled = busy || inSpin || loading;
  async function loadBackups() {
    setLoading(true);
    setError('');
    try {
      const result = await request('/api/backups');
      setBackups(result.backups);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function previewBackup(id: string) {
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      setPreview(await request('/api/backups/' + encodeURIComponent(id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <details>
        <summary>{t('Channel moderators')}</summary>
        <p className="help">
          {t(
            'Only the channel owner can manage this list. Approved Twitch moderators can control the extension after sharing their identity.',
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setMessage('');
            try {
              const ids = parseModeratorIds(moderators);
              if (await act('set-moderators', { text: JSON.stringify(ids) }))
                setMessage('Moderator access saved.');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            {t('Moderator Twitch user IDs')}
            <input
              value={moderators}
              onChange={(e) => setModerators(e.target.value)}
              placeholder="123456, 789012"
              disabled={disabled}
            />
          </label>
          <button className="secondary" disabled={disabled}>
            {t('Save moderator access')}
          </button>
        </form>
      </details>
      <details>
        <summary>{t('Channel backups')}</summary>
        <p className="help">
          {t(
            'Preview a backup before restoring. Restoration replaces this channel’s questions and participants and saves the current state first.',
          )}
        </p>
        <button className="secondary" disabled={disabled} onClick={() => void loadBackups()}>
          {t('Load backups')}
        </button>
        {backups && (
          <ul>
            {backups.map((row) => (
              <li key={row.id}>
                <span>
                  {formatDate(new Date(row.createdAt))} ·{' '}
                  {t('{v0} questions · {v1} participants', {
                    v0: row.groups,
                    v1: row.participants,
                  })}
                </span>{' '}
                <button disabled={disabled} onClick={() => void previewBackup(row.id)}>
                  {t('Preview backup')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {backups?.length === 0 && <p>{t('No backups available.')}</p>}
        {preview && (
          <section role="region" aria-label={t('Backup preview')}>
            <h3>{t('Backup preview')}</h3>
            <p>
              {formatDate(new Date(preview.createdAt))} ·{' '}
              {t('{v0} questions · {v1} participants', {
                v0: preview.groups.length,
                v1: preview.participants,
              })}
            </p>
            <ul>
              {preview.groups.slice(0, 20).map((g, i) => (
                <li key={i}>
                  {g.title} · {t(g.status === 'pending' ? 'Open' : 'Answered')}
                </li>
              ))}
            </ul>
            <p>
              {t(
                'Restore this backup? Current questions and participants will be replaced. This cannot undo messages already sent to Twitch.',
              )}
            </p>
            <button className="secondary" disabled={disabled} onClick={() => setPreview(null)}>
              {t('Cancel')}
            </button>{' '}
            <button
              className="primary"
              disabled={disabled}
              onClick={async () => {
                setMessage('');
                if (await act('restore-backup', { id: preview.id, confirmed: true })) {
                  setPreview(null);
                  setMessage('Backup restored.');
                  await loadBackups();
                }
              }}
            >
              {t('Confirm restoration')}
            </button>
          </section>
        )}
      </details>
      {loading && <p role="status">{t('Loading')}</p>}
      {message && <p role="status">{t(message)}</p>}
      {error && <p role="alert">{t(error)}</p>}
    </>
  );
}
