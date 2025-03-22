import dotenv from "dotenv";

dotenv.config();

import { PumpSwapSDK } from "./pumpswap";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { PumpSwapPool } from "./poolswap";
import { calculateWithSlippageBuy, calculateWithSlippageSell } from "./util";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

async function sendV0Transaction(
  connection: Connection,
  user: Keypair,
  instructions: TransactionInstruction[],
  lookupTableAccounts?: AddressLookupTableAccount[]
) {
  // Get the latest blockhash and last valid block height
  const { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash({ commitment: "confirmed" });

  // Create a new transaction message with the provided instructions
  const messageV0 = new TransactionMessage({
    payerKey: user.publicKey, // The payer (i.e., the account that will pay for the transaction fees)
    recentBlockhash: blockhash, // The blockhash of the most recent block
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 100000 * 1,
      }),
      ...instructions,
    ], // The instructions to include in the transaction
  }).compileToV0Message(lookupTableAccounts ? lookupTableAccounts : undefined);

  // Create a new transaction object with the message
  const transaction = new VersionedTransaction(messageV0);

  // Sign the transaction with the user's keypair
  transaction.sign([user]);
  console.log(`sendRawTransaction`, Buffer.from(transaction.serialize()).toString("base64"));
  // const jitoConnection = new Connection(
  //   "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
  //   "confirmed"
  // )
  // Send the transaction to the cluster

  const txid = await connection.sendTransaction(transaction, {
    skipPreflight: true,
    maxRetries: 2,
  });

  await connection.confirmTransaction(
    {
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
      signature: txid,
    },
    "confirmed"
  );

  // Log the transaction URL on the Solana Explorer
  console.log(`https://explorer.solana.com/tx/${txid}`);
}

const executePumpswapBuy = async () => {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(process.env.KEY as string));
    const pubKey = keypair.publicKey;
    const mint = new PublicKey("7sN5VPJ4kJ38M4uMPDWVhJ4iB5RE3xLkMv7qDByfpump"); // Replace with actual mint address
    console.log("Wallet address:", pubKey.toBase58());
    const connection = new Connection(process.env.RPC_URL as string, "confirmed");
    const provider = new AnchorProvider(connection, {} as any, {
      commitment: "finalized",
    });
    const pumpswap = new PumpSwapSDK(provider);

    const user = pubKey;
    const solAmount = 100_000_000n; // Amount of SOL to buy with
    const solAmountWithSlippage = calculateWithSlippageBuy(solAmount, 500n);

    const pumpSwapPool = new PumpSwapPool(provider);
    const pool = await pumpSwapPool.getPoolsWithPrices(mint);
    const amount = await pumpSwapPool.getBuyTokenAmount(solAmount, mint, pool[0]);

    console.log(
      pool.map((x) => x.address),
      "price",
      pool.map((x) => x.price)
    );

    console.log("Pool:", pool[0].address.toBase58(), "Amount:", amount);
    const buyTx = await pumpswap.createBuyInstruction(pool[0].address, user, mint, amount, solAmountWithSlippage, "confirmed");

    await sendV0Transaction(connection, keypair, [...buyTx.instructions]);
    return buyTx;
  } catch (error) {
    console.error("Error executing Pumpswap buy:", error);
    throw error;
  }
};

const executePumpswapSell = async () => {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(process.env.KEY as string));
    const pubKey = keypair.publicKey;
    const mint = new PublicKey("7sN5VPJ4kJ38M4uMPDWVhJ4iB5RE3xLkMv7qDByfpump"); // Replace with actual mint address
    console.log("Wallet address:", pubKey.toBase58());
    const connection = new Connection(process.env.RPC_URL as string, "confirmed");
    const provider = new AnchorProvider(connection, {} as any, {
      commitment: "finalized",
    });
    const pumpswap = new PumpSwapSDK(provider);

    const ata = getAssociatedTokenAddressSync(mint, pubKey);
    const balance = await connection.getTokenAccountBalance(ata);
    // console.log("Balance:", balance.value.amount);
    const user = pubKey;

    const pumpSwapPool = new PumpSwapPool(provider);
    const pool = await pumpSwapPool.getPoolsWithPrices(mint);
    console.log(
      pool.map((x) => x.address),
      "price",
      pool.map((x) => x.price)
    );
    const solAmount = await pumpSwapPool.getSellTokenAmount(BigInt(balance.value.amount), mint, pool[0]);

    // const solAmount = 100_000n; // Amount of SOL to buy with
    const solAmountWithSlippage = calculateWithSlippageSell(solAmount, 500n);

    // console.log("Pool:", pool[0].address.toBase58(), "Amount:", amount);
    const sellTx = await pumpswap.createSellInstruction(pool[0].address, user, mint, BigInt(balance.value.amount), solAmountWithSlippage);

    await sendV0Transaction(connection, keypair, [...sellTx.instructions]);
    return sellTx;
  } catch (error) {
    console.error("Error executing Pumpswap buy:", error);
    throw error;
  }
};

// Execute the buy using async/await
const init = async () => {
  try {
    await executePumpswapBuy();
    await executePumpswapSell();

    console.log("Pumpswap buy executed successfully");
  } catch (err) {
    console.error("Failed to execute Pumpswap buy:", err);
  }
};

init();
