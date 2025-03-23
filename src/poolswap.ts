import { Program, Provider } from "@coral-xyz/anchor";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PumpSwap, IDL_SWAP } from "./IDL";

const PUMP_AMM_PROGRAM_ID: PublicKey = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const WSOL_TOKEN_ACCOUNT: PublicKey = new PublicKey("So11111111111111111111111111111111111111112");

interface Pool {
  address: PublicKey;
  is_native_base: boolean;
  poolData: any;
}

interface PoolWithPrice extends Pool {
  price: number;
  reserves: {
    native: number;
    token: number;
  };
}

export class PumpSwapPool {
  public program: Program<PumpSwap>;
  public connection: Connection;
  constructor(provider?: Provider) {
    this.program = new Program<PumpSwap>(IDL_SWAP as PumpSwap, provider);
    this.connection = this.program.provider.connection;
  }

  public async getPoolsWithBaseMint(mintAddress: PublicKey) {
    const response = await this.connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, {
      filters: [
        { dataSize: 211 },
        {
          memcmp: {
            offset: 43,
            bytes: mintAddress.toBase58(),
          },
        },
      ],
      commitment: "confirmed",
    });

    const mappedPools = response.map((pool) => {
      const data = Buffer.from(pool.account.data);
      const poolData = this.program.coder.accounts.decode("pool", data);
      return {
        address: pool.pubkey,
        is_native_base: false,
        poolData,
      };
    });

    return mappedPools;
  }

  public async getPoolsWithQuoteMint(mintAddress: PublicKey) {
    const response = await this.connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, {
      filters: [
        { dataSize: 211 },
        {
          memcmp: {
            offset: 75,
            bytes: mintAddress.toBase58(),
          },
        },
      ],
      commitment: "confirmed",
    });

    const mappedPools = response.map((pool) => {
      const data = Buffer.from(pool.account.data);
      const poolData = this.program.coder.accounts.decode("pool", data);
      return {
        address: pool.pubkey,
        is_native_base: true,
        poolData,
      };
    });

    return mappedPools;
  }

  public async getPoolsWithBaseMintQuoteWSOL(mintAddress: PublicKey) {
    const response = await this.connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, {
      filters: [
        { dataSize: 211 },
        {
          memcmp: {
            offset: 43,
            bytes: mintAddress.toBase58(),
          },
        },
        {
          memcmp: {
            offset: 75,
            bytes: WSOL_TOKEN_ACCOUNT.toBase58(),
          },
        },
      ],
    });

    const mappedPools = response.map((pool) => {
      const data = Buffer.from(pool.account.data);
      const poolData = this.program.coder.accounts.decode("pool", data);
      return {
        address: pool.pubkey,
        is_native_base: true,
        poolData,
      };
    });

    return mappedPools;
  }

  public async getPriceAndLiquidity(pool: Pool) {
    const wsolAddress = pool.poolData.poolQuoteTokenAccount;
    const tokenAddress = pool.poolData.poolBaseTokenAccount;

    const [wsolBalance, tokenBalance] = await Promise.all([
      this.connection.getTokenAccountBalance(wsolAddress, "confirmed"),
      this.connection.getTokenAccountBalance(tokenAddress, "confirmed"),
    ]);

    const price = wsolBalance.value.uiAmount! / tokenBalance.value.uiAmount!;

    return {
      ...pool,
      price,
      reserves: {
        native: wsolBalance.value.uiAmount!,
        token: tokenBalance.value.uiAmount!,
      },
    } as PoolWithPrice;
  }

  public async getPoolDataFromPoolId(poolId: PublicKey) {
    const accountInfo = await this.connection.getAccountInfo(poolId, "confirmed");

    if (!accountInfo?.data) return;
    const data = Buffer.from(accountInfo?.data!);
    const poolData = this.program.coder.accounts.decode("pool", data);
    const pool = {
      address: poolId,
      is_native_base: false,
      poolData,
    } as Pool;

    return pool;
  }

  public async getPoolsWithPrices(mintAddress: PublicKey) {
    const [poolsWithBaseMint, poolsWithQuoteMint] = await Promise.all([this.getPoolsWithBaseMint(mintAddress), this.getPoolsWithQuoteMint(mintAddress)]);
    //const poolsWithBaseMinQuoteWSOL = await getPoolsWithBaseMintQuoteWSOL(mintAddress)
    const pools = [...poolsWithBaseMint, ...poolsWithQuoteMint];

    const results = await Promise.all(pools.map((pool) => this.getPriceAndLiquidity(pool)));

    const sortedByHighestLiquidity = results.sort((a, b) => b.reserves.native - a.reserves.native);

    return sortedByHighestLiquidity;
  }

  public async getBuyTokenAmount(solAmount: bigint, mint: PublicKey, pool?: PoolWithPrice) {
    let poolDetail = pool;

    if (!poolDetail) {
      const pool_detail = await this.getPoolsWithPrices(mint);
      if (pool_detail.length == 0) {
        throw new Error(`Unable to find pool ${mint.toBase58()}`);
      }
      poolDetail = pool_detail[0];
    }

    const sol_reserve = BigInt(poolDetail.reserves.native * LAMPORTS_PER_SOL);
    const token_reserve = BigInt(poolDetail.reserves.token * 10 ** 6);
    const product = sol_reserve * token_reserve;
    let new_sol_reserve = sol_reserve + solAmount;
    let new_token_reserve = product / new_sol_reserve + 1n;
    let amount_to_be_purchased = token_reserve - new_token_reserve;
    console.log("Pool address", poolDetail.address.toBase58(), "sol amount", solAmount, "amount to be purchased", amount_to_be_purchased);
    return amount_to_be_purchased;
  }

  public async getSellTokenAmount(tokenAmount: bigint, mint: PublicKey, pool?: PoolWithPrice) {
    let poolDetail = pool;

    if (!poolDetail) {
      const pool_detail = await this.getPoolsWithPrices(mint);
      if (pool_detail.length == 0) {
        throw new Error(`Unable to find pool ${mint.toBase58()}`);
      }
      poolDetail = pool_detail[0];
    }

    const sol_reserve = BigInt(poolDetail.reserves.native * LAMPORTS_PER_SOL);
    const token_reserve = BigInt(poolDetail.reserves.token * 10 ** 6);
    const product = sol_reserve * token_reserve;
    let new_token_reserve = token_reserve + tokenAmount;
    let new_sol_reserve = product / new_token_reserve + 1n;
    let sol_amount_to_receive = sol_reserve - new_sol_reserve;
    console.log("Pool address", poolDetail.address.toBase58(), "token amount", tokenAmount, "sol amount to receive", sol_amount_to_receive);
    return sol_amount_to_receive;
  }

  public async getPumpSwapPool(mint: PublicKey) {
    const pools = await this.getPoolsWithBaseMintQuoteWSOL(mint);
    console.log(
      "Pools:",
      pools.map((pool) => pool.address.toBase58())
    );
    return pools[0].address;
  }

  public async getPrice(mint: PublicKey) {
    const pools = await this.getPoolsWithPrices(mint);
    return pools[0].price;
  }
}
