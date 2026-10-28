import { parseBankParameters, parseUserParameters } from './bpd.js';
import { ErrorCodes, FinTSClientError } from './errors.js';
import {
  buildDialogInit,
  decodeFromTransport,
  encodeForTransport,
  isSuccessReturnCodes,
  parseMessage,
  parseReturnCodes,
} from './message.js';
import { parseBalanceFragment, parseMt940 } from './mt940.js';
import { buildPain001 } from './pain.js';
import { isDecoupledMethod, parseTanChallenge } from './tan.js';
import { FinTSTransport } from './transport.js';
import type {
  Account,
  Balance,
  BankParameters,
  ClientOptions,
  TanChallenge,
  TanMethod,
  Transaction,
  TransactionsQuery,
  TransferInput,
  TransferResult,
  UserParameters,
} from './types.js';

/**
 * FinTS client (read-first MVP + SEPA transfers).
 *
 * Local-first: talks directly to the bank's FinTS endpoint via an injectable
 * fetch transport. The PIN lives only in memory (private field, `clear()`
 * wipes it) and is never persisted or logged.
 */
export class FinTSClient {
  private readonly transport: FinTSTransport;
  private readonly bankCode: string;
  private readonly userId: string;
  private readonly customerId: string;
  private readonly productName: string;
  private readonly productVersion: string;
  private readonly tanMethodId?: string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private pin: string | undefined;
  private seq = 1;
  private bpd: BankParameters | undefined;
  private upd: UserParameters | undefined;
  private msgCounter = 0;

