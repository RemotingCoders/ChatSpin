import type { Group, State, User } from './domain.ts';

type ReplyJob = { groupId: string; userId: string; messageId: string; answer: string; parts: string[]; next: number; created: number };

export function approvedReplyParts(user: User, answer: string) {
  const name = (user.login || user.name).replace(/[^a-zA-Z0-9_]/gu, '').slice(0, 25);
  if (!name) return [];
  const prefix = `@${name} `;
  const size = 500 - prefix.length;
  const characters = Array.from(answer.trim());
  const parts: string[] = [];
  while (characters.length) parts.push(prefix + characters.splice(0, size).join(''));
  return parts;
}

export class ApprovedReplies {
  status = 'Ready';
  private jobs: ReplyJob[] = [];
  private busy = false;
  constructor(private state: () => State, private send: (message: string, parentId: string) => Promise<void>, private ready: () => boolean, private persist: () => void) {}

  enqueue(group: Group, user: User, messageId?: string, now = Date.now()) {
    if (!messageId || group.status !== 'written' || !group.answer.trim()) return false;
    const state = this.state();
    const history = state.replyHistory ||= {};
    const key = `${group.id}:${user.id}`;
    if ((history[key] !== undefined && history[key] > now - 60000) || this.jobs.some(job => job.groupId === group.id && job.userId === user.id)) return false;
    if (this.jobs.length >= 50) { this.status = 'Reply queue full — some replies were skipped'; return false; }
    const parts = approvedReplyParts(user, group.answer);
    if (!parts.length) return false;
    history[key] = now;
    for (const old of Object.keys(history).sort((a, b) => history[b] - history[a]).slice(2000)) delete history[old];
    this.persist();
    this.jobs.push({ groupId: group.id, userId: user.id, messageId, answer: group.answer, parts, next: 0, created: now });
    this.status = 'Approved reply queued';
    return true;
  }

  async flush(now = Date.now()) {
    if (this.busy) return;
    while (this.jobs.length) {
      const job = this.jobs[0];
      const group = this.state().groups.find(group => group.id === job.groupId);
      if (!group || group.status !== 'written' || group.answer !== job.answer || now - job.created > 300000) { this.jobs.shift(); continue; }
      if (!this.ready()) { this.status = 'Reconnect Twitch to send queued replies'; return; }
      this.busy = true;
      try {
        await this.send(job.parts[job.next], job.messageId);
        job.next++;
        if (job.next === job.parts.length) { this.jobs.shift(); this.status = 'Approved answer sent to Twitch chat'; }
        else this.status = 'Sending approved answer in parts';
      } catch {
        this.jobs.shift();
        this.status = 'Chat reply failed or was held by Twitch. Check permissions and moderation.';
      } finally { this.busy = false; }
      return;
    }
  }
}
