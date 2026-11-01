// Only known provider status codes are surfaced. Never return raw provider messages,
// which may contain submitted text, identifiers or authorization details.
export function aiFailure(error: unknown, fallback: string) {
  const value = error as
    { status?: number; code?: string; name?: string; message?: string } | undefined;
  const internal = new Map([
    [
      'Hosted AI allowance exhausted. Contact the service operator or wait for the daily reset.',
      'hosted_allowance_exhausted',
    ],
    ['Hosted AI quota service unavailable. No AI request was sent.', 'hosted_quota_unavailable'],
    [
      'Hosted AI quota service unavailable. Check the quota migration; no AI request was sent.',
      'hosted_quota_storage_error',
    ],
    [
      'AI access is disabled for this channel. Contact the service operator.',
      'hosted_access_disabled',
    ],
    ['AI budget reached. Increase limits or start a new live session.', 'local_budget_exhausted'],
    ['The model did not return a valid grouping decision.', 'invalid_grouping_result'],
  ]);
  const internalCategory = internal.get(value?.message || '');
  const codes = [
    'insufficient_quota',
    'invalid_api_key',
    'model_not_found',
    'unsupported_parameter',
    'invalid_json_schema',
    'invalid_type',
  ];
  console.error('ChatSpin AI operation failed', {
    status: typeof value?.status === 'number' ? value.status : undefined,
    category:
      internalCategory || (codes.includes(value?.code || '') ? value!.code : 'request failed'),
  });
  if (internalCategory) return value!.message!;
  if (value?.status === 401) return 'AI authentication failed. Check the server API key.';
  if (value?.status === 403) return 'AI access denied. Check project and model permissions.';
  if (value?.status === 429 && value.code === 'insufficient_quota')
    return 'AI quota exhausted. Check API billing and project limits.';
  if (value?.status === 429) return 'AI rate limit reached. Retry queued.';
  return fallback;
}
