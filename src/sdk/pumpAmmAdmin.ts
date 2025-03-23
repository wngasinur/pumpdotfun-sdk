import { BN, Program } from "@coral-xyz/anchor";
import { PumpAmm } from "../types/pump_amm";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { globalConfigPda, PUMP_AMM_PROGRAM_ID } from "./pda";
import { getPumpAmmProgram } from "./util";

export class PumpAmmAdminSdk {
  private readonly program: Program<PumpAmm>;
  private readonly globalConfig: PublicKey;

  constructor(connection: Connection, programId: string = PUMP_AMM_PROGRAM_ID) {
    this.program = getPumpAmmProgram(connection, programId);
    this.globalConfig = globalConfigPda(this.program.programId)[0];
  }

  programId(): PublicKey {
    return this.program.programId;
  }

  fetchGlobalConfigAccount() {
    return this.program.account.globalConfig.fetch(this.globalConfig);
  }

  createConfig(
    lpFeeBasisPoints: BN,
    protocolFeeBasisPoints: BN,
    protocolFeeRecipients: PublicKey[],
    admin: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .createConfig(
        lpFeeBasisPoints,
        protocolFeeBasisPoints,
        protocolFeeRecipients,
      )
      .accountsPartial({
        admin,
      })
      .instruction();
  }

  disable(
    disableCreatePool: boolean,
    disableDeposit: boolean,
    disableWithdraw: boolean,
    disableBuy: boolean,
    disableSell: boolean,
    admin: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .disable(
        disableCreatePool,
        disableDeposit,
        disableWithdraw,
        disableBuy,
        disableSell,
      )
      .accountsPartial({
        admin,
        globalConfig: this.globalConfig,
      })
      .instruction();
  }

  updateAdmin(
    admin: PublicKey,
    newAdmin: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateAdmin()
      .accountsPartial({
        admin,
        newAdmin,
        globalConfig: this.globalConfig,
      })
      .instruction();
  }

  updateFeeConfig(
    lpFeeBasisPoints: BN,
    protocolFeeBasisPoints: BN,
    protocolFeeRecipients: PublicKey[],
    admin: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateFeeConfig(
        lpFeeBasisPoints,
        protocolFeeBasisPoints,
        protocolFeeRecipients,
      )
      .accountsPartial({
        admin,
        globalConfig: this.globalConfig,
      })
      .instruction();
  }
}
