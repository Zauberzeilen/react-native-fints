import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/message.js';
import { buildPain001, validateTransferInput } from '../src/pain.js';

const VALID = {
  fromIban: 'DE75512108001234567899',
  toIban: 'DE68210501700012345678',
  recipientName: 'Max Mustermann',
  amount: 12.5,
  purpose: 'Miete',
};

describe('SEPA transfers (pain.001)', () => {
  it('builds a well-formed pain.001 document', () => {
    const xml = buildPain001(VALID, 'MSG-1', new Date('2026-01-05T10:00:00Z'));
    expect(xml).toContain('pain.001.001.03');
    expect(xml).toContain('DE75512108001234567899');
    expect(xml).toContain('12.50');
    expect(xml).toContain('Miete');
  });

  it('escapes XML in user input', () => {
    const xml = buildPain001({ ...VALID, purpose: 'A&B <test>' }, 'MSG-2');
    expect(xml).toContain('A&amp;B &lt;test&gt;');
  });

  it('rejects invalid IBANs, names and amounts', () => {
    expect(() => validateTransferInput({ ...VALID, fromIban: '123' })).toThrow(/fromIban/);
    expect(() => validateTransferInput({ ...VALID, toIban: 'XX' })).toThrow(/toIban/);
    expect(() => validateTransferInput({ ...VALID, recipientName: '  ' })).toThrow(/recipientName/);
    expect(() => validateTransferInput({ ...VALID, amount: 0 })).toThrow(/amount/);
    expect(() => validateTransferInput({ ...VALID, amount: 1.234 })).toThrow(/decimals/);
  });

  it('parses but ignores unrelated segments', () => {
    expect(parseMessage("HIRMS:2:2+0020:ok'")).toHaveLength(1);
  });
});
