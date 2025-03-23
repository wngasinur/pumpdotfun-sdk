import BN from "bn.js";
import { DepositLpTokenResult, DepositResult } from "../types/sdk";

export function depositToken0Internal(token0: BN, slippage: number, token0Reserve: BN, token1Reserve: BN, totalLpTokens: BN): DepositResult {
  if (slippage < 0 || slippage > 100) {
    throw new Error("Slippage must be between 0 and 100 (0% to 100%)");
  }

  // Calculate the corresponding output amount based on the pool's reserves
  const token1 = token0.mul(token1Reserve).div(token0Reserve);

  // Apply slippage tolerance
  const slippageFactor = new BN((1 + slippage / 100) * 1_000_000_000);
  const maxToken0 = token0.mul(slippageFactor).div(new BN(1_000_000_000));
  const maxToken1 = token1.mul(slippageFactor).div(new BN(1_000_000_000));

  // Calculate the LP tokens to mint, proportional to the deposit amount
  const lpToken = token0.mul(totalLpTokens).div(token0Reserve);

  return {
    token1,
    lpToken,
    maxToken0,
    maxToken1,
  };
}

function ceilDiv(numerator: BN, denominator: BN): BN {
  return numerator.add(denominator).sub(new BN(1)).div(denominator);
}

export function depositLpToken(lpToken: BN, slippage: number, baseReserve: BN, quoteReserve: BN, totalLpTokens: BN): DepositLpTokenResult {
  if (totalLpTokens.isZero()) {
    throw new Error("Division by zero: totalLpTokens cannot be zero");
  }

  const baseAmountIn = ceilDiv(baseReserve.mul(lpToken), totalLpTokens);
  const quoteAmountIn = ceilDiv(quoteReserve.mul(lpToken), totalLpTokens);

  const slippageFactor = new BN((1 + slippage / 100) * 1_000_000_000);
  const slippageDenominator = new BN(1_000_000_000);

  const maxBase = baseAmountIn.mul(slippageFactor).div(slippageDenominator);
  const maxQuote = quoteAmountIn.mul(slippageFactor).div(slippageDenominator);

  return {
    maxBase,
    maxQuote,
  };
}
