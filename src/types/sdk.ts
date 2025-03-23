import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

export interface DepositBaseResult {
  quote: BN;
  lpToken: BN;
  maxBase: BN;
  maxQuote: BN;
}

export interface DepositQuoteAndLpTokenFromBaseResult {
  quote: BN;
  lpToken: BN;
}

export interface DepositQuoteResult {
  base: BN;
  lpToken: BN;
  maxBase: BN;
  maxQuote: BN;
}

export interface DepositBaseAndLpTokenFromQuoteResult {
  base: BN;
  lpToken: BN;
}

export interface DepositResult {
  token1: BN;
  lpToken: BN;
  maxToken0: BN;
  maxToken1: BN;
}

export interface DepositLpTokenResult {
  maxBase: BN;
  maxQuote: BN;
}

export interface WithdrawResult {
  base: BN;
  quote: BN;
  minBase: BN;
  minQuote: BN;
}

export interface WithdrawAutocompleteResult {
  base: BN;
  quote: BN;
}

export interface BuyBaseInputResult {
  internalQuoteAmount: BN;

  /**
   * The total amount of quote tokens required to buy `base` tokens,
   * including LP fee and protocol fee.
   */
  uiQuote: BN;

  /**
   * The maximum quote tokens that you are willing to pay,
   * given the specified slippage tolerance.
   */
  maxQuote: BN;
}

export interface BuyQuoteInputResult {
  /**
   * The amount of base tokens received after fees.
   */
  base: BN;

  internalQuoteWithoutFees: BN;

  /**
   * The maximum quote tokens that you are willing to pay,
   * given the specified slippage tolerance.
   */
  maxQuote: BN;
}

export interface SellBaseInputResult {
  /**
   * The final amount of quote tokens the user receives (after subtracting LP and protocol fees).
   */
  uiQuote: BN;

  /**
   * The minimum quote tokens the user is willing to receive,
   * given their slippage tolerance.
   */
  minQuote: BN;
  internalQuoteAmountOut: BN;
}

export interface SellQuoteInputResult {
  internalRawQuote: BN;
  base: BN;
  minQuote: BN;
}

export type Direction = "quoteToBase" | "baseToQuote";

export interface Pool {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
}
