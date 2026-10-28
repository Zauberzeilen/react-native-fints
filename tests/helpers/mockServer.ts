import { base64Decode, base64Encode } from '../../src/message.js';
import type { FetchFn } from '../../src/types.js';

/**
 * In-memory mock FinTS server for unit tests. Implements the same
 * request/response contract as FinTSTransport (base64 message in,
 * base64 message out) without any network access or real bank data.
 *
 * Vectors are modelled after python-fints test data shapes
 * (HIBPA/HIUPD/HISAL/HIKAZ-MT940/HITAN/HIORD), re-expressed as
 * simplified segments our codec understands.
 */

export const MOCK_MT940 = [
  ':20:STARTUMS',
  ':25:12345678',
  ':28C:1',
  ':60F:C260101EUR1234,56',
  ':61:2601020102C250,00NTRFNONREF',
  ':86:GEHALT JANUAR',
  ':61:2601030103D59,99NTRFNONREF',
  ':86:SUPERMARKT EINKAUF',
  ':62F:C260103EUR1424,57',
  '-',
].join('\n');

export interface MockRoute {
  /** Match when the decoded request contains this substring. */
  contains: string;
  /** Raw response message (segments) to return. */
  response: string;
  times?: number;
}

export class MockFinTSServer {
  readonly requests: string[] = [];
  private routes: MockRoute[] = [];
  private pollsRemaining = 2;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.requests.length = 0;
    this.pollsRemaining = 2;
    this.routes = [
      {
        contains: 'HNHBK:0:0+ANON',
        response: [
          "HNHBK:1:3+000000000001+300+testuser+1+1'",
          "HIRMG:2:2+0020:Dialog ok'",
          "HIBPA:3:3+Mock Bank'",
          'HITANS:4:1+900:chipTAN manuell:6+910:chipTAN optisch:6+920:smstan:6+921:pushTAN:6+930:BestSign:' + "'",
        ].join(''),
      },
      {
        contains: 'HKSPA',
        response: [
          "HNHBK:1:3+000000000002+300+testuser+1+1'",
          "HIRMS:2:2+0020:UPD ok'",
          "HIUPA:3:4+4'",
          'HIUPD:4:4+DE75512108001234567899:12345678:51210800:Girokonto:EUR:HKSAL:1,HKKAZ:1,HKCCS:1' + "'",
          'HIUPD:5:4+DE68210501700012345678:00012345:21050170:Tagesgeld:EUR:HKSAL:1' + "'",
        ].join(''),
      },
      {
        contains: 'HKSAL',
        response: [
          "HNHBK:1:3+000000000003+300+testuser+1+1'",
          "HIRMS:2:2+0020:Balance ok'",
          "HISAL:3:1+EUR:1424,57:2026-01-03'",
        ].join(''),
      },
      {
        contains: 'HKKAZ',
        response: '',
      },
      {
        contains: 'HKCCS',
        response: [
          "HNHBK:1:3+000000000005+300+testuser+1+1'",
          "HIRMS:2:2+0030:Order needs TAN'",
          "HITAN:3:6+TANREF-1:needed:Bitte TAN eingeben:N'",
          "HIORD:4:1+ORD-123'",
        ].join(''),
      },
    ];
    // HKKAZ response carries MT940 inline.
    const mt940Route = this.routes.find((r) => r.contains === 'HKKAZ');
    if (mt940Route) {
      mt940Route.response = [
        "HNHBK:1:3+000000000004+300+testuser+1+1'",
        "HIRMS:2:2+0020:Statements ok'",
        `HIKAZ:3:4+MT940:${MOCK_MT940}'`,
      ].join('');
    }
  }

  /** Fail the next N decoupled polls, then succeed (for pushTAN tests). */
  setDecoupledPollsPending(n: number): void {
    this.pollsRemaining = n;
  }

  addRoute(route: MockRoute): void {
    this.routes.unshift(route);
  }

  readonly fetchFn: FetchFn = async (_url, init) => {
    const request = base64Decode(init.body);
    this.requests.push(request);

    // TAN submit / status routes take precedence over static table.
    if (request.includes('HKTAN')) {
      if (request.includes('+?')) {
        // Decoupled status poll.
        if (this.pollsRemaining > 0) {
          this.pollsRemaining--;
          return ok(base64Encode("HNHBK:1:3+1'HITAN:2:6+TANREF-1:pending:Warten auf Bestaetigung:S'"));
        }
        return ok(base64Encode("HNHBK:1:3+1'HITAN:2:6+TANREF-1:done::N'"));
      }
      if (request.includes('WRONG')) {
        return ok(base64Encode("HNHBK:1:3+1'HIRMS:2:2+9931:Falsche TAN'"));
      }
      return ok(base64Encode("HNHBK:1:3+1'HIRMS:2:2+0020:TAN ok'HITAN:2:6+TANREF-1:done::N'"));
    }

    for (const route of this.routes) {
      if (request.includes(route.contains)) {
        return ok(base64Encode(route.response));
      }
    }
    return ok(base64Encode("HNHBK:1:3+1'HIRMS:2:2+0020:ok'"));
  };
}

function ok(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

export function testClientOptions(fetchFn: FetchFn) {
  return {
    bankUrl: 'https://mock-fints.example/post',
    bankCode: '51210800',
    userId: 'testuser',
    fetchFn,
    decoupledPollIntervalMs: 1,
    decoupledMaxPolls: 5,
  };
}
