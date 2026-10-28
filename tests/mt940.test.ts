import { describe, expect, it } from 'vitest';
import { parseBalanceFragment, parseMt940 } from '../src/mt940.js';
import { MOCK_MT940 } from './helpers/mockServer.js';

describe('MT940 parser', () => {
  it('parses balances and transactions (python-fints style vector)', () => {
    const stmt = parseMt940(MOCK_MT940);
    expect(stmt.accountNumber).toBe('12345678');
    expect(stmt.currency).toBe('EUR');
    expect(stmt.openingBalance).toBeCloseTo(1234.56, 2);
    expect(stmt.closingBalance).toBeCloseTo(1424.57, 2);
    expect(stmt.transactions).toHaveLength(2);
    expect(stmt.transactions[0]).toMatchObject({
      valueDate: '2026-01-02',
      amount: 250,
      credit: true,
    });
    expect(stmt.transactions[1]).toMatchObject({ amount: 59.99, credit: false });
  });

  it('rejects statements without balances', () => {
    expect(() => parseMt940(':20:X\n:25:1\n')).toThrow(/:60F/);
  });

  it('parses HISAL balance fragments', () => {
    expect(parseBalanceFragment('EUR:1424,57:2026-01-03', 'DE00')).toMatchObject({
      amount: 1424.57,
      currency: 'EUR',
      date: '2026-01-03',
    });
  });
});
