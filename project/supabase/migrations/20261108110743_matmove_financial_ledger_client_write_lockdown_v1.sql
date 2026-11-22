
revoke insert, update, delete on table
  public.currency_rates,
  public.ledger_accounts,
  public.ledger_entries,
  public.ledger_transactions,
  public.wallet_transactions,
  public.payment_transactions
from authenticated;
