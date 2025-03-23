import { BN, Program } from "@coral-xyz/anchor";
import { PumpAmm } from "../types/pump_amm";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { globalConfigPda, lpMintPda, poolPda, PUMP_AMM_PROGRAM_ID } from "./pda";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { depositToken0Internal } from "./deposit";
import { withdrawInternal } from "./withdraw";
import { buyBaseInputInternal, buyQuoteInputInternal } from "./buy";
import { sellBaseInputInternal, sellQuoteInputInternal } from "./sell";
import {
  BuyBaseInputResult,
  BuyQuoteInputResult,
  DepositBaseResult,
  DepositQuoteResult,
  Pool,
  SellBaseInputResult,
  SellQuoteInputResult,
  WithdrawResult,
} from "../types/sdk";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import { getPumpAmmProgram } from "./util";

export class PumpAmmInternalSdk {
  private readonly connection: Connection;
  private readonly program: Program<PumpAmm>;
  private readonly globalConfig: PublicKey;

  constructor(connection: Connection, programId: string = PUMP_AMM_PROGRAM_ID) {
    this.connection = connection;

    this.program = getPumpAmmProgram(connection, programId);

    this.globalConfig = globalConfigPda(this.program.programId)[0];
  }

  programId(): PublicKey {
    return this.program.programId;
  }

  globalConfigKey(): PublicKey {
    return this.globalConfig;
  }

  poolKey(index: number, creator: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
    return poolPda(index, creator, baseMint, quoteMint, this.program.programId);
  }

  lpMintKey(pool: PublicKey): [PublicKey, number] {
    return lpMintPda(pool, this.program.programId);
  }

  fetchGlobalConfigAccount() {
    return this.program.account.globalConfig.fetch(this.globalConfig);
  }

  fetchPool(pool: PublicKey) {
    return this.program.account.pool.fetch(pool);
  }

  async createPoolInstructionsInternal(
    index: number,
    creator: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseIn: BN,
    quoteIn: BN,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const [baseTokenProgram, quoteTokenProgram] = await this.getMintTokenPrograms(baseMint, quoteMint);

    if (userBaseTokenAccount === undefined) {
      userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, creator, true, baseTokenProgram);
    }

    if (userQuoteTokenAccount === undefined) {
      userQuoteTokenAccount = getAssociatedTokenAddressSync(quoteMint, creator, true, quoteTokenProgram);
    }

    return await this.withWsolAccounts(creator, baseMint, userBaseTokenAccount, baseIn, quoteMint, userQuoteTokenAccount, quoteIn, async () => {
      const [pool] = poolPda(index, creator, baseMint, quoteMint, this.program.programId);

      const instructions: TransactionInstruction[] = [];

      const poolBaseTokenAccountPDA = getAssociatedTokenAddressSync(baseMint, pool, true, baseTokenProgram);

      if (!(await this.accountExists(poolBaseTokenAccountPDA))) {
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(creator, poolBaseTokenAccountPDA, pool, baseMint, baseTokenProgram));
      }

      const poolQuoteTokenAccountPDA = getAssociatedTokenAddressSync(quoteMint, pool, true, quoteTokenProgram);

      if (!(await this.accountExists(poolQuoteTokenAccountPDA))) {
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(creator, poolQuoteTokenAccountPDA, pool, quoteMint, quoteTokenProgram));
      }

      instructions.push(
        await this.program.methods
          .createPool(index, baseIn, quoteIn)
          .accountsPartial({
            globalConfig: this.globalConfig,
            baseMint,
            quoteMint,
            creator,
            userBaseTokenAccount,
            userQuoteTokenAccount,
            baseTokenProgram,
            quoteTokenProgram,
          })
          .instruction()
      );

