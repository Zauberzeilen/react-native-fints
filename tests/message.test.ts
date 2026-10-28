import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  buildSegment,
  escapeFinTS,
  isSuccessReturnCodes,
  parseMessage,
  parseReturnCodes,
  splitSegments,
  unescapeFinTS,
} from '../src/message.js';

describe('FinTS wire codec', () => {
  it('escapes and unescapes special characters', () => {
    expect(unescapeFinTS(escapeFinTS("a+b:c'd?e@f"))).toBe("a+b:c'd?e@f");
  });

  it('splits segments on unescaped terminators', () => {
    expect(splitSegments("HNHBK:1:3+abc'HIRMS:2:2+0020:ok'")).toHaveLength(2);
    expect(splitSegments("HNHBK:1:3+ab?'c'HIRMS:2:2+x'")).toHaveLength(2);
  });

  it('round-trips a dialog message with return codes', () => {
    const raw = [
      "HNHBK:1:3+000000000001+300+user+1+1'",
      "HIRMS:2:2+0020:Dialog ok+3060:Teilweise ok'",
      "HITANS:3:1+921:pushTAN:6'",
    ].join('');
    const segments = parseMessage(raw);
    expect(segments.map((s) => s.id)).toEqual(['HNHBK', 'HIRMS', 'HITANS']);
    const codes = parseReturnCodes(segments);
    expect(codes.map((c) => c.code)).toEqual(['0020', '3060', '921'].slice(0, 2));
    expect(isSuccessReturnCodes(codes)).toBe(true);
  });

  it('detects error return codes', () => {
    const segments = parseMessage("HIRMS:2:2+9931:Falsche TAN'");
    expect(isSuccessReturnCodes(parseReturnCodes(segments))).toBe(false);
  });

  it('builds segments with escaping', () => {
    expect(buildSegment('HITAN', 2, 6, ['a+b'])).toBe("HITAN:2:6+a?+b'");
  });

  it('base64 round-trips transport payloads', () => {
    const msg = "HNHBK:1:3+abc'HIRMS:2:2+0020:ok'";
    expect(base64Decode(base64Encode(msg))).toBe(msg);
  });
});
