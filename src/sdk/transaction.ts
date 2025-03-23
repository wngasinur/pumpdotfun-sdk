import {
  Blockhash,
  Connection,
  PublicKey,
  Signer,
  TransactionError,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

export function transactionFromInstructions(
  payerKey: PublicKey,
  instructions: TransactionInstruction[],
  recentBlockhash: Blockhash,
  signers: Signer[],
): VersionedTransaction {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey,
      instructions,
      recentBlockhash,
    }).compileToV0Message(),
  );

  transaction.sign(signers);

  return transaction;
}

export function getSignature(transaction: VersionedTransaction): string {
  return bs58.encode(transaction.signatures[0]);
}

export async function sendAndConfirmTransaction(
  connection: Connection,
  payerKey: PublicKey,
  instructions: TransactionInstruction[],
  signers: Signer[],
): Promise<[VersionedTransaction, TransactionError | null]> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const transaction = transactionFromInstructions(
    payerKey,
    instructions,
    blockhash,
    signers,
  );

  await connection.sendTransaction(transaction);

  const signature = getSignature(transaction);

  const result = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  return [transaction, result.value.err];
}
