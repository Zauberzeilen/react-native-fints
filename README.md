# react-native-fints

Pure TypeScript FinTS client for React Native (Hermes) and modern JS runtimes.
Zero runtime dependencies. Local-first: the app talks directly to the bank's
FinTS endpoint — there is no Zauberzeilen server in between.

> **DK registration note:** FinTS access requires a bank-side registration /
> Freischaltung for PIN/TAN (or a DK contract for corporate customers). Use
> the bank's PIN/TAN URL ("FinTS-URL") in the app settings. Without
> registration the bank answers with return code `9010/9933` — the client
> surfaces these as `BANK_REJECTED` errors.

## Install

```sh
npm install react-native-fints
```

Requires React Native >= 0.72 for mobile use; the core also runs on plain
Node 18+ and in browsers (it only needs a `fetch` implementation).

## Usage

```ts
import { FinTSClient } from 'react-native-fints';

const client = new FinTSClient({
  bankUrl: 'https://fints.bank.example/post',
  bankCode: '51210800',
  userId: 'mein-login',
  tanMethodId: '921', // optional: pushTAN / decoupled
});

client.setPin(pinFromSecureInput); // memory only, never persisted
const accounts = await client.getAccounts();
const balance = await client.getBalance(accounts[0]!);
const txs = await client.getTransactions(accounts[0]!, { from: '2026-01-01', to: '2026-01-31' });

// TAN order with decoupled/push confirmation:
const challenge = await client.initiateTan('HKCCS...');
if (challenge.status === 'decoupled_pending') {
  await client.pollDecoupledTan(challenge.reference); // user confirms in bank app
} else if (challenge.status === 'needed') {
  await client.submitTan(challenge.reference, tanFromUser);
}
client.clear(); // wipe PIN from memory on logout
```

## Security

- The PIN lives only in memory (`setPin` / `clear`). It is never written to
  disk, AsyncStorage, logs, or error messages.
- No secrets in the repo. Tests use a mock FinTS server only.
- Transports are injectable (`fetchFn`) so apps can pin certificates or route
  through their own networking stack.

## API

- `getBPD()` — bank parameters + TAN methods (cached)
- `getUPD()` / `getAccounts()` — user parameters / accounts
- `getBalance(account)` — booked balance (HKSAL)
- `getTransactions(account, { from, to })` — MT940 bookings (HKKAZ)
- `getTanMethods()` / `getTanMethod()` / `usesDecoupledTan()`
- `initiateTan(order)` / `submitTan(ref, tan)` / `pollDecoupledTan(ref)`
- `buildTransfer(input)` (offline validation + pain.001) / `submitTransfer(input)` (HKCCS)

See `example/` for a minimal Expo app used for manual testing.
