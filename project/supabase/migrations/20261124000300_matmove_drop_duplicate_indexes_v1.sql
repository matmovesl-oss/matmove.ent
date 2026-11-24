begin;

-- These two indexes have the same columns, ordering and uniqueness coverage
-- as retained indexes. The wallets unique constraint remains the source of
-- truth for one wallet per (user_id, currency).

drop index public.concierge_interests_customer_created_idx;
drop index public.wallets_one_wallet_per_user_currency_idx;

commit;
