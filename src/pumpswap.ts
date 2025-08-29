import { Commitment, Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { BN, Program, Provider } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  NATIVE_MINT,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PumpSwap, IDL_SWAP } from "./IDL/index";
import { DEFAULT_COMMITMENT } from "./util";
import { globalConfigPda, PumpSwapPool } from "./poolswap";
import { poolPda } from "./sdk/pda";

// Define static public keys
const TOKEN_PROGRAM_ID: PublicKey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WSOL_TOKEN_ACCOUNT: PublicKey = new PublicKey("So11111111111111111111111111111111111111112");
const feeRecipient = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
export interface SwapParams {
  poolId: PublicKey;
  user: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  protocolFeeRecipient: PublicKey;
}
export class PumpSwapSDK {
  public program: Program<PumpSwap>;
  public connection: Connection;
  public pumpSwapPool: PumpSwapPool;

  constructor(provider?: Provider) {
    this.program = new Program<PumpSwap>(IDL_SWAP as PumpSwap, provider);
    this.connection = this.program.provider.connection;
    this.pumpSwapPool = new PumpSwapPool(provider);
  }

  poolKey(index: number, creator: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
    return poolPda(index, creator, baseMint, quoteMint, this.program.programId);
  }

  private async swapAccounts(
    pool: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    user: PublicKey,
    globalConfig: PublicKey,
    protocolFeeRecipient: PublicKey,
    userBaseTokenAccount: PublicKey | undefined,
    userQuoteTokenAccount: PublicKey | undefined
  ) {
    // const [baseTokenProgram, quoteTokenProgram] = await this.getMintTokenPrograms(baseMint, quoteMint);

    const baseTokenProgram = TOKEN_PROGRAM_ID;
    const quoteTokenProgram = TOKEN_PROGRAM_ID;

    if (userBaseTokenAccount === undefined) {
      userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, user, true, baseTokenProgram);
    }

    if (userQuoteTokenAccount === undefined) {
      userQuoteTokenAccount = getAssociatedTokenAddressSync(quoteMint, user, true, quoteTokenProgram);
    }

    return {
      pool,
      globalConfig: globalConfig,
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

  async createBuyInstruction(
    poolId: PublicKey,
    user: PublicKey,
    mint: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    // Compute associated token account addresses
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);
    const userQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, user);

    const { index, creator, baseMint, quoteMint } = await this.program.account.pool.fetch(poolId, "confirmed");
    const [pool] = this.poolKey(index, creator, baseMint, quoteMint);
    const globalConfig = globalConfigPda(this.program.programId)[0];
    const swapAccounts = await this.swapAccounts(pool, mint, WSOL_TOKEN_ACCOUNT, user, globalConfig, feeRecipient, userBaseTokenAccount, userQuoteTokenAccount);

    // Pack the instruction data: discriminator (8 bytes) + base_amount_in (8 bytes) + min_quote_amount_out (8 bytes)

    const associatedUser = await getAssociatedTokenAddress(mint, user, false);
    const transaction = new Transaction();

    try {
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(user, associatedUser, user, mint));
    }

    try {
      await getAccount(this.connection, userQuoteTokenAccount, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(user, userQuoteTokenAccount, user, NATIVE_MINT));
    }

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: userQuoteTokenAccount,
        lamports: solAmount,
      })
    );
    transaction.add(createSyncNativeInstruction(userQuoteTokenAccount));
    // sync wrapped SOL balance
    transaction.add(
      await this.program.methods.buy(new BN(amount.toString()), new BN(solAmount.toString()), { 0: true }).accountsPartial(swapAccounts).instruction()
    );

    transaction.add(createCloseAccountInstruction(userQuoteTokenAccount, user, user));

    return transaction;
  }

  async createSellInstruction(
    poolId: PublicKey,
    user: PublicKey,
    mint: PublicKey,
    baseAmountIn: bigint, // Use bigint for u64
    minQuoteAmountOut: bigint,
    closeTokenAccount: boolean = false,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    // Compute associated token account addresses
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);
    const userQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, user);

    const { index, creator, baseMint, quoteMint } = await this.program.account.pool.fetch(poolId);
    const [pool] = this.poolKey(index, creator, baseMint, quoteMint);
    const globalConfig = globalConfigPda(this.program.programId)[0];
    const swapAccounts = await this.swapAccounts(pool, mint, WSOL_TOKEN_ACCOUNT, user, globalConfig, feeRecipient, userBaseTokenAccount, userQuoteTokenAccount);

    const transaction = new Transaction();

    try {
      await getAccount(this.connection, userQuoteTokenAccount, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(user, userQuoteTokenAccount, user, NATIVE_MINT));
    }

    transaction.add(
      await this.program.methods.sell(new BN(baseAmountIn.toString()), new BN(minQuoteAmountOut.toString())).accountsPartial(swapAccounts).instruction()
    );

    if (closeTokenAccount) {
      transaction.add(createCloseAccountInstruction(userQuoteTokenAccount, user, user));
    }

    // Create the transaction instruction
    return transaction;
  }
}
