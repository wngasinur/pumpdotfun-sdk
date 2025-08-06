import { Commitment, Connection, Finality, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Program, Provider } from "@coral-xyz/anchor";
import { GlobalAccount } from "./globalAccount";
import {
  CompleteEvent,
  CreateEvent,
  CreateTokenMetadata,
  PriorityFee,
  PumpFunEventHandlers,
  PumpFunEventType,
  SetParamsEvent,
  TradeEvent,
  TransactionResult,
} from "./types";
import { toCompleteEvent, toCreateEvent, toSetParamsEvent, toTradeEvent } from "./events";
import { createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BondingCurveAccount } from "./bondingCurveAccount";
import { BN } from "bn.js";
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, calculateWithSlippageBuy, calculateWithSlippageSell, returnTx, sendTx } from "./util";
import { PumpFun, IDL } from "./IDL";
const PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const MPL_TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const GLOBAL_ACCOUNT_SEED = "global";
export const MINT_AUTHORITY_SEED = "mint-authority";
export const BONDING_CURVE_SEED = "bonding-curve";
export const CREATOR_VAULT_SEED = "creator-vault";
export const METADATA_SEED = "metadata";
export const GLOBAL_VOLUME_SEED = "global_volume_accumulator";
export const USER_VOLUME_SEED = "user_volume_accumulator";

export const DEFAULT_DECIMALS = 6;

export class PumpFunSDK {
  public program: Program<PumpFun>;
  public connection: Connection;
  constructor(provider?: Provider) {
    this.program = new Program<PumpFun>(IDL as PumpFun, provider);
    this.connection = this.program.provider.connection;
  }

  async createAndBuy(
    creator: PublicKey,
    mint: Keypair,
    createTokenMetadata: CreateTokenMetadata,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
  ): Promise<Transaction> {
    // let tokenMetadata = await this.createTokenMetadata(createTokenMetadata);

    let createTx = await this.getCreateInstructions(creator, createTokenMetadata.name, createTokenMetadata.symbol, createTokenMetadata.metadataUri, mint);

    let newTx = new Transaction().add(createTx);

    if (buyAmountSol > 0) {
      const globalAccount = await this.getGlobalAccount(commitment);
      const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
      const buyAmountWithSlippage = calculateWithSlippageBuy(buyAmountSol, slippageBasisPoints);

      const buyTx = await this.getBuyInstructions(creator, mint.publicKey, globalAccount.feeRecipient, buyAmount, buyAmountWithSlippage, creator, commitment);

      newTx.add(buyTx);
    }

    let createResults = await returnTx(newTx, priorityFees);
    return createResults;
  }

  async buy(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
  ): Promise<Transaction> {
    let buyTx = await this.getBuyInstructionsBySolAmount(buyer, mint, buyAmountSol, slippageBasisPoints, commitment);

    let buyResults = await returnTx(buyTx, priorityFees);
    return buyResults;
  }

  async sell(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
  ): Promise<Transaction> {
    let sellTx = await this.getSellInstructionsByTokenAmount(seller, mint, sellTokenAmount, slippageBasisPoints, commitment);

    let sellResults = await returnTx(sellTx, priorityFees);
    return sellResults;
  }

