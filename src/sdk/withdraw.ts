import BN from "bn.js";
import { WithdrawResult } from "../types/sdk";

export function withdrawInternal(
  lpAmount: BN,
  slippage: number,
  baseReserve: BN,
  quoteReserve: BN,
  totalLpTokens: BN,
): WithdrawResult {
  if (lpAmount.isZero() || totalLpTokens.isZero()) {
    throw new Error("LP amount or total LP tokens cannot be zero.");
  }

  // Calculate the base and quote amounts
  const base = baseReserve.mul(lpAmount).div(totalLpTokens);
  const quote = quoteReserve.mul(lpAmount).div(totalLpTokens);

  // Calculate the minimum amounts considering slippage
  const scaleFactor = new BN(1_000_000_000);
  const slippageFactor = new BN((1 - slippage / 100) * 1_000_000_000);
  const minBase = base.mul(slippageFactor).div(scaleFactor);
  const minQuote = quote.mul(slippageFactor).div(scaleFactor);

  return {
    base,
    quote,
    minBase,
    minQuote,
  };
}
