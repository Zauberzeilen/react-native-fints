import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/message.js';
import { isDecoupledMethod, parseTanChallenge } from '../src/tan.js';

describe('TAN flows', () => {
  it('parses classic challenges', () => {
    const segments = parseMessage("HITAN:3:6+TANREF-1:needed:Bitte TAN eingeben:N'");
    const challenge = parseTanChallenge(segments);
    expect(challenge).toMatchObject({ reference: 'TANREF-1', status: 'needed', decoupled: false });
  });

  it('parses decoupled/pushTAN pending state', () => {
    const segments = parseMessage("HITAN:3:6+TANREF-1:pending:Warten auf Bestaetigung:S'");
    const challenge = parseTanChallenge(segments);
    expect(challenge).toMatchObject({ status: 'decoupled_pending', decoupled: true });
    expect(isDecoupledMethod({ id: '921', label: 'pushTAN', kind: 'decoupled', decoupled: true })).toBe(true);
  });

  it('returns undefined without HITAN', () => {
    expect(parseTanChallenge(parseMessage("HIRMS:2:2+0020:ok'"))).toBeUndefined();
  });
});
