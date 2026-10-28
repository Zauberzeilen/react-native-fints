export type TanMethodType = 'sms' | 'chip' | 'app' | 'decoupled' | 'push' | 'list' | 'other';

export interface TanMethod {
  /** HKTAN two-step id (e.g. 900, 910, 920, 921, 930). */
  id: string;
  /** Human readable label from BPD (e.g. "pushTAN", "smsTAN"). */
  label: string;
  kind: TanMethodType;
  /** true for decoupled / push flows (HKTAN v6, TAN-Process 2/S). */
  decoupled: boolean;
  /** Max TAN length announced by the bank, if any. */
  maxTanLength?: number;
}

export interface BankConnection {
  /** FinTS HTTPS endpoint of the bank (PIN/TAN URL). */
  bankUrl: string;
  /** German bank code (Bankleitzahl). */
  bankCode: string;
  /** Login user id (Benutzerkennung). */
  userId: string;
  /** Customer id (Kunden-ID); defaults to userId. */
  customerId?: string;
}

export interface ClientOptions extends BankConnection {
  productName?: string;
  productVersion?: string;
  /** Injectable fetch implementation (defaults to global fetch). */
  fetchFn?: FetchFn;
  /** TAN method id to use for two-step flows. */
  tanMethodId?: string;
  /** Poll interval in ms for decoupled TAN status. */
  decoupledPollIntervalMs?: number;
  /** Max polls for decoupled TAN status. */
  decoupledMaxPolls?: number;
}

export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface Account {
  /** IBAN (or account number for legacy banks). */
  iban: string;
  accountNumber: string;
  bankCode: string;
  /** Account product name from UPD. */
  productName: string;
  currency: string;
  /** Allowed business transactions (e.g. HKSAL:1, HKKAZ:1). */
  allowedTransactions: string[];
}

export interface Balance {
  accountIban: string;
  /** Booked balance amount. */
  amount: number;
  currency: string;
  /** Booking date as YYYY-MM-DD. */
  date: string;
}

export interface Transaction {
  /** Booking date as YYYY-MM-DD. */
  bookingDate: string;
  /** Value date as YYYY-MM-DD (may equal booking date). */
  valueDate: string;
  amount: number;
  currency: string;
  /** true = credit, false = debit. */
  credit: boolean;
  purpose: string;
  counterpartyName: string;
  counterpartyIban: string;
  bookingText: string;
}

export interface TransactionsQuery {
  from: string;
  to: string;
}

export interface BankParameters {
  bpdVersion: string;
  supportedTanMethods: TanMethod[];
  bankName: string;
}

export interface UserParameters {
  updVersion: string;
  accounts: Account[];
}

export type TanStatus = 'needed' | 'decoupled_pending' | 'done' | 'failed';

export interface TanChallenge {
  /** Reference (Auftragsreferenz) to pass back with the TAN. */
  reference: string;
  /** Challenge text / HHD image data shown to the user. */
  challenge?: string;
  /** Challenge as data URL for optical TAN methods. */
  challengeHhdUc?: string;
  status: TanStatus;
  decoupled: boolean;
}

export interface TransferInput {
  fromIban: string;
  toIban: string;
  /** BIC of the recipient (optional for domestic SEPA). */
  toBic?: string;
  recipientName: string;
  amount: number;
  currency?: string;
  purpose?: string;
  /** End-to-end reference. */
  endToEndId?: string;
}

export interface TransferResult {
  /** pain.001 XML that was (or would be) submitted. */
  pain001: string;
  /** Order reference assigned by the bank, if any. */
  orderReference?: string;
  tanChallenge?: TanChallenge;
}