      return instructions;
    });
  }

  async depositInstructionsInternal(
    pool: PublicKey,
    lpToken: BN,
    maxBase: BN,
    maxQuote: BN,
    user: PublicKey,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined,
    userPoolTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const poolData = await this.program.account.pool.fetch(pool);

    const { baseMint, quoteMint, lpMint } = poolData;

    const [baseTokenProgram, quoteTokenProgram] = await this.getMintTokenPrograms(baseMint, quoteMint);

    const liquidityAccounts = await this.liquidityAccounts(
      pool,
      poolData,
      baseTokenProgram,
      quoteTokenProgram,
      user,
      userBaseTokenAccount,
      userQuoteTokenAccount,
      userPoolTokenAccount
    );

    return await this.withWsolAccounts(
      user,
      baseMint,
      liquidityAccounts.userBaseTokenAccount,
      maxBase,
      quoteMint,
      liquidityAccounts.userQuoteTokenAccount,
      maxQuote,
      async () => {
        const instructions: TransactionInstruction[] = [];

        if (!(await this.accountExists(liquidityAccounts.userPoolTokenAccount))) {
          instructions.push(
            createAssociatedTokenAccountIdempotentInstruction(user, liquidityAccounts.userPoolTokenAccount, user, lpMint, TOKEN_2022_PROGRAM_ID)
          );
        }

        instructions.push(await this.program.methods.deposit(lpToken, maxBase, maxQuote).accountsPartial(liquidityAccounts).instruction());

        return instructions;
      }
    );
  }

  private async withWsolAccounts(
    user: PublicKey,
    baseMint: PublicKey,
    userBaseAta: PublicKey,
    baseAmount: BN,
    quoteMint: PublicKey,
    userQuoteAta: PublicKey,
    quoteAmount: BN,
    block: () => Promise<TransactionInstruction[]>
  ) {
    return await this.withWsolAccount(user, baseMint, userBaseAta, baseAmount, () => this.withWsolAccount(user, quoteMint, userQuoteAta, quoteAmount, block));
  }

  private async withWsolAccount(
    user: PublicKey,
    mint: PublicKey,
    ata: PublicKey,
    amount: BN,
    block: () => Promise<TransactionInstruction[]>
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];

    let wsolAccountCreated = false;

    if (mint.equals(NATIVE_MINT)) {
      if (!(await this.accountExists(ata))) {
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(user, ata, user, NATIVE_MINT));
        wsolAccountCreated = true;
      }
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: ata,
          lamports: BigInt(amount.toString()),
        }),
        createSyncNativeInstruction(ata)
      );
    }

    const blockInstructions = await block();
    instructions.push(...blockInstructions);

    if (wsolAccountCreated) {
      instructions.push(createCloseAccountInstruction(ata, user, user, undefined, TOKEN_PROGRAM_ID));
    }

    return instructions;
  }

  private async accountExists(account: PublicKey): Promise<boolean> {
    const accountInfo = await this.connection.getAccountInfo(account);
    return accountInfo !== null && !accountInfo.owner.equals(SYSTEM_PROGRAM_ID);
  }

  async depositBaseInputInternal(pool: PublicKey, base: BN, slippage: number): Promise<DepositBaseResult> {
    const { fetchedPool, poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);

    const { token1, lpToken, maxToken0, maxToken1 } = depositToken0Internal(base, slippage, poolBaseAmount, poolQuoteAmount, fetchedPool.lpSupply);

    return {
      quote: token1,
      lpToken,
      maxBase: maxToken0,
      maxQuote: maxToken1,
    };
  }

  async depositQuoteInputInternal(pool: PublicKey, quote: BN, slippage: number): Promise<DepositQuoteResult> {
    const { fetchedPool, poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);

    const { token1, lpToken, maxToken0, maxToken1 } = depositToken0Internal(quote, slippage, poolQuoteAmount, poolBaseAmount, fetchedPool.lpSupply);

    return {
      base: token1,
      lpToken,
      maxBase: maxToken1,
      maxQuote: maxToken0,
    };
  }

  async withdrawInstructionsInternal(
    pool: PublicKey,
    lpTokenAmountIn: BN,
    minBaseAmountOut: BN,
    minQuoteAmountOut: BN,
    user: PublicKey,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined,
    userPoolTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const poolData = await this.program.account.pool.fetch(pool);

    const { baseMint, quoteMint } = poolData;

    const [baseTokenProgram, quoteTokenProgram] = await this.getMintTokenPrograms(baseMint, quoteMint);

    const liquidityAccounts = await this.liquidityAccounts(
      pool,
      poolData,
      baseTokenProgram,
      quoteTokenProgram,
      user,
      userBaseTokenAccount,
      userQuoteTokenAccount,
      userPoolTokenAccount
    );

    const instructions: TransactionInstruction[] = [];

    let baseWsolAtaCreated = false;

    if (!(await this.accountExists(liquidityAccounts.userBaseTokenAccount))) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(user, liquidityAccounts.userBaseTokenAccount, user, liquidityAccounts.baseMint, baseTokenProgram)
      );

      if (baseMint.equals(NATIVE_MINT)) {
        baseWsolAtaCreated = true;
      }
    }

    let quoteWsolAtaCreated = false;

    if (!(await this.accountExists(liquidityAccounts.userQuoteTokenAccount))) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(user, liquidityAccounts.userQuoteTokenAccount, user, liquidityAccounts.quoteMint, quoteTokenProgram)
      );

      if (quoteMint.equals(NATIVE_MINT)) {
        quoteWsolAtaCreated = true;
      }
    }

    instructions.push(
      await this.program.methods.withdraw(lpTokenAmountIn, minBaseAmountOut, minQuoteAmountOut).accountsPartial(liquidityAccounts).instruction()
    );

    if (baseWsolAtaCreated) {
      instructions.push(createCloseAccountInstruction(liquidityAccounts.userBaseTokenAccount, user, user, undefined, TOKEN_PROGRAM_ID));
    }

    if (quoteWsolAtaCreated) {
      instructions.push(createCloseAccountInstruction(liquidityAccounts.userQuoteTokenAccount, user, user, undefined, TOKEN_PROGRAM_ID));
    }

    return instructions;
  }

  async withdrawInputsInternal(pool: PublicKey, lpAmount: BN, slippage: number): Promise<WithdrawResult> {
    const { fetchedPool, poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);

    return withdrawInternal(lpAmount, slippage, poolBaseAmount, poolQuoteAmount, fetchedPool.lpSupply);
  }

  async getPoolBaseAndQuoteAmounts(pool: PublicKey) {
    const fetchedPool = await this.fetchPool(pool);

    const [baseTokenProgram, quoteTokenProgram] = await this.getMintTokenPrograms(fetchedPool.baseMint, fetchedPool.quoteMint);

    const poolBaseTokenAccount = await getAccount(this.connection, fetchedPool.poolBaseTokenAccount, undefined, baseTokenProgram);

    const poolQuoteTokenAccount = await getAccount(this.connection, fetchedPool.poolQuoteTokenAccount, undefined, quoteTokenProgram);

    const poolBaseAmount = new BN(poolBaseTokenAccount.amount.toString());
    const poolQuoteAmount = new BN(poolQuoteTokenAccount.amount.toString());

    return { fetchedPool, poolBaseAmount, poolQuoteAmount };
  }

  private async liquidityAccounts(
    pool: PublicKey,
    { baseMint, quoteMint, lpMint, poolBaseTokenAccount, poolQuoteTokenAccount }: Pool,
    baseTokenProgram: PublicKey,
    quoteTokenProgram: PublicKey,
    user: PublicKey,
    userBaseTokenAccount: PublicKey | undefined,
    userQuoteTokenAccount: PublicKey | undefined,
    userPoolTokenAccount: PublicKey | undefined
  ) {
    if (userBaseTokenAccount === undefined) {
      userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, user, true, baseTokenProgram);
    }

    if (userQuoteTokenAccount === undefined) {
      userQuoteTokenAccount = getAssociatedTokenAddressSync(quoteMint, user, true, quoteTokenProgram);
    }

    if (userPoolTokenAccount === undefined) {
      userPoolTokenAccount = getAssociatedTokenAddressSync(lpMint, user, true, TOKEN_2022_PROGRAM_ID);
    }

    return {
      pool,
      globalConfig: this.globalConfig,
      user,
      baseMint,
      quoteMint,
      lpMint,
      userBaseTokenAccount,
      userQuoteTokenAccount,
      userPoolTokenAccount,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
    };
  }

  async buyInstructionsInternal(
    pool: PublicKey,
    baseOut: BN,
    maxQuoteIn: BN,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { index, creator, baseMint, quoteMint } = await this.program.account.pool.fetch(pool);

    return await this.buyInstructionsInternalNoPool(
      index,
      creator,
      baseMint,
      quoteMint,
      baseOut,
      maxQuoteIn,
      user,
      protocolFeeRecipient,
      userBaseTokenAccount,
      userQuoteTokenAccount
    );
  }

  async buyInstructionsInternalNoPool(
    index: number,
    creator: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseOut: BN,
    maxQuoteIn: BN,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const [pool] = this.poolKey(index, creator, baseMint, quoteMint);

    const swapAccounts = await this.swapAccounts(pool, baseMint, quoteMint, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);

    return this.withWsolAccount(user, quoteMint, swapAccounts.userQuoteTokenAccount, maxQuoteIn, async () => {
      const instructions: TransactionInstruction[] = [];

      let baseWsolAtaCreated = false;

      if (!(await this.accountExists(swapAccounts.userBaseTokenAccount))) {
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(user, swapAccounts.userBaseTokenAccount, user, swapAccounts.baseMint, swapAccounts.baseTokenProgram)
        );

        if (baseMint.equals(NATIVE_MINT)) {
          baseWsolAtaCreated = true;
        }
      }

      instructions.push(await this.program.methods.buy(baseOut, maxQuoteIn).accountsPartial(swapAccounts).instruction());

      if (baseWsolAtaCreated) {
        instructions.push(createCloseAccountInstruction(swapAccounts.userBaseTokenAccount, user, user, undefined, TOKEN_PROGRAM_ID));
      }

      return instructions;
    });
  }

  async buyBaseInput(
    pool: PublicKey,
    base: BN,
    slippage: number,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { maxQuote } = await this.buyBaseInputInternal(pool, base, slippage);

    return this.buyInstructionsInternal(pool, base, maxQuote, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
  }

  async buyQuoteInput(
    pool: PublicKey,
    quote: BN,
    slippage: number,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { base, maxQuote } = await this.buyQuoteInputInternal(pool, quote, slippage);

    return this.buyInstructionsInternal(pool, base, maxQuote, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
  }

  async buyAutocompleteQuoteFromBase(pool: PublicKey, base: BN, slippage: number): Promise<BN> {
    const { uiQuote } = await this.buyBaseInputInternal(pool, base, slippage);

    return uiQuote;
  }

  async buyAutocompleteBaseFromQuote(pool: PublicKey, quote: BN, slippage: number): Promise<BN> {
    const { base } = await this.buyQuoteInputInternal(pool, quote, slippage);

    return base;
  }

  async buyBaseInputInternal(pool: PublicKey, base: BN, slippage: number): Promise<BuyBaseInputResult> {
    const { poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);
    const globalConfig = await this.fetchGlobalConfigAccount();

    return buyBaseInputInternal(base, slippage, poolBaseAmount, poolQuoteAmount, globalConfig.lpFeeBasisPoints, globalConfig.protocolFeeBasisPoints);
  }

  async buyQuoteInputInternal(pool: PublicKey, quote: BN, slippage: number): Promise<BuyQuoteInputResult> {
    const { poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);

    return this.buyQuoteInputInternalNoPool(quote, slippage, poolBaseAmount, poolQuoteAmount);
  }

  async buyQuoteInputInternalNoPool(quote: BN, slippage: number, poolBaseAmount: BN, poolQuoteAmount: BN): Promise<BuyQuoteInputResult> {
    const globalConfig = await this.fetchGlobalConfigAccount();

    return buyQuoteInputInternal(quote, slippage, poolBaseAmount, poolQuoteAmount, globalConfig.lpFeeBasisPoints, globalConfig.protocolFeeBasisPoints);
  }

  async sellInstructionsInternal(
    pool: PublicKey,
    baseAmountIn: BN,
    minQuoteAmountOut: BN,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { index, creator, baseMint, quoteMint } = await this.program.account.pool.fetch(pool);

    return await this.sellInstructionsInternalNoPool(
      index,
      creator,
      baseMint,
      quoteMint,
      baseAmountIn,
      minQuoteAmountOut,
      user,
      protocolFeeRecipient,
      userBaseTokenAccount,
      userQuoteTokenAccount
    );
  }

  async sellInstructionsInternalNoPool(
    index: number,
    creator: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseAmountIn: BN,
    minQuoteAmountOut: BN,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const [pool] = this.poolKey(index, creator, baseMint, quoteMint);

    const swapAccounts = await this.swapAccounts(pool, baseMint, quoteMint, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);

    return this.withWsolAccount(user, baseMint, swapAccounts.userBaseTokenAccount, baseAmountIn, async () => {
      const instructions: TransactionInstruction[] = [];

      let quoteWsolAtaCreated = false;

      if (!(await this.accountExists(swapAccounts.userQuoteTokenAccount))) {
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            user,
            swapAccounts.userQuoteTokenAccount,
            user,
            swapAccounts.quoteMint,
            swapAccounts.quoteTokenProgram
          )
        );

        if (quoteMint.equals(NATIVE_MINT)) {
          quoteWsolAtaCreated = true;
        }
      }

      instructions.push(await this.program.methods.sell(baseAmountIn, minQuoteAmountOut).accountsPartial(swapAccounts).instruction());

      if (quoteWsolAtaCreated) {
        instructions.push(createCloseAccountInstruction(swapAccounts.userQuoteTokenAccount, user, user, undefined, TOKEN_PROGRAM_ID));
      }

      return instructions;
    });
  }

  async sellBaseInput(
    pool: PublicKey,
    base: BN,
    slippage: number,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { minQuote } = await this.sellBaseInputInternal(pool, base, slippage);

    return this.sellInstructionsInternal(pool, base, minQuote, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
  }

  async sellQuoteInput(
    pool: PublicKey,
    quote: BN,
    slippage: number,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined = undefined,
    userBaseTokenAccount: PublicKey | undefined = undefined,
    userQuoteTokenAccount: PublicKey | undefined = undefined
  ): Promise<TransactionInstruction[]> {
    const { base, minQuote } = await this.sellQuoteInputInternal(pool, quote, slippage);

    return this.sellInstructionsInternal(pool, base, minQuote, user, protocolFeeRecipient, userBaseTokenAccount, userQuoteTokenAccount);
  }

  async sellAutocompleteQuoteFromBase(pool: PublicKey, base: BN, slippage: number): Promise<BN> {
    const { uiQuote } = await this.sellBaseInputInternal(pool, base, slippage);

    return uiQuote;
  }

  async sellAutocompleteBaseFromQuote(pool: PublicKey, quote: BN, slippage: number): Promise<BN> {
    const { base } = await this.sellQuoteInputInternal(pool, quote, slippage);

    return base;
  }

  async sellBaseInputInternal(pool: PublicKey, base: BN, slippage: number): Promise<SellBaseInputResult> {
    const { poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);

    return this.sellBaseInputInternalNoPool(base, slippage, poolBaseAmount, poolQuoteAmount);
  }

  async sellBaseInputInternalNoPool(base: BN, slippage: number, poolBaseAmount: BN, poolQuoteAmount: BN): Promise<SellBaseInputResult> {
    const globalConfig = await this.fetchGlobalConfigAccount();

    return sellBaseInputInternal(base, slippage, poolBaseAmount, poolQuoteAmount, globalConfig.lpFeeBasisPoints, globalConfig.protocolFeeBasisPoints);
  }

  async sellQuoteInputInternal(pool: PublicKey, quote: BN, slippage: number): Promise<SellQuoteInputResult> {
    const { poolBaseAmount, poolQuoteAmount } = await this.getPoolBaseAndQuoteAmounts(pool);
    const globalConfig = await this.fetchGlobalConfigAccount();

    return sellQuoteInputInternal(quote, slippage, poolBaseAmount, poolQuoteAmount, globalConfig.lpFeeBasisPoints, globalConfig.protocolFeeBasisPoints);
  }

  async extendAccount(account: PublicKey, user: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods
      .extendAccount()
      .accountsPartial({
        account,
        user,
      })
      .instruction();
  }

  private async swapAccounts(
    pool: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    user: PublicKey,
    protocolFeeRecipient: PublicKey | undefined,
    userBaseTokenAccount: PublicKey | undefined,
    userQuoteTokenAccount: PublicKey | undefined
  ) {
    if (protocolFeeRecipient === undefined) {
      const { protocolFeeRecipients } = await this.program.account.globalConfig.fetch(this.globalConfig);
      protocolFeeRecipient = protocolFeeRecipients[Math.floor(Math.random() * protocolFeeRecipients.length)];
    }

    const [baseTokenProgram, quoteTokenProgram] = await this.getMintTokenPrograms(baseMint, quoteMint);

    if (userBaseTokenAccount === undefined) {
      userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, user, true, baseTokenProgram);
    }

    if (userQuoteTokenAccount === undefined) {
      userQuoteTokenAccount = getAssociatedTokenAddressSync(quoteMint, user, true, quoteTokenProgram);
    }

    return {
      pool,
      globalConfig: this.globalConfig,
      user,
      baseMint,
      quoteMint,
      userBaseTokenAccount,
      userQuoteTokenAccount,
      poolBaseTokenAccount: getAssociatedTokenAddressSync(baseMint, pool, true, baseTokenProgram),
      poolQuoteTokenAccount: getAssociatedTokenAddressSync(quoteMint, pool, true, quoteTokenProgram),
      protocolFeeRecipient,
      baseTokenProgram,
      quoteTokenProgram,
    };
  }

  private async getMintTokenPrograms(baseMint: PublicKey, quoteMint: PublicKey) {
    const baseMintAccountInfo = await this.connection.getAccountInfo(baseMint);

    if (baseMintAccountInfo === null) {
      throw new Error(`baseMint=${baseMint} not found`);
    }

    const quoteMintAccountInfo = await this.connection.getAccountInfo(quoteMint);

    if (quoteMintAccountInfo === null) {
      throw new Error(`quoteMint=${quoteMint} not found`);
    }

    return [baseMintAccountInfo.owner, quoteMintAccountInfo.owner];
  }
}
