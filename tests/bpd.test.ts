import { describe, expect, it } from 'vitest';
import { parseBankParameters, parseUserParameters } from '../src/bpd.js';
import { parseMessage } from '../src/message.js';

describe('BPD/UPD parsers', () => {
  it('parses TAN methods incl. decoupled pushTAN', () => {
    const segments = parseMessage(
      "HIBPA:3:3+Mock Bank'HITANS:4:1+920:smstan:6+921:pushTAN:6+900:chipTAN manuell:6'",
    );
    const bpd = parseBankParameters(segments);
    expect(bpd.bankName).toBe('Mock Bank');
    expect(bpd.supportedTanMethods).toHaveLength(3);
    expect(bpd.supportedTanMethods.find((m) => m.id === '921')).toMatchObject({
      label: 'pushTAN',
      decoupled: true,
    });
    expect(bpd.supportedTanMethods.find((m) => m.id === '900')?.decoupled).toBe(false);
  });

  it('parses accounts from HIUPD', () => {
    const segments = parseMessage(
      'HIUPD:4:4+DE75512108001234567899:12345678:51210800:Girokonto:EUR:HKSAL:1,HKKAZ:1' + "'",
    );
    const upd = parseUserParameters(segments);
    expect(upd.accounts).toHaveLength(1);
    expect(upd.accounts[0]).toMatchObject({
      iban: 'DE75512108001234567899',
      currency: 'EUR',
      allowedTransactions: ['HKSAL:1', 'HKKAZ:1'],
    });
  });

  it('rejects UPD without accounts', () => {
    expect(() => parseUserParameters(parseMessage("HIRMS:2:2+0020:ok'"))).toThrow(/HIUPD/);
  });
});
