import { ErrorCodes, FinTSClientError } from './errors.js';
import type { TanChallenge, TanMethod } from './types.js';
import type { ParsedSegment } from './message.js';

/**
 * TAN (two-step) helpers. Covers classic HKTAN flows plus decoupled/pushTAN
 * (TAN-Process 2 variant S): the bank answers "TAN received, waiting for
 * confirmation in the other channel" and the client polls HITAN status.
 */

export function isDecoupledMethod(method: TanMethod | undefined): boolean {
  return method?.decoupled === true;
}

/** Extract a TAN challenge from HITAN segments. */
export function parseTanChallenge(segments: ParsedSegment[]): TanChallenge | undefined {
  for (const seg of segments) {
    if (seg.id !== 'HITAN') continue;
    // Simplified encoding: "reference:status:challenge:decoupledFlag".
    for (const el of seg.elements) {
      const parts = el.split(':');
      if (parts.length < 2) continue;
      const reference = parts[0] as string;
      const statusRaw = (parts[1] ?? '').toLowerCase();
      const status =
        statusRaw === 'done' ? 'done'
        : statusRaw === 'pending' ? 'decoupled_pending'
        : statusRaw === 'failed' ? 'failed'
        : 'needed';
      return {
        reference,
        challenge: parts[2] || undefined,
        status,
        decoupled: (parts[3] ?? '') === 'S' || status === 'decoupled_pending',
      };
    }
  }
  return undefined;
}

export function assertTanRequired(challenge: TanChallenge | undefined, retCodes: string[]): void {
  if (challenge) return;
  if (retCodes.some((c) => c === '0030' || c === '0020')) return;
  throw new FinTSClientError(ErrorCodes.TanFailed, 'Expected TAN challenge but bank sent none');
}
