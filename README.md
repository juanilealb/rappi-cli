# rappi-cli

Restaurant-only automation CLI for https://www.rappi.com.ar with strict safety controls.

## Scope and hard constraints

- Restaurants only. Non-restaurant verticals (supermarket, pharmacy, etc.) are blocked.
- Real purchases are permanently disabled by policy in this MVP.
- Payment flow is disabled by default and guarded by:
  1. explicit `--confirm-pay`
  2. second interactive confirmation (`y/N` + typed `CONFIRM PAY`)
- Login uses manual browser bootstrap (Google + possible OTP). No credentials are hardcoded.

## Tech choices

- Node.js (ESM)
- Playwright loaded dynamically for browser commands
- Dependency-light CLI parser and YAML subset parser for portability

## Project structure

```text
bin/
  rappi-cli.mjs
src/
  cli/
    main.mjs
    args.mjs
    commands.mjs
    help.mjs
  rappi/
    browser.mjs
    checkout.mjs
    dom-utils.mjs
    login.mjs
    menu.mjs
    playwright-loader.mjs
    policy.mjs
    restaurants.mjs
  order/
    cart-builder.mjs
    parse.mjs
  utils/
    env.mjs
    fs.mjs
scripts/
  lint.mjs
  smoke.mjs
test/
  cart-builder.test.mjs
  order-parse.test.mjs
  policy.test.mjs
examples/
  orders/
  templates/
  output/
```

## Setup

```bash
cp .env.example .env
npm install
```

`playwright` is optional dependency but required for browser-backed commands (`login`, `restaurants`, `menu`, live menu fetch during `cart build`).

## Manual login bootstrap (Google + OTP)

```bash
node bin/rappi-cli.mjs login bootstrap --session-file ~/.config/rappi-cli/session-state.json
```

Flow:
1. Browser opens `rappi.com.ar`.
2. Complete Google login.
3. Complete OTP challenge if requested.
4. Return to terminal and press ENTER.
5. Session state is saved with restrictive local file permissions (best effort `0600`).

## Commands

### 1) Restaurants search/list with filters

```bash
node bin/rappi-cli.mjs restaurants search --query "pizza" --city "Buenos Aires" --max 15 --min-rating 4 --delivery-fee-max 1800 --json
```

### 2) Menu fetch by restaurant

```bash
node bin/rappi-cli.mjs menu fetch --restaurant-url "https://www.rappi.com.ar/restaurantes/pizzeria-demo" --out examples/output/menu-live.json --json
```

### 3) Cart build from YAML/JSON items

Using existing menu JSON:

```bash
node bin/rappi-cli.mjs cart build --order-file examples/orders/pizza-night.yaml --menu-file examples/output/menu-sample.json --out examples/output/cart.json
```

Or live menu (requires `restaurantUrl` in order file):

```bash
node bin/rappi-cli.mjs cart build --order-file examples/orders/pizza-night.yaml --out examples/output/cart-live.json
```

### 4) Checkout dry-run summary

```bash
node bin/rappi-cli.mjs checkout dry-run --cart-file examples/output/cart.json
```

Attempt payment pre-check (still never buys):

```bash
node bin/rappi-cli.mjs checkout dry-run --cart-file examples/output/cart.json --confirm-pay
```

### 5) Reorder from saved template

```bash
node bin/rappi-cli.mjs reorder --template examples/templates/pizza-night.yaml --menu-file examples/output/menu-sample.json --out examples/output/reorder-cart.json
```

## Security notes

- Session file contains live auth tokens. Treat it as a secret.
- Session directory and file are written with restrictive permissions (`0700` dir, `0600` file) when supported.
- No passwords, OTP codes, or card data are stored in source code.
- Real purchase call path is blocked by `REAL_PURCHASES_DISABLED = true` in `src/rappi/policy.mjs`.
- Payment confirmation intentionally requires two user confirmations when `--confirm-pay` is present.

## Selector drift and anti-bot caveats

- Rappi UI selectors can change. Current extraction uses fallback CSS patterns + text heuristics.
- If command output degrades:
  - update selectors in `src/rappi/restaurants.mjs` and `src/rappi/menu.mjs`
  - favor semantic anchors (`href` patterns, headings) over brittle class names
- Anti-bot protections may throttle or challenge automated sessions:
  - keep `headless=false` for troubleshooting
  - use moderate timing via `--slowmo`
  - re-bootstrap login session when session expires

## Quality checks

```bash
npm run lint
npm test
npm run smoke
npm run check
```

## BLOCKER (GitHub creation/push)

Status: blocked in this environment (2026-02-21).

Observed failures:

```bash
gh auth status
# token in ~/.config/gh/hosts.yml is invalid for account juanilealb
```

```bash
gh repo create Juanilealb/rappi-cli --public --source=. --remote=origin --push
# error connecting to api.github.com
```

If auth blocks creation, run:

```bash
gh auth login
gh repo create Juanilealb/rappi-cli --public --source=. --remote=origin --push
git push -u origin main
```

## License

MIT
