import { BN } from "@coral-xyz/anchor";
import { ceilDiv, fee } from "./sdk/util";

export function getPumpSwapBuyPrices(
  quote: BN,
  slippage: number, // 1 => 1%
  baseReserve: BN,
  quoteReserve: BN,
  lpFeeBps: BN, // LP fee in basis points (BN)
  protocolFeeBps: BN //): bigint[] {
) {
  console.log("poolBaseAmount", baseReserve.toString());
  console.log("poolQuoteAmount", quoteReserve.toString());
  console.log("base", quote.toString());
  console.log("lpFeeBps", lpFeeBps.toString());
  console.log("protocolFeeBps", protocolFeeBps.toString());
  if (quote.isZero()) {
    throw new Error("Invalid input: 'quote' cannot be zero.");
  }
  if (baseReserve.isZero() || quoteReserve.isZero()) {
    throw new Error("Invalid input: 'baseReserve' or 'quoteReserve' cannot be zero.");
  }
  if (lpFeeBps.isNeg() || protocolFeeBps.isNeg()) {
    throw new Error("Fee basis points cannot be negative.");
  }

  // -----------------------------------------------------
  // 2) Calculate total fee basis points and denominator
  // -----------------------------------------------------
  const totalFeeBps = lpFeeBps.add(protocolFeeBps);
  const denominator = new BN(10_000).add(totalFeeBps);

  // -----------------------------------------------------
  // 3) Calculate effective quote amount
  // -----------------------------------------------------
  const effectiveQuote = quote.mul(new BN(10_000)).div(denominator);

  // -----------------------------------------------------
  // 4) Calculate the base tokens received using effectiveQuote
  //    base_amount_out = floor(base_reserve * effectiveQuote / (quote_reserve + effectiveQuote))
  // -----------------------------------------------------
  const numerator = baseReserve.mul(effectiveQuote);
  const denominatorEffective = quoteReserve.add(effectiveQuote);

  if (denominatorEffective.isZero()) {
    throw new Error("Pool would be depleted; denominator is zero.");
  }

  const baseAmountOut = numerator.div(denominatorEffective);

  // -----------------------------------------------------
  // 5) Calculate maxQuote with slippage
  //    If slippage=1 => factor = (1 + 1/100) = 1.01
  // -----------------------------------------------------
  const precision = new BN(1_000_000_000); // For slippage calculations
  const slippageFactorFloat = (1 + slippage / 100) * 1_000_000_000;
  const slippageFactor = new BN(Math.floor(slippageFactorFloat));

  // maxQuote = quote * slippageFactor / 1e9
  const maxQuote = quote.mul(slippageFactor).div(precision);

  return {
    maxQuote,
    baseAmountOut,
  };
}
