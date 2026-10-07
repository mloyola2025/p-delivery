create table if not exists courier_users (
  id text primary key,
  username text not null,
  full_name text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists courier_users_username_lower_idx
  on courier_users (lower(username));
create index if not exists courier_users_active_idx
  on courier_users (active, full_name);

alter table push_subscriptions add column if not exists account_id text;
create index if not exists push_subscriptions_account_idx
  on push_subscriptions (account_id, active);

alter table courier_users enable row level security;
revoke all on courier_users from anon, authenticated;
