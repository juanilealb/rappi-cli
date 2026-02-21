import { ask, confirm } from '../utils/prompt.mjs';
import { REAL_PURCHASES_DISABLED } from './policy.mjs';

export function buildDryRunSummary(cart) {
  const lines = Array.isArray(cart?.matchedItems) ? cart.matchedItems : [];
  const subtotal = lines.reduce((acc, line) => acc + Number(line.lineSubtotal || 0), 0);

  return {
    items: lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.lineSubtotal
    })),
    unresolvedItems: cart.unresolvedItems || [],
    currency: cart.currency || 'ARS',
    totals: {
      subtotal,
      estimatedFees: cart?.totals?.estimatedFees ?? null,
      grandTotal: cart?.totals?.grandTotal ?? subtotal
    },
    safeMode: {
      realPurchaseDisabled: REAL_PURCHASES_DISABLED,
      requiresConfirmPayFlag: true,
      requiresSecondInteractiveConfirmation: true
    }
  };
}

export async function guardPaymentExecution(confirmPayFlag) {
  if (!confirmPayFlag) {
    return {
      attempted: false,
      permitted: false,
      message: 'Payment flow not attempted. Add --confirm-pay and pass second confirmation to continue to pre-payment review only.'
    };
  }

  const firstConfirm = await confirm('You passed --confirm-pay. Continue to payment pre-check simulation?');
  if (!firstConfirm) {
    return {
      attempted: false,
      permitted: false,
      message: 'User cancelled before second confirmation.'
    };
  }

  const typed = await ask('Type "CONFIRM PAY" to continue: ');
  if (typed !== 'CONFIRM PAY') {
    return {
      attempted: false,
      permitted: false,
      message: 'Second confirmation phrase mismatch; payment flow remains blocked.'
    };
  }

  if (REAL_PURCHASES_DISABLED) {
    return {
      attempted: true,
      permitted: false,
      message: 'Real purchase submission is permanently disabled by policy. Simulation stopped before any buy action.'
    };
  }

  return {
    attempted: true,
    permitted: true,
    message: 'Payment execution permitted.'
  };
}