  //create token instructions
  async getCreateInstructions(creator: PublicKey, name: string, symbol: string, uri: string, mint: Keypair) {
    const mplTokenMetadata = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(METADATA_SEED), mplTokenMetadata.toBuffer(), mint.publicKey.toBuffer()],
      mplTokenMetadata
    );

    const associatedBondingCurve = await getAssociatedTokenAddress(mint.publicKey, this.getBondingCurvePDA(mint.publicKey), true);

    return this.program.methods
      .create(name, symbol, uri, creator)
      .accounts({
        mint: mint.publicKey,
        // @ts-ignore
        associatedBondingCurve: associatedBondingCurve,
        metadata: metadataPDA,
        user: creator,
      })
      .signers([mint])
      .transaction();
  }

  async getBuyInstructionsBySolAmount(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT,
    bondingCurveAccount?: BondingCurveAccount | null
  ) {
    if (!bondingCurveAccount) {
      bondingCurveAccount = await this.getBondingCurveAccount(mint, commitment);
    }

    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
    let buyAmountWithSlippage = calculateWithSlippageBuy(buyAmountSol, slippageBasisPoints);

    let globalAccount = await this.getGlobalAccount(commitment);

    return await this.getBuyInstructions(buyer, mint, globalAccount.feeRecipient, buyAmount, buyAmountWithSlippage, bondingCurveAccount.creator, commitment);
  }

  //buy
  async getBuyInstructions(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    bondingCurveCreator: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    // const associatedBondingCurve = await getAssociatedTokenAddress(mint, this.getBondingCurvePDA(mint), true);

    const associatedUser = await getAssociatedTokenAddress(mint, buyer, false);

    let transaction = new Transaction();

    try {
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(buyer, associatedUser, buyer, mint));
    }

    transaction.add(
      await this.program.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        .accountsPartial({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedUser: associatedUser,
          user: buyer,
          creatorVault: this.getCreatorVaultPDA(bondingCurveCreator),
          globalVolumeAccumulator: this.getGlobalVolumeAccumulatorPda(),
          userVolumeAccumulator: this.getUserVolumeAccumulatorPda(buyer),
        })
        .transaction()
    );

    return transaction;
  }

  async getBuyInstructions2(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    const associatedBondingCurve = getAssociatedTokenAddressSync(mint, this.getBondingCurvePDA(mint), true);

    const associatedUser = getAssociatedTokenAddressSync(mint, buyer, false);

    let transaction = new Transaction();

    try {
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(buyer, associatedUser, buyer, mint));
    }

    transaction.add(
      await this.program.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          // @ts-ignore
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: buyer,
        })
        .transaction()
    );

    return transaction;
  }

  //sell
  async getSellInstructionsByTokenAmount(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    let bondingCurveAccount = await this.getBondingCurveAccount(mint, commitment);
    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    let globalAccount = await this.getGlobalAccount(commitment);

    let minSolOutput = bondingCurveAccount.getSellPrice(sellTokenAmount, globalAccount.feeBasisPoints);

    let sellAmountWithSlippage = calculateWithSlippageSell(minSolOutput, slippageBasisPoints);

    return await this.getSellInstructions(seller, mint, globalAccount.feeRecipient, sellTokenAmount, sellAmountWithSlippage);
  }

  async getSellInstructions(seller: PublicKey, mint: PublicKey, feeRecipient: PublicKey, amount: bigint, minSolOutput: bigint) {
    const associatedBondingCurve = await getAssociatedTokenAddress(mint, this.getBondingCurvePDA(mint), true);

    const associatedUser = await getAssociatedTokenAddress(mint, seller, false);

    let transaction = new Transaction();

    transaction.add(
      await this.program.methods
        .sell(new BN(amount.toString()), new BN(minSolOutput.toString()))
        .accountsPartial({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedUser: associatedUser,
          user: seller,
        })
        .transaction()
    );

    return transaction;
  }

  async getBondingCurveAccount(mint: PublicKey, commitment: Commitment = DEFAULT_COMMITMENT) {
    const tokenAccount = await this.connection.getAccountInfo(this.getBondingCurvePDA(mint), commitment);
    if (!tokenAccount) {
      return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount!.data);
  }

  async getGlobalAccount(commitment: Commitment = DEFAULT_COMMITMENT) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_ACCOUNT_SEED)], new PublicKey(PROGRAM_ID));

    const tokenAccount = await this.connection.getAccountInfo(globalAccountPDA, commitment);

    return GlobalAccount.fromBuffer(tokenAccount!.data);
  }

  getBondingCurvePDA(mint: PublicKey) {
    return PublicKey.findProgramAddressSync([Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()], this.program.programId)[0];
  }

  getCreatorVaultPDA(creator: PublicKey) {
    return PublicKey.findProgramAddressSync([Buffer.from(CREATOR_VAULT_SEED), creator.toBuffer()], this.program.programId)[0];
  }

  getGlobalVolumeAccumulatorPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_VOLUME_SEED)], this.program.programId)[0];
  }

  getUserVolumeAccumulatorPda(user: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from(USER_VOLUME_SEED), user.toBuffer()], this.program.programId)[0];
  }

  async createTokenMetadata(create: CreateTokenMetadata) {
    // Validate file
    if (!(create.file instanceof Blob)) {
      throw new Error("File must be a Blob or File object");
    }

    let formData = new FormData();
    formData.append("file", create.file, "image.png"); // Add filename
    formData.append("name", create.name);
    formData.append("symbol", create.symbol);
    formData.append("description", create.description);
    formData.append("twitter", create.twitter || "");
    formData.append("telegram", create.telegram || "");
    formData.append("website", create.website || "");
    formData.append("showName", "true");

    try {
      const request = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
        credentials: "same-origin",
      });

      if (request.status === 500) {
        // Try to get more error details
        const errorText = await request.text();
        throw new Error(`Server error (500): ${errorText || "No error details available"}`);
      }

      if (!request.ok) {
        throw new Error(`HTTP error! status: ${request.status}`);
      }

      const responseText = await request.text();
      if (!responseText) {
        throw new Error("Empty response received from server");
      }

      try {
        return JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
    } catch (error) {
      console.error("Error in createTokenMetadata:", error);
      throw error;
    }
  }
  //EVENTS
  addEventListener<T extends PumpFunEventType>(eventType: T, callback: (event: PumpFunEventHandlers[T], slot: number, signature: string) => void) {
    return this.program.addEventListener(eventType, (event: any, slot: number, signature: string) => {
      let processedEvent;
      switch (eventType) {
        case "createEvent":
          processedEvent = toCreateEvent(event as CreateEvent);
          callback(processedEvent as PumpFunEventHandlers[T], slot, signature);
          break;
        case "tradeEvent":
          processedEvent = toTradeEvent(event as TradeEvent);
          callback(processedEvent as PumpFunEventHandlers[T], slot, signature);
          break;
        case "completeEvent":
          processedEvent = toCompleteEvent(event as CompleteEvent);
          callback(processedEvent as PumpFunEventHandlers[T], slot, signature);
          console.log("completeEvent", event, slot, signature);
          break;
        case "setParamsEvent":
          processedEvent = toSetParamsEvent(event as SetParamsEvent);
          callback(processedEvent as PumpFunEventHandlers[T], slot, signature);
          break;
        default:
          console.error("Unhandled event type:", eventType);
      }
    });
  }

  removeEventListener(eventId: number) {
    this.program.removeEventListener(eventId);
  }
}
