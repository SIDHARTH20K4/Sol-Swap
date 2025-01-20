use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, Token, Mint, Transfer, MintTo},
    associated_token::AssociatedToken,
};

declare_id!("5G8kSEHwJ8ofQdc7MBJee9Wn1XogYuiAK1cesU4K2moc");

#[program]
pub mod token_swap {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        pool_bump: u8,
        fee_rate: u64
    ) -> Result<()> {
        require!(fee_rate <= 10000, SwapError::InvalidFeeRate);
        
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.token_a_mint = ctx.accounts.token_a_mint.key();
        pool.token_b_mint = ctx.accounts.token_b_mint.key();
        pool.token_a_account = ctx.accounts.token_a_account.key();
        pool.token_b_account = ctx.accounts.token_b_account.key();
        pool.pool_mint = ctx.accounts.pool_mint.key();
        pool.fee_rate = fee_rate;
        pool.bump = pool_bump;

        // Initialize pool mint authority
        let seeds = &[b"pool".as_ref(), &[pool_bump]];
        let signer = [&seeds[..]];

        // Initialize mint with pool PDA as mint authority
        token::initialize_mint(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::InitializeMint {
                    mint: ctx.accounts.pool_mint.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
            ),
            6, // decimals
            pool.to_account_info().key,
            Some(pool.to_account_info().key),
        )?;

        Ok(())
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64
    ) -> Result<()> {
        require!(amount_a > 0 && amount_b > 0, SwapError::InvalidAmount);

        // Transfer token A from user to pool
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.pool_token_a.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_a,
        )?;

        // Transfer token B from user to pool
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.pool_token_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_b,
        )?;

        // Calculate pool tokens to mint
        let pool_tokens = calculate_pool_tokens(
            amount_a,
            amount_b,
            ctx.accounts.pool_token_a.amount,
            ctx.accounts.pool_token_b.amount,
        )?;
        require!(pool_tokens > 0, SwapError::InvalidAmount);

        // Mint pool tokens to user
        let seeds = &[b"pool".as_ref(), &[ctx.accounts.pool.bump]];
        let signer = [&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.pool_mint.to_account_info(),
                    to: ctx.accounts.user_pool_token.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &signer,
            ),
            pool_tokens,
        )?;

        Ok(())
    }

    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        minimum_amount_out: u64
    ) -> Result<()> {
        require!(amount_in > 0, SwapError::InvalidAmount);

        let amount_out = calculate_swap_output(
            amount_in,
            ctx.accounts.pool_token_in.amount,
            ctx.accounts.pool_token_out.amount,
            ctx.accounts.pool.fee_rate,
        )?;

        require!(amount_out >= minimum_amount_out, SwapError::SlippageExceeded);

        // Transfer tokens from user to pool
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_in.to_account_info(),
                    to: ctx.accounts.pool_token_in.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
        )?;

        // Transfer tokens from pool to user
        let seeds = &[b"pool".as_ref(), &[ctx.accounts.pool.bump]];
        let signer = [&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_token_out.to_account_info(),
                    to: ctx.accounts.user_token_out.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &signer,
            ),
            amount_out,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = Pool::LEN,
        seeds = [b"pool"],
        bump
    )]
    pub pool: Account<'info, Pool>,

    pub token_a_mint: Box<Account<'info, token::Mint>>,
    pub token_b_mint: Box<Account<'info, token::Mint>>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_a_mint,
        associated_token::authority = pool,
    )]
    pub token_a_account: Box<Account<'info, token::TokenAccount>>,

    #[account(
        init,
        payer = user,
        associated_token::mint = token_b_mint,
        associated_token::authority = pool,
    )]
    pub token_b_account: Box<Account<'info, token::TokenAccount>>,

    #[account(
        init,
        payer = user,
        mint::decimals = 6,
        mint::authority = pool,
    )]
    pub pool_mint: Box<Account<'info, token::Mint>>,

    pub authority: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(mut,
        constraint = user_token_a.owner == user.key(),
        constraint = user_token_a.mint == pool.token_a_mint
    )]
    pub user_token_a: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = user_token_b.owner == user.key(),
        constraint = user_token_b.mint == pool.token_b_mint
    )]
    pub user_token_b: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = pool_token_a.key() == pool.token_a_account
    )]
    pub pool_token_a: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = pool_token_b.key() == pool.token_b_account
    )]
    pub pool_token_b: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = pool_mint.key() == pool.pool_mint
    )]
    pub pool_mint: Box<Account<'info, token::Mint>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = pool_mint,
        associated_token::authority = user
    )]
    pub user_pool_token: Box<Account<'info, token::TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(mut,
        constraint = user_token_in.owner == user.key()
    )]
    pub user_token_in: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = user_token_out.owner == user.key()
    )]
    pub user_token_out: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = pool_token_in.key() == pool.token_a_account ||
                    pool_token_in.key() == pool.token_b_account
    )]
    pub pool_token_in: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = pool_token_out.key() == pool.token_a_account ||
                    pool_token_out.key() == pool.token_b_account,
        constraint = pool_token_in.key() != pool_token_out.key()
    )]
    pub pool_token_out: Box<Account<'info, token::TokenAccount>>,

    pub token_program: Program<'info, Token>
}

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_account: Pubkey,
    pub token_b_account: Pubkey,
    pub pool_mint: Pubkey,
    pub fee_rate: u64,
    pub bump: u8
}

