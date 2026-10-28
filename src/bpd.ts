import { ErrorCodes, FinTSClientError } from './errors.js';
import type { Account, BankParameters, TanMethod, TanMethodType, UserParameters } from './types.js';
import type { ParsedSegment } from './message.js';

function tanKind(label: string, id: string): TanMethodType {
  const l = label.toLowerCase();
  if (l.includes('push') || l.includes('decoupled') || id === '921' || id === '910') return 'decoupled';
  if (l.includes('app')) return 'app';
  if (l.includes('sms')) return 'sms';
  if (l.includes('chip')) return 'chip';
  if (l.includes('liste') || l.includes('list')) return 'list';
  return 'other';
}

/** Parse HIBPA/HITANS bank parameter segments into BankParameters. */
export function parseBankParameters(segments: ParsedSegment[]): BankParameters {
  const hibpa = segments.filter((s) => s.id === 'HIBPA' || s.id === 'HIUPA');
  const hitans = segments.filter((s) => s.id === 'HITANS');
  const methods: TanMethod[] = [];
  for (const seg of hitans) {
    for (const el of seg.elements) {
      // Simplified encoding used by this client: "id:label:maxLen".
      const parts = el.split(':');
      if (parts.length < 2 || !/^\d+$/.test(parts[0] as string)) continue;
      const id = parts[0] as string;
      const label = parts[1] as string;
      const maxTanLength = parts[2] !== undefined && parts[2] !== '' ? Number(parts[2]) : undefined;
      const decoupled = tanKind(label, id) === 'decoupled';
      const method: TanMethod = { id, label, kind: tanKind(label, id), decoupled };
      if (maxTanLength !== undefined && Number.isFinite(maxTanLength)) method.maxTanLength = maxTanLength;
      if (!methods.some((mm) => mm.id === id)) methods.push(method);
    }
  }
  const bankName = hibpa[0]?.elements[0] ?? 'Unknown bank';
  return { bpdVersion: String(hibpa[0]?.version ?? 3), supportedTanMethods: methods, bankName };
}

/** Parse HIUPD account segments ("iban:accountNumber:bankCode:product:currency:allowedCsv"). */
export function parseUserParameters(segments: ParsedSegment[]): UserParameters {
  const accounts: Account[] = [];
  for (const seg of segments) {
    if (seg.id !== 'HIUPD') continue;
    for (const el of seg.elements) {
      const parts = el.split(':');
      if (parts.length < 4) continue;
      const [iban, accountNumber, bankCode, productName] = parts as [string, string, string, string];
      if (!iban || !accountNumber) continue;
      // Fields 0-4 are fixed; the allowed-transactions list itself contains
      // ':' (e.g. "HKSAL:1,HKKAZ:1"), so rejoin the tail before splitting.
      const currency = parts[4] || 'EUR';
      const allowedRaw = parts.slice(5).join(':');
      accounts.push({
        iban,
        accountNumber,
        bankCode: bankCode || '',
        productName: productName || 'Girokonto',
        currency,
        allowedTransactions: allowedRaw.split(',').map((s) => s.trim()).filter(Boolean),
      });
    }
  }
  const hiupa = segments.find((s) => s.id === 'HIUPA');
  if (accounts.length === 0) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, 'No HIUPD account segments in UPD response');
  }
  return { updVersion: String(hiupa?.version ?? 4), accounts };
}
