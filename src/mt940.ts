import { ErrorCodes, FinTSClientError } from './errors.js';
import type { Balance, Transaction } from './types.js';

/**
 * Minimal MT940 parser (SWIFT field subset used by HIKAZ responses):
 * :20:, :25:, :28C:, :60F:, :61:, :86:, :62F:.
 * Enough for the read-only MVP; full camt.052/053 XML parsing lives in camt.ts.
 */

export interface Mt940Statement {
  accountNumber: string;
  openingBalance: number;
  closingBalance: number;
  currency: string;
  transactions: Transaction[];
}

function parseAmount(raw: string): number {
  // MT940 uses comma as decimal separator.
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, `Invalid MT940 amount: ${raw}`);
  }
  return value;
}

function parseMt940Date(yyMMdd: string): string {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(yyMMdd);
  if (!m) throw new FinTSClientError(ErrorCodes.ParseFailed, `Invalid MT940 date: ${yyMMdd}`);
  // python-fints uses the same pivot: assume 20xx for statements.
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

export function parseMt940(raw: string): Mt940Statement {
  const text = raw.replace(/\r\n/g, '\n');
  const accountMatch = /:25:([^\n]*)/.exec(text);
  const openMatch = /:60F:([CD])(\d{6})([A-Z]{3})([0-9.,]+)/.exec(text);
  const closeMatch = /:62F:([CD])(\d{6})([A-Z]{3})([0-9.,]+)/.exec(text);
  if (!openMatch || !closeMatch) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, 'MT940 missing :60F: or :62F: balance');
  }

  const currency = openMatch[3] as string;
  const sign = (dc: string) => (dc === 'C' ? 1 : -1);
  const openingBalance = sign(openMatch[1] as string) * parseAmount(openMatch[4] as string);
  const closingBalance = sign(closeMatch[1] as string) * parseAmount(closeMatch[4] as string);

  const transactions: Transaction[] = [];
  // :61: value-date booking-date debit/credit funds-code amount ... :86: purpose
  const stmtRegex = /:61:(\d{6})(\d{4})?([CD])([0-9.,]+)[^\n]*\n(?::86:([^\n:]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = stmtRegex.exec(text)) !== null) {
    const valueDate = parseMt940Date(m[1] as string);
    const bookingExtra = m[2];
    const bookingDate = bookingExtra ? valueDate.slice(0, 4) + valueDate.slice(4, 6) + '-01' : valueDate;
    void bookingExtra;
    const credit = m[3] === 'C';
    const amount = parseAmount(m[4] as string);
    const info = (m[5] ?? '').trim();
    // Heuristic split used by several FinTS banks: first line booking text,
    // remainder purpose; counterparty passed via structured fields when present.
    const purpose = info.replace(/\s+/g, ' ').trim();
    transactions.push({
      bookingDate: valueDate,
      valueDate,
      amount,
      currency,
      credit,
      purpose,
      counterpartyName: '',
      counterpartyIban: '',
      bookingText: purpose.slice(0, 27) || 'UMSATZ',
    });
    void bookingDate;
  }

  return {
    accountNumber: (accountMatch?.[1] ?? '').trim(),
    openingBalance,
    closingBalance,
    currency,
    transactions,
  };
}

/** Parse an HISAL balance response fragment "CUR:AMOUNT:DATE". */
export function parseBalanceFragment(fragment: string, accountIban: string): Balance {
  const parts = fragment.split(':');
  if (parts.length < 3) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, `Invalid balance fragment: ${fragment}`);
  }
  const currency = (parts[0] ?? '').trim() || 'EUR';
  const amount = Number((parts[1] ?? '').replace(',', '.'));
  const date = (parts[2] ?? '').trim();
  if (!Number.isFinite(amount)) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, `Invalid balance amount: ${fragment}`);
  }
  return { accountIban, amount, currency, date };
}
