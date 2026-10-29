import { answerIsActive, type Group, type State, type User } from './domain.js';
type ReplyJob = {
  questionText?: string;
  groupId: string;
  userId: string;
  messageId: string;
  answer: string;
  parts: string[];
  next: number;
  created: number;
  sending?: boolean;
};
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
  private get jobs(): ReplyJob[] {
    return (this.state().replyJobs ||= []);
  }
  private log(job: ReplyJob, status: string) {
    const state = this.state();
    state.replyLog ||= [];
    const old = state.replyLog.find((row) => row.messageId === job.messageId);
    if (old) old.status = status;
    else
      state.replyLog.push({
        at: Date.now(),
        messageId: job.messageId,
        groupId: job.groupId,
        user: job.userId,
        answer: job.answer,
        status,
      });
    state.replyLog = state.replyLog.slice(-100);
    this.persist();
  }
  private busy = false;
  get isSending() {
    return this.busy;
  }
  constructor(
    private state: () => State,
    private send: (message: string, parentId: string) => Promise<void>,
    private ready: () => boolean,
    private persist: () => void,
    private translate?: (
      group: Group,
      questionText?: string,
    ) =>
      | { status: 'ready'; text: string }
      | { status: 'pending' }
      | { status: 'failed'; reason: string },
  ) {}
  enqueue(group: Group, user: User, messageId?: string, now = Date.now(), questionText?: string) {
    if (!messageId || !answerIsActive(this.state(), group)) return false;
    const state = this.state();
    const history = (state.replyHistory ||= {});
    const key = `${group.id}:${user.id}`;
    if (
      (history[key] !== undefined && history[key] > now - 60000) ||
      this.jobs.some((job) => job.groupId === group.id && job.userId === user.id)
    )
      return false;
    if (this.jobs.length >= 50) {
      this.status = 'Reply queue full — some replies were skipped';
      return false;
    }
    const parts = approvedReplyParts(user, group.answer);
    if (!parts.length) return false;
    history[key] = now;
    for (const old of Object.keys(history)
      .sort((a, b) => history[b] - history[a])
      .slice(2000))
      delete history[old];
    const job = {
      questionText,
      groupId: group.id,
      userId: user.id,
      messageId,
      answer: group.answer,
      parts,
      next: 0,
      created: now,
    };
    this.jobs.push(job);
    this.log(job, 'Queued');
    this.status = 'Approved reply queued';
    return true;
  }
  async flush(now = Date.now()) {
    if (this.busy) return;
    if (this.state().repliesPaused) {
      this.status = 'Public replies paused';
      return;
    }
    while (this.jobs.length) {
      const job = this.jobs[0];
      if (job.sending) {
        this.jobs.shift();
        this.log(job, 'Outcome unknown after restart — not retried');
        continue;
      }
      const group = this.state().groups.find((group) => group.id === job.groupId);
      if (
        !group ||
        !answerIsActive(this.state(), group) ||
        group.answer !== job.answer ||
        now - job.created > 300000
      ) {
        this.jobs.shift();
        this.log(job, 'Cancelled or expired');
        continue;
      }
      if (this.translate && job.next === 0) {
        const translated = this.translate(group, job.questionText);
        if (translated.status === 'pending') {
          this.status = 'Translating approved reply';
          return;
        }
        if (translated.status === 'failed') {
          this.jobs.shift();
          this.log(job, 'Reply withheld — ' + translated.reason);
          continue;
        }
        const recipient = job.parts[0]?.match(/^@([A-Za-z0-9_]+) /)?.[1];
        if (!recipient) {
          this.jobs.shift();
          this.log(job, 'Reply withheld — missing recipient');
          continue;
        }
        job.parts = approvedReplyParts({ id: job.userId, name: recipient }, translated.text);
      }
      if (!this.ready()) {
        this.status = 'Reconnect Twitch to send queued replies';
        return;
      }
      this.busy = true;
      try {
        job.sending = true;
        this.log(job, 'Sending');
        await this.send(job.parts[job.next], job.messageId);
        job.sending = false;
        job.next++;
        if (job.next === job.parts.length) {
          this.jobs.shift();
          this.log(job, 'Sent');
          this.status = 'Approved answer sent to Twitch chat';
        } else {
          this.log(job, `Sending part ${job.next}/${job.parts.length}`);
          this.status = 'Sending approved answer in parts';
        }
      } catch {
        this.jobs.shift();
        this.log(job, 'Failed or held — inspect Twitch permissions/moderation');
        this.status = 'Chat reply failed or was held by Twitch. Check permissions and moderation.';
      } finally {
        this.busy = false;
      }
      return;
    }
  }
}
