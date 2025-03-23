import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { depositLpToken } from "./deposit";
import { DepositBaseAndLpTokenFromQuoteResult, DepositQuoteAndLpTokenFromBaseResult, Direction, WithdrawAutocompleteResult } from "../types/sdk";
import { PumpAmmInternalSdk } from "./pumpAmmInternal";
import { PUMP_AMM_PROGRAM_ID } from "./pda";

export class PumpAmmSdk {
  private readonly pumpAmmInternalSdk: PumpAmmInternalSdk;

  constructor(connection: Connection, programId: string = PUMP_AMM_PROGRAM_ID) {
    this.pumpAmmInternalSdk = new PumpAmmInternalSdk(connection, programId);
  }

  programId(): PublicKey {
    return this.pumpAmmInternalSdk.programId();
  }

  globalConfigKey(): PublicKey {
    return this.pumpAmmInternalSdk.globalConfigKey();
  }

  poolKey(index: number, creator: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
    return this.pumpAmmInternalSdk.poolKey(index, creator, baseMint, quoteMint);
  }

  lpMintKey(pool: PublicKey): [PublicKey, number] {
    return this.pumpAmmInternalSdk.lpMintKey(pool);
  }

  fetchGlobalConfigAccount() {
    return this.pumpAmmInternalSdk.fetchGlobalConfigAccount();
  }

  fetchPool(pool: PublicKey) {
    return this.pumpAmmInternalSdk.fetchPool(pool);
  }

  async createPoolInstructions(
    index: number,
    creator: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseIn: BN,
    quoteIn: BN,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    return this.pumpAmmInternalSdk.createPoolInstructionsInternal(
      index,
      creator,
      baseMint,
      quoteMint,
      baseIn,
      quoteIn,
      userBaseTokenAccount,
      userQuoteTokenAccount
    );
  }

  async createAutocompleteInitialPoolPrice(initialBase: BN, initialQuote: BN): Promise<BN> {
    return initialQuote.div(initialBase);
  }

  async depositInstructions(
    pool: PublicKey,
    lpToken: BN,
    slippage: number,
    user: PublicKey,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined,
    userPoolTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { fetchedPool, poolBaseAmount, poolQuoteAmount } = await this.pumpAmmInternalSdk.getPoolBaseAndQuoteAmounts(pool);

    const { maxBase, maxQuote } = depositLpToken(lpToken, slippage, poolBaseAmount, poolQuoteAmount, fetchedPool.lpSupply);

    return this.pumpAmmInternalSdk.depositInstructionsInternal(
      pool,
      lpToken,
      maxBase,
      maxQuote,
      user,
      userBaseTokenAccount,
      userQuoteTokenAccount,
      userPoolTokenAccount
    );
  }

  async depositAutocompleteQuoteAndLpTokenFromBase(pool: PublicKey, base: BN, slippage: number): Promise<DepositQuoteAndLpTokenFromBaseResult> {
    const { quote, lpToken } = await this.pumpAmmInternalSdk.depositBaseInputInternal(pool, base, slippage);

    return {
      quote,
      lpToken,
    };
  }

  async depositAutocompleteBaseAndLpTokenFromQuote(pool: PublicKey, quote: BN, slippage: number): Promise<DepositBaseAndLpTokenFromQuoteResult> {
    const { base, lpToken } = await this.pumpAmmInternalSdk.depositQuoteInputInternal(pool, quote, slippage);

    return {
      base,
      lpToken,
    };
  }

  async withdrawInstructions(
    pool: PublicKey,
    lpToken: BN,
    slippage: number,
    user: PublicKey,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined,
    userPoolTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { minBase, minQuote } = await this.pumpAmmInternalSdk.withdrawInputsInternal(pool, lpToken, slippage);

    return this.pumpAmmInternalSdk.withdrawInstructionsInternal(
      pool,
      lpToken,
      minBase,
      minQuote,
      user,
      userBaseTokenAccount,
      userQuoteTokenAccount,
      userPoolTokenAccount
    );
  }

  async withdrawAutoCompleteBaseAndQuoteFromLpToken(pool: PublicKey, lpAmount: BN, slippage: number): Promise<WithdrawAutocompleteResult> {
    const { base, quote } = await this.pumpAmmInternalSdk.withdrawInputsInternal(pool, lpAmount, slippage);

    return {
      base,
      quote,
    };
  }

  async swapBaseInstructions(
    pool: PublicKey,
    base: BN,
    slippage: number,
    direction: Direction,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    if (direction == "quoteToBase") {
      return await this.pumpAmmInternalSdk.buyBaseInput(pool, base, slippage, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
    }

    return await this.pumpAmmInternalSdk.sellBaseInput(pool, base, slippage, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
  }

  async swapQuoteInstructions(
    pool: PublicKey,
    quote: BN,
    slippage: number,
    direction: Direction,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    if (direction == "quoteToBase") {
      return await this.pumpAmmInternalSdk.buyQuoteInput(pool, quote, slippage, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
    }

    return await this.pumpAmmInternalSdk.sellQuoteInput(pool, quote, slippage, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
  }

  async swapAutocompleteQuoteFromBase(pool: PublicKey, base: BN, slippage: number, direction: Direction): Promise<BN> {
    if (direction == "quoteToBase") {
      return await this.pumpAmmInternalSdk.buyAutocompleteQuoteFromBase(pool, base, slippage);
    }

    return await this.pumpAmmInternalSdk.sellAutocompleteQuoteFromBase(pool, base, slippage);
  }

  async swapAutocompleteBaseFromQuote(pool: PublicKey, quote: BN, slippage: number, direction: Direction): Promise<BN> {
    if (direction == "quoteToBase") {
      return await this.pumpAmmInternalSdk.buyAutocompleteBaseFromQuote(pool, quote, slippage);
    }

    return await this.pumpAmmInternalSdk.sellAutocompleteBaseFromQuote(pool, quote, slippage);
  }

  async extendAccount(account: PublicKey, user: PublicKey): Promise<TransactionInstruction> {
    return this.pumpAmmInternalSdk.extendAccount(account, user);
  }
}