  constructor(options: ClientOptions) {
    if (!options.bankCode) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'bankCode is required');
    if (!options.userId) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'userId is required');
    this.transport = new FinTSTransport(options.bankUrl, options.fetchFn);
    this.bankCode = options.bankCode;
    this.userId = options.userId;
    this.customerId = options.customerId ?? options.userId;
    this.productName = options.productName ?? 'react-native-fints';
    this.productVersion = options.productVersion ?? '0.1.0';
    this.tanMethodId = options.tanMethodId;
    this.pollIntervalMs = options.decoupledPollIntervalMs ?? 3000;
    this.maxPolls = options.decoupledMaxPolls ?? 20;
  }

  /** Set (or rotate) the PIN. Kept in memory only, never persisted. */
  setPin(pin: string): void {
    if (!pin) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'PIN must not be empty');
    this.pin = pin;
  }

  /** Wipe PIN and cached dialog state from memory. */
  clear(): void {
    this.pin = undefined;
    this.upd = undefined;
    this.seq = 1;
  }

  get cachedBpd(): BankParameters | undefined {
    return this.bpd;
  }

  get cachedUpd(): UserParameters | undefined {
    return this.upd;
  }

  /** Currently selected TAN method (from cached BPD), if any. */
  getTanMethod(): TanMethod | undefined {
    if (!this.bpd) return undefined;
    if (this.tanMethodId) return this.bpd.supportedTanMethods.find((m) => m.id === this.tanMethodId);
    return this.bpd.supportedTanMethods[0];
  }

  /** All TAN methods announced by the bank (fetches BPD on first call). */
  async getTanMethods(): Promise<TanMethod[]> {
    const bpd = await this.getBPD();
    return bpd.supportedTanMethods;
  }

  /** Fetch bank parameter data (BPD: HITANS/HIBPA). Cached after first call. */
  async getBPD(): Promise<BankParameters> {
    if (this.bpd) return this.bpd;
    const segments = await this.dialog(['HNHBK:0:0+ANON' + "'"]);
    this.bpd = parseBankParameters(segments);
    return this.bpd;
  }

  /** Fetch user parameter data (UPD: HIUPD accounts). Cached after first call. */
  async getUPD(): Promise<UserParameters> {
    if (this.upd) return this.upd;
    this.requirePin();
    const segments = await this.dialog(['HKSPA:0:0+J' + "'"]);
    this.upd = parseUserParameters(segments);
    return this.upd;
  }

  /** List accounts of the authenticated user. */
  async getAccounts(): Promise<Account[]> {
    const upd = await this.getUPD();
    return upd.accounts;
  }

  /** Query the booked balance (HKSAL) for an account. */
  async getBalance(account: Account): Promise<Balance> {
    this.requirePin();
    const segments = await this.dialog([`HKSAL:0:0+${account.iban}'`]);
    const hisal = segments.find((s) => s.id === 'HISAL');
    if (!hisal?.elements[0]) {
      throw new FinTSClientError(ErrorCodes.BankRejected, 'Bank sent no HISAL balance segment');
    }
    return parseBalanceFragment(hisal.elements[0], account.iban);
  }

  /** Query transactions (HKKAZ, MT940 payload in HIKAZ) for an account + range. */
  async getTransactions(account: Account, query: TransactionsQuery): Promise<Transaction[]> {
    this.requirePin();
    validateDate(query.from);
    validateDate(query.to);
    const segments = await this.dialog([`HKKAZ:0:0+${account.iban}+${query.from}:${query.to}'`]);
    const hikaz = segments.filter((s) => s.id === 'HIKAZ');
    if (hikaz.length === 0) {
      throw new FinTSClientError(ErrorCodes.BankRejected, 'Bank sent no HIKAZ statement segment');
    }
    const all: Transaction[] = [];
    for (const seg of hikaz) {
      for (const el of seg.elements) {
        const stmt = parseMt940(decodeMt940Element(el));
        all.push(...stmt.transactions);
      }
    }
    return all;
  }

  /**
   * Start a TAN-protected order. Returns the challenge the user must confirm.
   * For decoupled/pushTAN the challenge has status `decoupled_pending`.
   */
  async initiateTan(orderSegment: string): Promise<TanChallenge> {
    this.requirePin();
    const segments = await this.dialog([orderSegment]);
    const challenge = parseTanChallenge(segments);
    const codes = parseReturnCodes(segments).map((c) => c.code);
    if (!challenge) {
      if (codes.some((c) => c === '0030')) {
        // Bank accepted without TAN (e.g. single-step TAN or TAN-free order).
        return { reference: '', status: 'done', decoupled: false };
      }
      throw new FinTSClientError(ErrorCodes.TanFailed, 'Bank sent no HITAN challenge');
    }
    return challenge;
  }

  /** Submit the TAN for a previously initiated order reference. */
  async submitTan(reference: string, tan: string): Promise<void> {
    this.requirePin();
    if (!reference) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'TAN reference is required');
    if (!tan) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'TAN must not be empty');
    let segments;
    try {
      segments = await this.dialog([`HKTAN:0:0+${reference}+${tan}'`]);
    } catch (err) {
      // Wrong TAN arrives as a 99xx bank rejection; surface it as TAN_FAILED.
      if (err instanceof FinTSClientError && err.code === ErrorCodes.BankRejected) {
        throw new FinTSClientError(ErrorCodes.TanFailed, `TAN rejected: ${err.message}`);
      }
      throw err;
    }
    const codes = parseReturnCodes(segments);
    const success = codes.filter((c) => c.code.startsWith('00'));
    if (success.length === 0 && !isSuccessReturnCodes(codes)) {
      throw new FinTSClientError(
        ErrorCodes.TanFailed,
        `TAN rejected: ${codes.map((c) => `${c.code} ${c.text}`.trim()).join('; ') || 'no return code'}`,
      );
    }
  }

  /**
   * Poll a decoupled/pushTAN challenge until the user confirms in the
   * bank app (or until timeout). Resolves on `done`, rejects on `failed`/timeout.
   */
  async pollDecoupledTan(reference: string): Promise<void> {
    this.requirePin();
    if (!reference) throw new FinTSClientError(ErrorCodes.ValidationFailed, 'TAN reference is required');
    for (let attempt = 0; attempt < this.maxPolls; attempt++) {
      const segments = await this.dialog([`HKTAN:0:0+${reference}+?'`]);
      const challenge = parseTanChallenge(segments);
      if (challenge?.status === 'done') return;
      if (challenge?.status === 'failed') {
        throw new FinTSClientError(ErrorCodes.TanFailed, 'Decoupled TAN was rejected or cancelled');
      }
      await sleep(this.pollIntervalMs);
    }
    throw new FinTSClientError(ErrorCodes.TanTimeout, 'Decoupled TAN confirmation timed out');
  }

  /** true when the selected TAN method is a decoupled/push flow. */
  usesDecoupledTan(): boolean {
    return isDecoupledMethod(this.getTanMethod());
  }

  /** Build (and validate) a pain.001 document without submitting it. */
  buildTransfer(input: TransferInput): TransferResult {
    const pain001 = buildPain001(input, `MSG-${Date.now()}-${(this.msgCounter++).toString(36)}`);
    return { pain001 };
  }

  /** Submit a SEPA credit transfer (HKCCS). May return a TAN challenge. */
  async submitTransfer(input: TransferInput): Promise<TransferResult> {
    this.requirePin();
    const { pain001 } = this.buildTransfer(input);
    const segments = await this.dialog([`HKCCS:0:0+${input.fromIban}+${encodePainForSegment(pain001)}'`]);
    const codes = parseReturnCodes(segments).map((c) => c.code);
    const challenge = parseTanChallenge(segments);
    const orderRef = segments.find((s) => s.id === 'HIORD')?.elements[0];
    if (challenge && challenge.status !== 'done') {
      const result: TransferResult = { pain001, tanChallenge: challenge };
      if (orderRef) result.orderReference = orderRef;
      return result;
    }
    if (!isSuccessReturnCodes(parseReturnCodes(segments)) && !codes.includes('0030')) {
      throw new FinTSClientError(ErrorCodes.BankRejected, 'Bank rejected the transfer order');
    }
    const done: TransferResult = { pain001 };
    if (orderRef) done.orderReference = orderRef;
    return done;
  }

  private requirePin(): void {
    if (!this.pin) {
      throw new FinTSClientError(ErrorCodes.AuthFailed, 'No PIN set; call setPin() first');
    }
  }

  /** One dialog round-trip: build envelope, POST, decode + check return codes. */
  private async dialog(payloadSegments: string[]) {
    const message = buildDialogInit({
      seq: this.seq++,
      bankCode: this.bankCode,
      userId: this.userId,
      customerId: this.customerId,
      productName: this.productName,
      productVersion: this.productVersion,
      payloadSegments,
    });
    const raw = await this.transport.post(encodeForTransport(message));
    const segments = parseMessage(decodeFromTransport(raw));
    const codes = parseReturnCodes(segments);
    const fatal = codes.filter((c) => c.code.startsWith('90') || c.code.startsWith('99'));
    if (fatal.length > 0) {
      throw new FinTSClientError(
        ErrorCodes.BankRejected,
        `Bank rejected dialog: ${fatal.map((c) => `${c.code} ${c.text}`.trim()).join('; ')}`,
        fatal[0]?.code,
      );
    }
    return segments;
  }
}

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FinTSClientError(ErrorCodes.ValidationFailed, `Invalid date (expected YYYY-MM-DD): ${value}`);
  }
}

function decodeMt940Element(el: string): string {
  // Mock servers send MT940 inline; real banks wrap it in HNVSD binary data.
  if (el.startsWith('MT940:')) return el.slice('MT940:'.length);
  return el;
}

function encodePainForSegment(pain001: string): string {
  return `PAIN:${pain001.length}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
