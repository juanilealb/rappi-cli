export function printHelp() {
  console.log(`rappi-cli - Restaurant-only automation helper for rappi.com.ar\n
Usage:
  rappi-cli login bootstrap [--session-file path] [--headless false]
  rappi-cli restaurants search --query "pizza" [--max 20] [--min-rating 4] [--delivery-fee-max 1500] [--json]
  rappi-cli menu fetch --restaurant-url "https://www.rappi.com.ar/restaurantes/..." [--json]
  rappi-cli cart build --order-file examples/orders/pizza-night.yaml [--menu-file examples/output/menu.json] [--out examples/output/cart.json]
  rappi-cli checkout dry-run --cart-file examples/output/cart.json [--confirm-pay]
  rappi-cli flow callback --data "rappi:menu:start" [--state-file ~/.config/rappi-cli/flow-state.json] [--restaurant-url https://www.rappi.com.ar/restaurantes/215137-guber] [--headless false] [--json]
  rappi-cli reorder --template examples/templates/pizza-night.yaml [--menu-file examples/output/menu.json] [--out examples/output/reorder-cart.json]

Key safety constraints:
  - Restaurant flows only.
  - Real purchases are disabled by default.
  - Live callback payment click is only attempted when RAPPI_LIVE_ORDER_ENABLED=true
    and callback flow reaches rappi:confirm:pay after rappi:confirm:checkout.
  - Payment flow requires --confirm-pay plus a second interactive confirmation,
    but still never submits a purchase action.
`);
}
