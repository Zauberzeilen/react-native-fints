import { ErrorCodes, FinTSClientError } from './errors.js';
import type { FetchFn } from './types.js';

/**
 * Thin injectable HTTP transport. Uses the provided fetch implementation
 * (defaults to globalThis.fetch) so React Native / Hermes apps can inject
 * their own networking stack. No Node APIs are used anywhere in this module.
 */
export class FinTSTransport {
  private readonly fetchFn: FetchFn;
  private readonly bankUrl: string;

  constructor(bankUrl: string, fetchFn?: FetchFn) {
    if (!bankUrl) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'bankUrl is required');
    this.bankUrl = bankUrl;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (!fetchFn && typeof globalFetch !== 'function') {
      throw new FinTSClientError(
        ErrorCodes.ValidationFailed,
        'No fetch implementation available; pass fetchFn explicitly',
      );
    }
    this.fetchFn = fetchFn ?? (globalFetch as FetchFn);
  }

  get url(): string {
    return this.bankUrl;
  }

  async post(encodedMessageBase64: string): Promise<string> {
    let res;
    try {
      res = await this.fetchFn(this.bankUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: encodedMessageBase64,
      });
    } catch (err) {
      throw new FinTSClientError(
        ErrorCodes.TransportFailed,
        `Transport failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new FinTSClientError(ErrorCodes.TransportFailed, `HTTP ${res.status} from FinTS endpoint`);
    }
    return text;
  }
}