impl Pool {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 32 + 32 + 8 + 1;
}

#[error_code]
pub enum SwapError {
    SlippageExceeded,
    InvalidAmount,
    InvalidFeeRate,
    CalculationError,
}

// Custom square root implementation for u128
fn isqrt(value: u128) -> u64 {
    if value < 2 {
        return value as u64;
    }
    let mut x = value;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + value / x) / 2;
    }
    x as u64
}

// Updated pool token calculation
fn calculate_pool_tokens(
    amount_a: u64,
    amount_b: u64,
    reserve_a: u64,
    reserve_b: u64,
) -> Result<u64> {
    if reserve_a == 0 || reserve_b == 0 {
        // Initial liquidity provision
        let product = (amount_a as u128).checked_mul(amount_b as u128)
            .ok_or(SwapError::CalculationError)?;
        Ok(isqrt(product))
    } else {
        // Subsequent liquidity provisions
        let min_pool_tokens = std::cmp::min(
            amount_a.checked_mul(1_000_000)
                .ok_or(SwapError::CalculationError)?
                .checked_div(reserve_a)
                .ok_or(SwapError::CalculationError)?,
            amount_b.checked_mul(1_000_000)
                .ok_or(SwapError::CalculationError)?
                .checked_div(reserve_b)
                .ok_or(SwapError::CalculationError)?
        );
        Ok(min_pool_tokens)
    }
}

fn calculate_swap_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_rate: u64
) -> Result<u64> {
    let amount_in_with_fee = amount_in
        .checked_mul(10000 - fee_rate).unwrap()
        .checked_div(10000).unwrap();

    let numerator = amount_in_with_fee
        .checked_mul(reserve_out).unwrap();
    
    let denominator = reserve_in
        .checked_mul(10000).unwrap()
        .checked_add(amount_in_with_fee).unwrap();

    Ok(numerator.checked_div(denominator).unwrap())
}

//pubKey : DUPr67iePKRfPNUhToqZePLkuD8KaWSVbCjtkN4Pfrir
//Program Id: BWBhKYGCj2zj2Mb1QH5LdNKwG8dME2GRTKnNU6QxSdLm
//Deploy Signature: 3onHBP51S8DmVYQ3qmZhzKoVoo5TXyfLcbe3kbKRXF489aAJYvimas6PmHzZbgCqsdAnjsfTicPnRpYcJ4hoa5vo