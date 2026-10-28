export class FinTSClientError extends Error {
  readonly code: string;
  readonly retCode?: string;

  constructor(code: string, message: string, retCode?: string) {
    super(message);
    this.name = 'FinTSClientError';
    this.code = code;
    if (retCode !== undefined) this.retCode = retCode;
  }
}

export const ErrorCodes = {
  TransportFailed: 'TRANSPORT_FAILED',
  BankRejected: 'BANK_REJECTED',
  ParseFailed: 'PARSE_FAILED',
  TanRequired: 'TAN_REQUIRED',
  TanFailed: 'TAN_FAILED',
  TanTimeout: 'TAN_TIMEOUT',
  ValidationFailed: 'VALIDATION_FAILED',
  NotSupported: 'NOT_SUPPORTED',
  AuthFailed: 'AUTH_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
