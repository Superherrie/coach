-- Claude API credit tracking: Anthropic has no endpoint for the prepaid balance, so Herman types the balance shown in the
-- Console (Billing) with its date; the app subtracts the cost of every coach call since then (tokens × list price).
alter table tr_settings add column if not exists api_credit_usd numeric;
alter table tr_settings add column if not exists api_credit_at timestamptz;
alter table tr_settings add column if not exists usd_zar numeric default 16.70;
update tr_settings set usd_zar = 16.70 where id = 1 and usd_zar is null;
