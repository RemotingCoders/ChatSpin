import { addQuestion, answerIsActive, normalize, type Group, type State, type User } from './domain.ts';
import { extractChatQuestion } from './chat.ts';
export class QuestionWork {
    private rates = new Map<string, number[]>();
    busy = false;
    status = 'Ready';
    constructor(private state: State, private persist: () => void, private detect: (messages: {
        id: string;
        text: string;
    }[]) => Promise<string[]>, private group: (ids: string[]) => Promise<void>, private reply: (group: Group, user: User, messageId: string) => void) {
        state.aiJobs ||= [];
        state.pendingMessages ||= [];
        for (const g of state.groups)
            if (g.status === 'pending' && !g.aiProcessed)
                this.enqueue(g.id);
    }
    enqueue(id: string) {
        if (!this.state.aiJobs!.some(j => j.id === id) && this.state.aiJobs!.length < 100)
            this.state.aiJobs!.push({ id, attempts: 0, next: 0 });
    }
    ingest(user: User, text: string, messageId: string, now = Date.now()) {
        this.deliver(now);
        if (this.state.pendingMessages!.some(m => m.messageId === messageId))
            return;
        if (this.state.pendingMessages!.length >= 100) {
            this.status = 'Question inbox full — new messages skipped';
            return;
        }
        for (const [id, times] of this.rates)
            if (!times.some(t => t > now - 60000))
                this.rates.delete(id);
        const recent = (this.rates.get(user.id) || []).filter(t => t > now - 60000);
        if (recent.length >= 10) {
            this.status = 'Viewer question limit reached';
            return;
        }
        recent.push(now);
        this.rates.set(user.id, recent);
        const question = extractChatQuestion(text);
        if (!question && (/^[!/]/u.test(text.trim()) || !/[\p{L}\p{N}]/u.test(text) || text.length > 500))
            return;
        const message = { user, text: question || text, messageId, at: now, attempts: 0, next: 0, detected: !!question, originalId: undefined as string | undefined };
        this.state.pendingMessages!.push(message);
        if (question)
            try {
                this.register(message);
            }
            catch {
                this.state.pendingMessages = this.state.pendingMessages!.filter(m => m !== message);
                this.status = 'Question capacity reached — archive or clear questions';
            }
        this.deliver();
        this.persist();
    }
    private register(message: NonNullable<State['pendingMessages']>[number]) {
        const group = addQuestion(this.state, message.user, message.text, message.messageId, message.at);
        message.detected = true;
        message.originalId = group.questions.find(q => q.user.id === message.user.id && normalize(q.text) === normalize(message.text))?.id || group.questions.at(-1)!.id;
        if (group.status === 'pending' && !group.aiProcessed)
            this.enqueue(group.id);
    }
    deliver(now = Date.now()) {
        this.state.pendingMessages = this.state.pendingMessages!.filter(message => {
            if (now - message.at > 300000)
                return false;
            if (!message.detected)
                return true;
            const g = this.state.groups.find(g => g.questions.some(q => q.id === message.originalId));
            if (!g)
                return false;
            if (answerIsActive(this.state, g)) {
                this.reply(g, message.user, message.messageId);
                return false;
            }
            return g.status === 'pending' && (!g.aiProcessed || !!g.review);
        });
    }
    retry() {
        for (const job of this.state.aiJobs!) {
            job.attempts = 0;
            job.next = 0;
            job.failed = false;
        }
        for (const m of this.state.pendingMessages!) {
            m.attempts = 0;
            m.next = 0;
        }
        for (const g of this.state.groups.filter(g => g.status === 'pending')) {
            g.aiProcessed = false;
            this.enqueue(g.id);
        }
        this.persist();
    }
    async tick(now = Date.now()) {
        if (this.busy)
            return;
        this.busy = true;
        try {
            this.deliver(now);
            this.state.aiJobs = this.state.aiJobs!.filter(j => this.state.groups.some(g => g.id === j.id && g.status === 'pending'));
            for (const group of this.state.groups)
                if (group.status === 'pending' && !group.aiProcessed)
                    this.enqueue(group.id);
            const messages = this.state.pendingMessages!.filter(m => !m.detected && m.attempts < 3 && m.next <= now).slice(0, 10);
            if (messages.length) {
                try {
                    const ids = await this.detect(messages.map(m => ({ id: m.messageId, text: m.text })));
                    for (const m of messages)
                        if (ids.includes(m.messageId))
                            this.register(m);
                        else
                            this.state.pendingMessages = this.state.pendingMessages!.filter(x => x !== m);
                }
                catch {
                    for (const m of messages) {
                        m.attempts++;
                        m.next = now + 2 ** m.attempts * 5000;
                    }
                    this.status = 'Question detection failed — retry queued';
                }
            }
            const jobs = this.state.aiJobs!.filter(j => !j.failed && j.next <= now).slice(0, 5);
            if (jobs.length) {
                try {
                    await this.group(jobs.map(j => j.id));
                    for (const job of jobs) {
                        const g = this.state.groups.find(g => g.id === job.id);
                        if (g)
                            g.aiProcessed = true;
                    }
                    this.state.aiJobs = this.state.aiJobs!.filter(j => !jobs.includes(j));
                    this.status = 'Ready';
                }
                catch {
                    for (const j of jobs) {
                        j.attempts++;
                        j.next = now + 2 ** j.attempts * 5000;
                        j.failed = j.attempts >= 3;
                    }
                    this.status = 'Grouping failed — retry queued; use Reprocess if exhausted';
                }
            }
            this.deliver();
            this.persist();
        }
        finally {
            this.busy = false;
        }
    }
}
