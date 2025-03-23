import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import pumpAmmIdl from "../IDL/pumpswap.json";
import { PumpAmm } from "../types/pump_amm";
import { PUMP_AMM_PROGRAM_ID } from "./pda";

export function ceilDiv(a: BN, b: BN): BN {
  if (b.isZero()) {
    throw new Error("Cannot divide by zero.");
  }
  return a.add(b.subn(1)).div(b);
}

export function fee(amount: BN, basisPoints: BN): BN {
  return ceilDiv(amount.mul(basisPoints), new BN(10_000));
}

export function getPumpAmmProgram(connection: Connection, programId: string = PUMP_AMM_PROGRAM_ID): Program<PumpAmm> {
  const pumpAmmIdlAddressOverride = { ...pumpAmmIdl };

  pumpAmmIdlAddressOverride.address = programId;

  return new Program(pumpAmmIdlAddressOverride as PumpAmm, new AnchorProvider(connection, null as any, {}));
}
