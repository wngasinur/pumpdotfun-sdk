import dotenv from "dotenv";

dotenv.config();

import { PumpSwapSDK } from "./pumpswap";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { PumpSwapPool } from "./poolswap";
import { calculateWithSlippageBuy, calculateWithSlippageSell } from "./util";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getPumpSwapBuyPrices } from "./pumpswap_calculator";
import { PumpAmmInternalSdk } from "./sdk/pumpAmmInternal";

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
    const solAmount = 1_000_000n; // Amount of SOL to buy with
    const solAmountWithSlippage = calculateWithSlippageBuy(solAmount, 500n);

    const pumpSwapPool = new PumpSwapPool(provider);

    // console.log("globalConfig", globalConfig);
    const pool = await pumpSwapPool.getPoolsWithPrices(mint);
    const currentPool = pool[0];
    const { baseAmountOut, maxQuote } = await pumpSwapPool.getBuyTokenAmount(solAmount, mint, 500, currentPool);

    console.log("Pool:", pool[0].address.toBase58(), "Amount:", baseAmountOut.toNumber());

    const buyTx = await pumpswap.createBuyInstruction(pool[0].address, user, mint, BigInt(baseAmountOut.toString()), solAmountWithSlippage, "confirmed");

    await sendV0Transaction(connection, keypair, [...buyTx.instructions]);
    // return buyTx;
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
    const solAmount = await pumpSwapPool.getSellTokenAmount(BigInt(balance.value.amount), mint, 500, pool[0]);

    // const solAmount = 100_000n; // Amount of SOL to buy with
    const solAmountWithSlippage = calculateWithSlippageSell(BigInt(solAmount.toString()), 500n);

    // console.log("Pool:", pool[0].address.toBase58(), "Amount:", amount);
    const sellTx = await pumpswap.createSellInstruction(pool[0].address, user, mint, BigInt(balance.value.amount), solAmountWithSlippage);

    await sendV0Transaction(connection, keypair, [...sellTx.instructions]);
    return sellTx;
  } catch (error) {
    console.error("Error executing Pumpswap buy:", error);
    throw error;
  }
};

const decodePumpTx = async () => {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(process.env.KEY as string));
    const pubKey = keypair.publicKey;
    const mint = new PublicKey("Dfn5mX8TGwFruQyYcMoJp7f62iu9uYGDWnsfhTQcpump"); // Replace with actual mint address
    console.log("Wallet address:", pubKey.toBase58());
    const connection = new Connection(process.env.RPC_URL as string, "confirmed");
    const provider = new AnchorProvider(connection, {} as any, {
      commitment: "finalized",
    });
    const pumpswap = new PumpSwapSDK(provider);
    const pumpSwapPool = new PumpSwapPool(provider);
    const pools = await pumpSwapPool.getPoolsWithPrices(mint);

    const pool = await pumpSwapPool.getPoolDataFromPoolId(pools[0].address);
    if (pool) {
      const poolWithPrice = await pumpSwapPool.getPriceAndLiquidity(pool);
      console.log("poolWithPrice", poolWithPrice.reserves.native, poolWithPrice.reserves.token);
    }

    // console.log("b1", b1.value.amount, b1.value.decimals);

    // const txRaw =
    //   "AYiB/ytPn6gYQt6UIO13XW94MxFPIAEkEzvUzWgkmEAu9k1iLfky9oxCAD+doVzUmnyD2NI4SGsWpjzI1OnhsQGAAQAKEuEbUwiDyLi5HqdFJwDhVVAMkDo3SyOTqyTI1XDoKmH7N1S2UHXfZ0z0OMfTnre3MEVqXtgKoy6zP3pE2XL16m/mkIZwDcZRgjrWXRRaN8u41mJR0yyZrziqM0iZz9MGeJTV9rzYhnngg9CL8gdW+gJpzMMDxTrH/+QhtODqI+pUIpgV5G7X7f9v1mS2MNcyyRc5d+ivZueHsYYtaMX0t/w1FGR31TzjHrB9ppATzFeTjRPNBSqqxUlQF4DsUQiAfm+kIRZTVh5jvFTyM7GXM2bUj+W5qLARPTQJH4fV6ULObmpdnaEmj6IDt38x7V8XTnOH2wKbiGxpZEbysTqqoCUDBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAIyXJY9OJInxuz0QKRSODYMLWhOZ2v8QhASOe9jb6fhZBpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpLIWDiRUWqZY70AYgK1FbxzDijnkdnQLeeKzqU353oI8MFN78gl7GdpQlCBi7ZUBl9CmNMVbVcbTU+AkMGOmoY4kLpkT+H1WqGfEc0tLsFNMjO24KS+ru9ytphY4h4XDWBt324e51j94YQl285GzN2rYa/E2DuQ0n/r35KNihi/zlSnCVKIOfYcC5uGB5iRwTkhbkenG2L7c77HIWlFh0Xo64BauidpEtQ8276X2LfykdOpukhxV2yfsmwty+aNOuCQgABQKLygIACAAJA6CGAQAAAAAACQYAAQAKCwwBAQsCAAEMAgAAAOHk9wQAAAAADAEBAREJBgACAw0LDAEBCQYABAMKCwwBAQ4SAw8ADQoFBgEHAgQLEAwMCREOGumS0Y7PaEC8AAAAAGSns7bgDeHk9wQAAAAADAMBAAABCQA=";
    // const txBuffer = Buffer.from(txRaw, "base64");
    // const tx = VersionedTransaction.deserialize(txBuffer);
    // const createPoolTx = tx.message.compiledInstructions.filter((x) => x.accountKeyIndexes.length == 24).shift();
    // console.log("createPoolTx", createPoolTx);
  } catch (error) {
    console.error("Error executing Pumpswap buy:", error);
    throw error;
  }
};

// Execute the buy using async/await
const init = async () => {
  try {
    // await decodePumpTx();
    // await executePumpswapBuy();
    await executePumpswapSell();

    console.log("Pumpswap buy executed successfully");
  } catch (err) {
    console.error("Failed to execute Pumpswap buy:", err);
  }
};

init();
