# AGENTS.md — react-native-fints

Working agreement for humans and agents in this repo.

## Git flow (binding)

- No pull requests. Branches: `feature/xyz` from `develop`.
- Merges are semi-linear: rebase the feature branch onto `develop` first,
  then merge with `--no-ff` into `develop`.
- Releases: cut `release/vx.y.z` from `develop` for stabilization, tag
  `vx.y.z`, merge the tag into `master`, then merge `master` back into
  `develop`.
- Commit messages: English, imperative mood, no ticket IDs
  (e.g. `Add decoupled TAN polling`).

## Branch protection without PRs

This repo intentionally has no PR reviews. Protection is enforced via
push rules instead:

- `develop`, `master`, `release/*`: no force-push, no deletion.
  (GitHub → Settings → Rules → Rulesets: one ruleset for
  `develop`/`master`/`release/*` blocking force pushes and deletions;
  CI must be green before merging into them.)
- Tags `v*.*.*` trigger `release.yml` (build + tests + `npm publish`
  with provenance + GitHub Release). Only maintainers push tags.

## Tests

- `npm test` (vitest) must pass; `npm run lint` and `npm run typecheck`
  must be clean; `npm run pack:check` must build.
- Every public `FinTSClient` method has unit tests in `tests/` against
  `tests/helpers/mockServer.ts`. No real bank credentials or customer
  data in tests — mock vectors only (shaped after python-fints data).
- Reference only, do not copy: `lib-fints` (LGPL) is read-only reference;
  this package stays MIT. `fints-lib` (MIT) may inform transfers work.

## Security

- PIN in memory only (`setPin`/`clear`); never persist, log, or include
  in errors. Never commit secrets, credentials, or customer data.
- Do not bypass pre-commit hooks, signing, or CI unless the task
  explicitly documents why.
