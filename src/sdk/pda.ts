import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMP_AMM_PROGRAM_ID_PUBKEY = new PublicKey(PUMP_AMM_PROGRAM_ID);

export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_PROGRAM_ID_PUBKEY = new PublicKey(PUMP_PROGRAM_ID);

export const CANONICAL_POOL_INDEX = 0;

export function globalConfigPda(programId: PublicKey = PUMP_AMM_PROGRAM_ID_PUBKEY): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("global_config")], programId);
}

export function poolPda(
  index: number,
  owner: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  programId: PublicKey = PUMP_AMM_PROGRAM_ID_PUBKEY
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), new BN(index).toArrayLike(Buffer, "le", 2), owner.toBuffer(), baseMint.toBuffer(), quoteMint.toBuffer()],
    programId
  );
}

export function lpMintPda(pool: PublicKey, programId: PublicKey = PUMP_AMM_PROGRAM_ID_PUBKEY): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool_lp_mint"), pool.toBuffer()], programId);
}

export function lpMintAta(lpMint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(lpMint, owner, true, TOKEN_2022_PROGRAM_ID);
}

export function pumpPoolAuthorityPda(mint: PublicKey, pumpProgramId: PublicKey = PUMP_PROGRAM_ID_PUBKEY): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool-authority"), mint.toBuffer()], pumpProgramId);
}

export function canonicalPumpPoolPda(
  mint: PublicKey,
  programId: PublicKey = PUMP_AMM_PROGRAM_ID_PUBKEY,
  pumpProgramId: PublicKey = PUMP_PROGRAM_ID_PUBKEY
): [PublicKey, number] {
  const [pumpPoolAuthority] = pumpPoolAuthorityPda(mint, pumpProgramId);

  return poolPda(CANONICAL_POOL_INDEX, pumpPoolAuthority, mint, NATIVE_MINT, programId);
}

export function pumpAmmEventAuthorityPda(programId: PublicKey = PUMP_AMM_PROGRAM_ID_PUBKEY) {
  return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], programId);
}
