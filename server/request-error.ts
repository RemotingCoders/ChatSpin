/** An expected, safe-to-display input or domain validation failure. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}
