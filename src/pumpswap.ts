import { Commitment, Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { Program, Provider } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  NATIVE_MINT,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { PumpSwap, IDL_SWAP } from "./IDL/index";
import { DEFAULT_COMMITMENT } from "./util";
import { PumpSwapPool } from "./poolswap";

// Define static public keys
const PUMP_AMM_PROGRAM_ID: PublicKey = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID: PublicKey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WSOL_TOKEN_ACCOUNT: PublicKey = new PublicKey("So11111111111111111111111111111111111111112");
const global = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
const eventAuthority = new PublicKey("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
const feeRecipient = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
const feeRecipientAta = new PublicKey("94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb");
const BUY_DISCRIMINATOR: Uint8Array = new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR: Uint8Array = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);

export class PumpSwapSDK {
  public program: Program<PumpSwap>;
  public connection: Connection;
  public pumpSwapPool: PumpSwapPool;

  constructor(provider?: Provider) {
    this.program = new Program<PumpSwap>(IDL_SWAP as PumpSwap, provider);
    this.connection = this.program.provider.connection;
    this.pumpSwapPool = new PumpSwapPool(provider);
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
    const poolBaseTokenAccount = await getAssociatedTokenAddress(mint, poolId, true);

    const poolQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, poolId, true);

    // Define the accounts for the instruction
    const accounts = [
      { pubkey: poolId, isSigner: false, isWritable: false }, // pool_id (readonly)
      { pubkey: user, isSigner: true, isWritable: true }, // user (signer)
      { pubkey: global, isSigner: false, isWritable: false }, // global (readonly)
      { pubkey: mint, isSigner: false, isWritable: false }, // mint (readonly)
      { pubkey: WSOL_TOKEN_ACCOUNT, isSigner: false, isWritable: false }, // WSOL_TOKEN_ACCOUNT (readonly)
      { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true }, // user_base_token_account
      { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true }, // user_quote_token_account
      { pubkey: poolBaseTokenAccount, isSigner: false, isWritable: true }, // pool_base_token_account
      { pubkey: poolQuoteTokenAccount, isSigner: false, isWritable: true }, // pool_quote_token_account
      { pubkey: feeRecipient, isSigner: false, isWritable: false }, // fee_recipient (readonly)
      { pubkey: feeRecipientAta, isSigner: false, isWritable: true }, // fee_recipient_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly, duplicated as in Rust)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System Program (readonly)
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // ASSOCIATED_TOKEN_PROGRAM_ID (readonly)
      { pubkey: eventAuthority, isSigner: false, isWritable: false }, // event_authority (readonly)
      { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false }, // PUMP_AMM_PROGRAM_ID (readonly)
    ];

    // Pack the instruction data: discriminator (8 bytes) + base_amount_in (8 bytes) + min_quote_amount_out (8 bytes)
    const data = Buffer.alloc(8 + 8 + 8); // 24 bytes total
    data.set(BUY_DISCRIMINATOR, 0);
    data.writeBigUInt64LE(BigInt(amount), 8); // Write base_amount_in as little-endian u64
    data.writeBigUInt64LE(BigInt(solAmount), 16); // Write min_quote_amount_out as little-endian u64

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
      new TransactionInstruction({
        keys: accounts,
        programId: PUMP_AMM_PROGRAM_ID,
        data: data,
      })
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
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    // Compute associated token account addresses
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);
    const userQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, user);
    const poolBaseTokenAccount = await getAssociatedTokenAddress(mint, poolId, true);
    const poolQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, poolId, true);

    // Define the accounts for the instruction
    const accounts = [
      { pubkey: poolId, isSigner: false, isWritable: false }, // pool_id (readonly)
      { pubkey: user, isSigner: true, isWritable: true }, // user (signer)
      { pubkey: global, isSigner: false, isWritable: false }, // global (readonly)
      { pubkey: mint, isSigner: false, isWritable: false }, // mint (readonly)
      { pubkey: WSOL_TOKEN_ACCOUNT, isSigner: false, isWritable: false }, // WSOL_TOKEN_ACCOUNT (readonly)
      { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true }, // user_base_token_account
      { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true }, // user_quote_token_account
      { pubkey: poolBaseTokenAccount, isSigner: false, isWritable: true }, // pool_base_token_account
      { pubkey: poolQuoteTokenAccount, isSigner: false, isWritable: true }, // pool_quote_token_account
      { pubkey: feeRecipient, isSigner: false, isWritable: false }, // fee_recipient (readonly)
      { pubkey: feeRecipientAta, isSigner: false, isWritable: true }, // fee_recipient_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // TOKEN_PROGRAM_ID (readonly, duplicated as in Rust)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System Program (readonly)
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // ASSOCIATED_TOKEN_PROGRAM_ID (readonly)
      { pubkey: eventAuthority, isSigner: false, isWritable: false }, // event_authority (readonly)
      { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false }, // PUMP_AMM_PROGRAM_ID (readonly)
    ];

    // Pack the instruction data: discriminator (8 bytes) + base_amount_in (8 bytes) + min_quote_amount_out (8 bytes)
    const data = Buffer.alloc(8 + 8 + 8); // 24 bytes total
    data.set(SELL_DISCRIMINATOR, 0);
    data.writeBigUInt64LE(BigInt(baseAmountIn), 8); // Write base_amount_in as little-endian u64
    data.writeBigUInt64LE(BigInt(minQuoteAmountOut), 16); // Write min_quote_amount_out as little-endian u64

    const transaction = new Transaction();

    try {
      await getAccount(this.connection, userQuoteTokenAccount, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(user, userQuoteTokenAccount, user, NATIVE_MINT));
    }

    transaction.add(
      new TransactionInstruction({
        keys: accounts,
        programId: PUMP_AMM_PROGRAM_ID,
        data: data,
      })
    );
    transaction.add(createCloseAccountInstruction(userQuoteTokenAccount, user, user));
    // Create the transaction instruction
    return transaction;
  }
}
