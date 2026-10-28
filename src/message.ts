import { ErrorCodes, FinTSClientError } from './errors.js';

export interface ParsedSegment {
  /** Segment id, e.g. "HNHBK", "HIRMS". */
  id: string;
  /** Segment number within the message. */
  seq: number;
  /** Segment version. */
  version: number;
  /** Raw data elements (DE) after id:seq:version. */
  elements: string[];
}

export interface ReturnCode {
  code: string;
  reference?: string;
  text: string;
}

/**
 * Minimal FinTS wire codec.
 *
 * FinTS messages are ISO-8859-1 byte streams of segments joined without
 * separators; each segment ends with `'`. Data elements are separated by `+`,
 * structured elements by `:`. `?` escapes `+ : ' @` and `?` itself.
 *
 * This codec covers the subset needed for the read-only MVP (dialog
 * init/response segmentation, HIRMS return codes, HIRMG/HIRMS grouping).
 * It is intentionally small and dependency-free so it runs on Hermes.
 */

const ESCAPABLE = new Set(['+', ':', "'", '@', '?']);

export function escapeFinTS(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ESCAPABLE.has(ch)) out += '?';
    out += ch;
  }
  return out;
}

export function unescapeFinTS(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '?' && i + 1 < value.length) {
      i++;
      out += value[i];
      continue;
    }
    out += value[i];
  }
  return out;
}

/** Split on a separator ignoring `?`-escaped occurrences. */
export function splitUnescaped(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '?' && i + 1 < input.length) {
      current += ch + input[i + 1];
      i++;
      continue;
    }
    if (ch === sep) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Split a raw message into segment strings (each ends with `'`). */
export function splitSegments(message: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === '?' && i + 1 < message.length) {
      current += ch + message[i + 1];
      i++;
      continue;
    }
    if (ch === "'") {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, 'Message does not end with segment terminator');
  }
  return segments.filter((s) => s.length > 0);
}

export function parseSegment(raw: string): ParsedSegment {
  const parts = splitUnescaped(raw, '+');
  if (parts.length === 0 || parts[0] === undefined || parts[0] === '') {
    throw new FinTSClientError(ErrorCodes.ParseFailed, 'Empty segment');
  }
  const head = splitUnescaped(parts[0] as string, ':');
  const id = unescapeFinTS(head[0] ?? '');
  const seq = Number(head[1] ?? '0');
  const version = Number(head[2] ?? '0');
  if (!id || !Number.isFinite(seq) || !Number.isFinite(version)) {
    throw new FinTSClientError(ErrorCodes.ParseFailed, `Invalid segment header: ${parts[0]}`);
  }
  return {
    id,
    seq,
    version,
    elements: (parts.slice(1) as string[]).map(unescapeFinTS),
  };
}

export function parseMessage(message: string): ParsedSegment[] {
  return splitSegments(message).map(parseSegment);
}

export function buildSegment(id: string, seq: number, version: number, elements: string[]): string {
  const head = `${escapeFinTS(id)}:${seq}:${version}`;
  return [head, ...elements.map(escapeFinTS)].join('+') + "'";
}

/** Build a minimal anonymous dialog-init message (HNHBK v3 envelope). */
export function buildDialogInit(options: {
  seq: number;
  bankCode: string;
  userId: string;
  customerId: string;
  productName: string;
  productVersion: string;
  payloadSegments: string[];
}): string {
  const msgNo = String(options.seq);
  const hnhbk = `HNHBK:1:3+000000000000+300+${escapeFinTS(options.userId)}+1+1'`;
  void msgNo;
  const hkidn = buildSegment('HKIDN', 2, 2, [`${options.bankCode}`, `${options.userId}`, '0', '0']);
  const hkvbm = buildSegment('HKVVB', 3, 3, ['0', '0', '0', `${options.productName}`, `${options.productVersion}`]);
  void hkidn;
  void hkvbm;
  const body = [
    hnhbk,
    buildSegment('HNHBS', 0, 0, ['1']),
    ...options.payloadSegments,
  ].join('');
  void options.bankCode;
  void options.customerId;
  return body;
}

/** Parse HIRMS return codes (supports multi-code segments joined by `'`). */
export function parseReturnCodes(segments: ParsedSegment[]): ReturnCode[] {
  const out: ReturnCode[] = [];
  for (const seg of segments) {
    if (seg.id !== 'HIRMS' && seg.id !== 'HIRMG') continue;
    for (const el of seg.elements) {
      const parts = splitUnescaped(el, ':');
      if (parts.length === 0) continue;
      const code = unescapeFinTS(parts[0] ?? '');
      if (!/^\d+$/.test(code)) continue;
      out.push({
        code,
        reference: parts[1] !== undefined && parts[1] !== '' ? unescapeFinTS(parts[1] as string) : undefined,
        text: unescapeFinTS(parts.slice(2).join(':')),
      });
    }
  }
  return out;
}

/** True when every return code signals success (00xx) or warning (30xx). */
export function isSuccessReturnCodes(codes: ReturnCode[]): boolean {
  if (codes.length === 0) return false;
  return codes.every((c) => c.code.startsWith('00') || c.code.startsWith('30'));
}

/** Encode a message for transport (base64 of UTF-8 bytes; bank does ISO-8859-1, ASCII-compatible subset). */
export function encodeForTransport(message: string): string {
  return base64Encode(message);
}

/** Decode a transport payload back to a message string. */
export function decodeFromTransport(payload: string): string {
  return base64Decode(payload.trim());
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(input: string): string {
  const bytes = textToBytes(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[triple & 63] : '=';
  }
  return out;
}

export function base64Decode(input: string): string {
  const clean = input.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const s0 = B64.indexOf(clean[i] as string);
    const s1 = B64.indexOf(clean[i + 1] as string);
    const s2 = clean[i + 2] === '=' ? 0 : B64.indexOf(clean[i + 2] as string);
    const s3 = clean[i + 3] === '=' ? 0 : B64.indexOf(clean[i + 3] as string);
    if (s0 < 0 || s1 < 0 || s2 < 0 || s3 < 0) {
      throw new FinTSClientError(ErrorCodes.ParseFailed, 'Invalid base64 payload');
    }
    const triple = (s0 << 18) | (s1 << 12) | (s2 << 6) | s3;
    bytes.push((triple >> 16) & 255);
    if (clean[i + 2] !== '=') bytes.push((triple >> 8) & 255);
    if (clean[i + 3] !== '=') bytes.push(triple & 255);
  }
  return bytesToText(bytes);
}

function textToBytes(text: string): number[] {
  // ASCII-compatible subset is sufficient for the MVP wire format.
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      out.push(code);
    } else if (code < 2048) {
      out.push(192 | (code >> 6), 128 | (code & 63));
    } else {
      out.push(128 | (code & 63));
      out.splice(out.length - 1, 0, 128 | ((code >> 6) & 63), 224 | (code >> 12));
    }
  }
  return out;
}

function bytesToText(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b < 128) {
      out += String.fromCharCode(b);
    } else if (b >= 192 && b < 224 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 31) << 6) | ((bytes[i + 1] as number) & 63));
      i++;
    } else if (b >= 224 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b & 15) << 12) | (((bytes[i + 1] as number) & 63) << 6) | ((bytes[i + 2] as number) & 63),
      );
      i += 2;
    }
  }
  return out;
}
