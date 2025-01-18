"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const chai_1 = require("chai");
describe("swap", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Swap;
    // Generate keypairs for accounts
    const pool = anchor.web3.Keypair.generate();
    const tokenAMint = anchor.web3.Keypair.generate();
    const tokenBMint = anchor.web3.Keypair.generate();
    const authority = anchor.web3.Keypair.generate();
    // Declare variables for token accounts
    let tokenAAccount;
    let tokenBAccount;
    let poolMint;
    let userTokenAAccount;
    let userTokenBAccount;
    let userPoolTokenAccount;
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        // Create mints for token A and token B
        yield (0, spl_token_1.createMint)(provider.connection, authority, authority.publicKey, null, 6, tokenAMint);
        yield (0, spl_token_1.createMint)(provider.connection, authority, authority.publicKey, null, 6, tokenBMint);
        // Create associated token accounts for the user
        tokenAAccount = yield (0, spl_token_1.getOrCreateAssociatedTokenAccount)(provider.connection, authority, tokenAMint.publicKey, provider.wallet.publicKey).then((account) => account.address);
        tokenBAccount = yield (0, spl_token_1.getOrCreateAssociatedTokenAccount)(provider.connection, authority, tokenBMint.publicKey, provider.wallet.publicKey).then((account) => account.address);
        // Mint tokens to the user's token accounts
        yield (0, spl_token_1.mintTo)(provider.connection, authority, tokenAMint.publicKey, tokenAAccount, authority, 1000000000 // 1000 tokens (assuming 6 decimals)
        );
        yield (0, spl_token_1.mintTo)(provider.connection, authority, tokenBMint.publicKey, tokenBAccount, authority, 1000000000 // 1000 tokens (assuming 6 decimals)
        );
    }));
    it("Initializes the pool", () => __awaiter(void 0, void 0, void 0, function* () {
        const poolBump = 0; // Replace with the actual bump if using PDA
        const feeRate = 100; // 1% fee rate
        yield program.methods
            .initializePool(poolBump, feeRate)
            .accounts({
            pool: pool.publicKey,
            tokenAMint: tokenAMint.publicKey,
            tokenBMint: tokenBMint.publicKey,
            tokenAAccount: tokenAAccount,
            tokenBAccount: tokenBAccount,
            poolMint: poolMint,
            authority: authority.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
            .signers([pool, authority])
            .rpc();
        // Fetch the pool account and verify its state
        const poolAccount = yield program.account.pool.fetch(pool.publicKey);
        chai_1.assert.equal(poolAccount.authority.toString(), authority.publicKey.toString());
        chai_1.assert.equal(poolAccount.feeRate, feeRate);
    }));
    it("Adds liquidity to the pool", () => __awaiter(void 0, void 0, void 0, function* () {
        const amountA = 1000000; // 1 token A
        const amountB = 1000000; // 1 token B
        yield program.methods
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
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
            .rpc();
        // Fetch the user's pool token account and verify the balance
        const userPoolTokenBalance = yield provider.connection.getTokenAccountBalance(userPoolTokenAccount);
        chai_1.assert.isAbove(Number(userPoolTokenBalance.value.amount), 0);
    }));
    it("Swaps tokens", () => __awaiter(void 0, void 0, void 0, function* () {
        const amountIn = 100000; // 0.1 token A
        const minimumAmountOut = 90000; // 0.09 token B (assuming a 10% fee)
        yield program.methods
            .swap(amountIn, minimumAmountOut)
            .accounts({
            pool: pool.publicKey,
            user: provider.wallet.publicKey,
            userTokenIn: tokenAAccount,
            userTokenOut: tokenBAccount,
            poolTokenIn: tokenAAccount,
            poolTokenOut: tokenBAccount,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        })
            .rpc();
        // Fetch the user's token accounts and verify the balances
        const userTokenABalance = yield provider.connection.getTokenAccountBalance(tokenAAccount);
        const userTokenBBalance = yield provider.connection.getTokenAccountBalance(tokenBAccount);
        chai_1.assert.isBelow(Number(userTokenABalance.value.amount), 1000000000); // Token A balance should decrease
        chai_1.assert.isAbove(Number(userTokenBBalance.value.amount), 1000000000); // Token B balance should increase
    }));
});
