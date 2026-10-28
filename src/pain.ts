import { ErrorCodes, FinTSClientError } from './errors.js';
import type { TransferInput } from './types.js';

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function validateTransferInput(input: TransferInput): void {
  if (!/^DE\d{20}$/.test(input.fromIban.replace(/\s+/g, ''))) {
    throw new FinTSClientError(ErrorCodes.ValidationFailed, 'fromIban must be a German IBAN (DE + 20 digits)');
  }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(input.toIban.replace(/\s+/g, ''))) {
    throw new FinTSClientError(ErrorCodes.ValidationFailed, 'toIban must be a valid IBAN');
  }
  if (!input.recipientName.trim()) {
    throw new FinTSClientError(ErrorCodes.ValidationFailed, 'recipientName is required');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new FinTSClientError(ErrorCodes.ValidationFailed, 'amount must be a positive number');
  }
  if (Math.round(input.amount * 100) !== input.amount * 100) {
    throw new FinTSClientError(ErrorCodes.ValidationFailed, 'amount supports at most 2 decimals');
  }
}

/** Build a minimal pain.001.001.03 SEPA credit transfer document. */
export function buildPain001(input: TransferInput, messageId: string, now: Date = new Date()): string {
  validateTransferInput(input);
  const currency = input.currency ?? 'EUR';
  const amount = input.amount.toFixed(2);
  const requestedDate = now.toISOString().slice(0, 10);
  const from = input.fromIban.replace(/\s+/g, '');
  const to = input.toIban.replace(/\s+/g, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">` +
    `<CstmrCdtTrfInitn>` +
    `<GrpHdr><MsgId>${xmlEscape(messageId)}</MsgId>` +
    `<CreDtTm>${xmlEscape(now.toISOString())}</CreDtTm>` +
    `<NbOfTxs>1</NbOfTxs><CtrlSum>${xmlEscape(amount)}</CtrlSum>` +
    `<InitgPty><Nm>${xmlEscape(input.recipientName.slice(0, 70))}</Nm></InitgPty></GrpHdr>` +
    `<PmtInf><PmtInfId>${xmlEscape(messageId)}-1</PmtInfId><PmtMtd>TRF</PmtMtd>` +
    `<ReqdExctnDt>${xmlEscape(requestedDate)}</ReqdExctnDt>` +
    `<Dbtr><Nm>${xmlEscape(input.recipientName.slice(0, 70))}</Nm></Dbtr>` +
    `<DbtrAcct><Id><IBAN>${xmlEscape(from)}</IBAN></Id><Ccy>${xmlEscape(currency)}</Ccy></DbtrAcct>` +
    `<CdtTrfTxInf><PmtId><EndToEndId>${xmlEscape(input.endToEndId ?? 'NOTPROVIDED')}</EndToEndId></PmtId>` +
    `<Amt><InstdAmt Ccy="${xmlEscape(currency)}">${xmlEscape(amount)}</InstdAmt></Amt>` +
    `<Cdtr><Nm>${xmlEscape(input.recipientName.slice(0, 70))}</Nm></Cdtr>` +
    `<CdtrAcct><Id><IBAN>${xmlEscape(to)}</IBAN></Id></CdtrAcct>` +
    (input.purpose ? `<RmtInf><Ustrd>${xmlEscape(input.purpose.slice(0, 140))}</Ustrd></RmtInf>` : '') +
    `</CdtTrfTxInf></PmtInf></CstmrCdtTrfInitn></Document>`
  );
}
