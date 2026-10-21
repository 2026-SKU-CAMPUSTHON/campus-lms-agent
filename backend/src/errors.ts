export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) { super(message) }
}
