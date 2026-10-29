export function parseModeratorIds(text: string) {
  const ids = text.split(/[\s,]+/).filter(Boolean);
  if (ids.length > 20 || ids.some((id) => !/^\d{1,30}$/.test(id)))
    throw Error('Use up to 20 numeric Twitch user IDs, separated by commas.');
  return [...new Set(ids)];
}
export type BackupSummary = { id: string; createdAt: string; groups: number; participants: number };
export type BackupPreview = {
  id: string;
  createdAt: string;
  groups: { title: string; status: string }[];
  participants: number;
};
