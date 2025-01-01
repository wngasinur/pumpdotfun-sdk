import { struct, bool, u64, Layout } from "@coral-xyz/borsh";
import { GlobalAccount } from "./globalAccount";

export class BondingCurveAccount {
  public discriminator: bigint;
  public virtualTokenReserves: bigint;
  public virtualSolReserves: bigint;
  public realTokenReserves: bigint;
  public realSolReserves: bigint;
  public tokenTotalSupply: bigint;
  public complete: boolean;

  constructor(
    discriminator: bigint,
    virtualTokenReserves: bigint,
    virtualSolReserves: bigint,
    realTokenReserves: bigint,
    realSolReserves: bigint,
    tokenTotalSupply: bigint,
    complete: boolean
  ) {
    this.discriminator = discriminator;
    this.virtualTokenReserves = virtualTokenReserves;
    this.virtualSolReserves = virtualSolReserves;
    this.realTokenReserves = realTokenReserves;
    this.realSolReserves = realSolReserves;
    this.tokenTotalSupply = tokenTotalSupply;
    this.complete = complete;
  }

  getBuyPrice(amount: bigint): bigint {
    if (this.complete) {
      throw new Error("Curve is complete");
    }

    if (amount <= 0n) {
      return 0n;
    }

    // Calculate the product of virtual reserves
    let n = this.virtualSolReserves * this.virtualTokenReserves;

    // Calculate the new virtual sol reserves after the purchase
    let i = this.virtualSolReserves + amount;

    // Calculate the new virtual token reserves after the purchase
    let r = n / i + 1n;

    // Calculate the amount of tokens to be purchased
    let s = this.virtualTokenReserves - r;

    // Return the minimum of the calculated tokens and real token reserves
    return s < this.realTokenReserves ? s : this.realTokenReserves;
  }

  getSellPrice(amount: bigint, feeBasisPoints: bigint): bigint {
    if (this.complete) {
      throw new Error("Curve is complete");
    }

    if (amount <= 0n) {
      return 0n;
    }

    // Calculate the proportional amount of virtual sol reserves to be received
    let n = (amount * this.virtualSolReserves) / (this.virtualTokenReserves + amount);

    // Calculate the fee amount in the same units
    let a = (n * feeBasisPoints) / 10000n;

    // Return the net amount after deducting the fee
    return n - a;
  }

  getMarketCapSOL(): bigint {
    if (this.virtualTokenReserves === 0n) {
      return 0n;
    }

    return (this.tokenTotalSupply * this.virtualSolReserves) / this.virtualTokenReserves;
  }

  getFinalMarketCapSOL(feeBasisPoints: bigint): bigint {
    let totalSellValue = this.getBuyOutPrice(this.realTokenReserves, feeBasisPoints);
    let totalVirtualValue = this.virtualSolReserves + totalSellValue;
    let totalVirtualTokens = this.virtualTokenReserves - this.realTokenReserves;

    if (totalVirtualTokens === 0n) {
      return 0n;
    }

    return (this.tokenTotalSupply * totalVirtualValue) / totalVirtualTokens;
  }

  getBuyOutPrice(amount: bigint, feeBasisPoints: bigint): bigint {
    let solTokens = amount < this.realSolReserves ? this.realSolReserves : amount;
    let totalSellValue = (solTokens * this.virtualSolReserves) / (this.virtualTokenReserves - solTokens) + 1n;
    let fee = (totalSellValue * feeBasisPoints) / 10000n;
    return totalSellValue + fee;
  }

  public static fromBuffer(buffer: Buffer): BondingCurveAccount {
    const structure: Layout<BondingCurveAccount> = struct([
      u64("discriminator"),
      u64("virtualTokenReserves"),
      u64("virtualSolReserves"),
      u64("realTokenReserves"),
      u64("realSolReserves"),
      u64("tokenTotalSupply"),
      bool("complete"),
    ]);

    let value = structure.decode(buffer);
    return new BondingCurveAccount(
      BigInt(value.discriminator),
      BigInt(value.virtualTokenReserves),
      BigInt(value.virtualSolReserves),
      BigInt(value.realTokenReserves),
      BigInt(value.realSolReserves),
      BigInt(value.tokenTotalSupply),
      value.complete
    );
  }

  public static fromGlobalAccount(g: GlobalAccount): BondingCurveAccount {
    return new BondingCurveAccount(
      1n,
      g.initialVirtualTokenReserves,
      g.initialVirtualSolReserves,
      g.initialRealTokenReserves,
      g.initialVirtualSolReserves,
      g.tokenTotalSupply,
      false
    );
  }

  getBuyPrices(amounts: bigint[]): bigint[] {
    if (this.complete) {
      throw new Error("Curve is complete");
    }

    const results: bigint[] = [];
    let currentVirtualTokenReserves = this.virtualTokenReserves;
    let currentVirtualSolReserves = this.virtualSolReserves;
    let currentRealTokenReserves = this.realTokenReserves;

    for (let amount of amounts) {
      if (amount <= 0n) {
        results.push(0n);
        continue;
      }
      console.log(`reserve`, currentVirtualSolReserves, currentVirtualTokenReserves);

      // Calculate the product of current virtual reserves
      let n = currentVirtualSolReserves * currentVirtualTokenReserves;

      // Calculate the new virtual sol reserves after the purchase
      let i = currentVirtualSolReserves + amount;

      // Calculate the new virtual token reserves after the purchase
      let r = n / i + 1n;

      // Calculate the amount of tokens to be purchased
      let s = currentVirtualTokenReserves - r;

      // Determine the minimum between calculated and available real tokens
      let buyAmount = s < currentRealTokenReserves ? s : currentRealTokenReserves;

      // Add result to the array
      results.push(buyAmount);

      // Update reserves for the next iteration
      currentVirtualSolReserves = i; // New SOL reserves after purchase
      currentVirtualTokenReserves = r; // New token reserves after purchase
      currentRealTokenReserves -= buyAmount; // Reduce real token reserves by the amount sold
    }

    return results;
  }
}
