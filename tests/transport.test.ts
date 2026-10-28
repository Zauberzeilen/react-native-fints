import { describe, expect, it } from 'vitest';
import { FinTSTransport } from '../src/transport.js';
import { base64Decode, base64Encode } from '../src/message.js';
import { ErrorCodes } from '../src/errors.js';

describe('FinTSTransport', () => {
  it('posts base64 payloads via the injected fetch', async () => {
    const calls: unknown[] = [];
    const transport = new FinTSTransport('https://bank.example/post', (async (url, init) => {
      calls.push([url, init]);
      return { ok: true, status: 200, text: async () => base64Encode("HIRMS:2:2+0020:ok'") };
    }));
    const res = await transport.post(base64Encode('hello'));
    expect(calls).toHaveLength(1);
    expect(base64Decode(res)).toContain('0020');
  });

  it('wraps network failures in TRANSPORT_FAILED', async () => {
    const transport = new FinTSTransport('https://bank.example/post', (async () => {
      throw new Error('down');
    }));
    await expect(transport.post('x')).rejects.toMatchObject({ code: ErrorCodes.TransportFailed });
  });

  it('rejects non-2xx responses', async () => {
    const transport = new FinTSTransport('https://bank.example/post', (async () => ({
      ok: false,
      status: 500,
      text: async () => 'err',
    })));
    await expect(transport.post('x')).rejects.toMatchObject({ code: ErrorCodes.TransportFailed });
  });
});
