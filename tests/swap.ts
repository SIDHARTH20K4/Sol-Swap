import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Swap } from "../target/types/swap";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

describe("swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Swap as Program<Swap>;

  // Generate keypairs for accounts
  const pool = anchor.web3.Keypair.generate();
  const tokenAMint = anchor.web3.Keypair.generate();
  const tokenBMint = anchor.web3.Keypair.generate();
  const authority = anchor.web3.Keypair.generate();

  // Declare variables for token accounts
  let tokenAAccount: PublicKey;
  let tokenBAccount: PublicKey;
  let poolMint: PublicKey;
  let userTokenAAccount: PublicKey;
  let userTokenBAccount: PublicKey;
  let userPoolTokenAccount: PublicKey;

  before(async () => {
    // Create mints for token A and token B
    await createMint(provider.connection, authority, authority.publicKey, null, 6, tokenAMint);
    await createMint(provider.connection, authority, authority.publicKey, null, 6, tokenBMint);

    // Create associated token accounts for the user
    tokenAAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      tokenAMint.publicKey,
      provider.wallet.publicKey
    ).then((account) => account.address);

    tokenBAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      tokenBMint.publicKey,
      provider.wallet.publicKey
    ).then((account) => account.address);

    // Mint tokens to the user's token accounts
    await mintTo(
      provider.connection,
      authority,
      tokenAMint.publicKey,
      tokenAAccount,
      authority,
      1000000000 // 1000 tokens (assuming 6 decimals)
    );

    await mintTo(
      provider.connection,
      authority,
      tokenBMint.publicKey,
      tokenBAccount,
      authority,
      1000000000 // 1000 tokens (assuming 6 decimals)
    );
  });

  it("Initializes the pool", async () => {
    const poolBump = 0; // Replace with the actual bump if using PDA
    const feeRate = 100; // 1% fee rate

    await program.methods
      .initializePool(poolBump, feeRate)
      .accounts({
        pool: pool.publicKey,
        tokenAMint: tokenAMint.publicKey,
        tokenBMint: tokenBMint.publicKey,
        tokenAAccount: tokenAAccount,
        tokenBAccount: tokenBAccount,
        poolMint: poolMint,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([pool, authority])
      .rpc();

    // Fetch the pool account and verify its state
    const poolAccount = await program.account.pool.fetch(pool.publicKey);
    assert.equal(poolAccount.authority.toString(), authority.publicKey.toString());
    assert.equal(poolAccount.feeRate, feeRate);
  });

  it("Adds liquidity to the pool", async () => {
    const amountA = 1000000; // 1 token A
    const amountB = 1000000; // 1 token B

    await program.methods
      .addLiquidity(amountA, amountB)
      .accounts({
        pool: pool.publicKey,
        user: provider.wallet.publicKey,
        userTokenA: tokenAAccount,
        userTokenB: tokenBAccount,
        poolTokenA: tokenAAccount,
        poolTokenB: tokenBAccount,
        poolMint: poolMint,
        userPoolToken: userPoolTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Fetch the user's pool token account and verify the balance
    const userPoolTokenBalance = await provider.connection.getTokenAccountBalance(userPoolTokenAccount);
    assert.isAbove(Number(userPoolTokenBalance.value.amount), 0);
  });

  it("Swaps tokens", async () => {
    const amountIn = 100000; // 0.1 token A
    const minimumAmountOut = 90000; // 0.09 token B (assuming a 10% fee)

    await program.methods
      .swap(amountIn, minimumAmountOut)
      .accounts({
        pool: pool.publicKey,
        user: provider.wallet.publicKey,
        userTokenIn: tokenAAccount,
        userTokenOut: tokenBAccount,
        poolTokenIn: tokenAAccount,
        poolTokenOut: tokenBAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Fetch the user's token accounts and verify the balances
    const userTokenABalance = await provider.connection.getTokenAccountBalance(tokenAAccount);
    const userTokenBBalance = await provider.connection.getTokenAccountBalance(tokenBAccount);
    assert.isBelow(Number(userTokenABalance.value.amount), 1000000000); // Token A balance should decrease
    assert.isAbove(Number(userTokenBBalance.value.amount), 1000000000); // Token B balance should increase
  });
});