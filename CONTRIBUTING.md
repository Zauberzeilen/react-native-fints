# Contributing to react-native-fints

## Setup

```sh
npm install
npm test
```

## Workflow

1. Create `feature/xyz` from `develop`.
2. Write code + unit tests (every public API method needs mock-server tests).
3. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run pack:check`.
4. Rebase onto `develop`, then merge with `git merge --no-ff feature/xyz`.

Commit messages: English, imperative, no ticket IDs.

## Releases

1. `git checkout -b release/vx.y.z develop`, stabilize, bump `version`.
2. Tag `vx.y.z` — `release.yml` builds, tests, publishes to npm with
   provenance, and creates the GitHub Release.
3. Merge the release into `master`, then merge `master` back into `develop`.

## Security rules

- PIN in memory only; never persist or log it.
- No secrets, credentials, or real bank data in the repo or tests.
