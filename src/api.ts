export async function request(path: string, body?: unknown) {
    const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) } : { signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
}
// Serializes polling and action-triggered reloads. A forced reload always starts
// after any old poll, so a pre-action response cannot win the race.
export class SerializedLoader {
    private running?: Promise<void>;
    constructor(private read: () => Promise<void>) { }
    async load(force = false): Promise<void> {
        if (this.running) {
            await this.running.catch(() => { });
            if (!force)
                return;
            return this.load();
        }
        const running = this.read();
        this.running = running;
        try {
            await running;
        }
        finally {
            if (this.running === running)
                this.running = undefined;
        }
    }
}
