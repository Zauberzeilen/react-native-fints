import { beforeEach, describe, expect, it } from 'vitest';
import { FinTSClient } from '../src/client.js';
import { ErrorCodes } from '../src/errors.js';
import { MockFinTSServer, testClientOptions } from './helpers/mockServer.js';

/**
 * Public API coverage: every FinTSClient method is exercised against the
 * mock FinTS server. No real bank data is used anywhere in these tests.
 */
describe('FinTSClient public API', () => {
  let server: MockFinTSServer;
  let client: FinTSClient;

  beforeEach(() => {
    server = new MockFinTSServer();
    client = new FinTSClient(testClientOptions(server.fetchFn));
    client.setPin('12345');
  });

  it('getBPD returns bank parameters and caches them', async () => {
    const bpd = await client.getBPD();
    expect(bpd.bankName).toBe('Mock Bank');
    expect(bpd.supportedTanMethods.length).toBeGreaterThanOrEqual(4);
    const again = await client.getBPD();
    expect(again).toBe(bpd);
    expect(server.requests.filter((r) => r.includes('ANON'))).toHaveLength(1);
  });

  it('getTanMethods / getTanMethod expose TAN methods', async () => {
    const methods = await client.getTanMethods();
    expect(methods.map((m) => m.id)).toContain('921');
    expect(client.getTanMethod()?.id).toBe('900');
  });

  it('usesDecoupledTan reflects the selected method', async () => {
    await client.getBPD();
    expect(client.usesDecoupledTan()).toBe(false);
    const pushClient = new FinTSClient({ ...testClientOptions(server.fetchFn), tanMethodId: '921' });
    pushClient.setPin('12345');
    await pushClient.getBPD();
    expect(pushClient.usesDecoupledTan()).toBe(true);
  });

  it('getUPD / getAccounts return accounts', async () => {
    const upd = await client.getUPD();
    expect(upd.accounts).toHaveLength(2);
    const accounts = await client.getAccounts();
    expect(accounts[0]?.iban).toBe('DE75512108001234567899');
  });

  it('getBalance returns the booked balance', async () => {
    const [account] = await client.getAccounts();
    const balance = await client.getBalance(account!);
    expect(balance).toMatchObject({ amount: 1424.57, currency: 'EUR', date: '2026-01-03' });
  });

  it('getTransactions returns MT940 bookings for a range', async () => {
    const [account] = await client.getAccounts();
    const txs = await client.getTransactions(account!, { from: '2026-01-01', to: '2026-01-03' });
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({ credit: true, amount: 250 });
    expect(txs[1]).toMatchObject({ credit: false, amount: 59.99 });
  });

  it('getTransactions validates the date range', async () => {
    const [account] = await client.getAccounts();
    await expect(client.getTransactions(account!, { from: 'bad', to: '2026-01-03' })).rejects.toMatchObject({
      code: ErrorCodes.ValidationFailed,
    });
  });

  it('initiateTan returns the bank challenge', async () => {
    const challenge = await client.initiateTan('HKCCS:0:0+order');
    expect(challenge).toMatchObject({ reference: 'TANREF-1', status: 'needed' });
  });

  it('submitTan accepts a correct TAN and rejects a wrong one', async () => {
    await client.submitTan('TANREF-1', '123456');
    await expect(client.submitTan('TANREF-1', 'WRONG')).rejects.toMatchObject({
      code: ErrorCodes.TanFailed,
    });
  });

  it('pollDecoupledTan resolves after in-app confirmation', async () => {
    server.setDecoupledPollsPending(2);
    await client.pollDecoupledTan('TANREF-1');
    expect(server.requests.filter((r) => r.includes('HKTAN')).length).toBeGreaterThanOrEqual(3);
  });

  it('pollDecoupledTan times out when nobody confirms', async () => {
    server.setDecoupledPollsPending(99);
    await expect(client.pollDecoupledTan('TANREF-1')).rejects.toMatchObject({
      code: ErrorCodes.TanTimeout,
    });
  });

  it('buildTransfer validates without network access', () => {
    const result = client.buildTransfer({
      fromIban: 'DE75512108001234567899',
      toIban: 'DE68210501700012345678',
      recipientName: 'Max Mustermann',
      amount: 10,
    });
    expect(result.pain001).toContain('pain.001.001.03');
    expect(server.requests).toHaveLength(0);
  });

  it('submitTransfer returns a TAN challenge for two-step orders', async () => {
    const result = await client.submitTransfer({
      fromIban: 'DE75512108001234567899',
      toIban: 'DE68210501700012345678',
      recipientName: 'Max Mustermann',
      amount: 10,
      purpose: 'Test',
    });
    expect(result.orderReference).toBe('ORD-123');
    expect(result.tanChallenge?.reference).toBe('TANREF-1');
  });

  it('requires a PIN for protected methods and clear() wipes it', async () => {
    const naked = new FinTSClient(testClientOptions(server.fetchFn));
    await expect(naked.getUPD()).rejects.toMatchObject({ code: ErrorCodes.AuthFailed });
    client.clear();
    expect(client.cachedUpd).toBeUndefined();
    await expect(client.getBalance({ iban: 'x' } as never)).rejects.toMatchObject({
      code: ErrorCodes.AuthFailed,
    });
  });

  it('surfaces fatal bank rejections as BANK_REJECTED', async () => {
    server.addRoute({
      contains: 'HKSPA',
      response: "HNHBK:1:3+1'HIRMS:2:2+9010:Dialog abgebrochen'",
    });
    await expect(client.getUPD()).rejects.toMatchObject({ code: ErrorCodes.BankRejected });
  });
});
