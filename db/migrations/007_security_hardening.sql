create table if not exists auth_rate_limits (
  key text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists auth_rate_limits_updated_idx
  on auth_rate_limits (updated_at);

alter table admin_credentials enable row level security;
alter table orders enable row level security;
alter table inventory enable row level security;
alter table app_settings enable row level security;
alter table order_photos enable row level security;
alter table auth_rate_limits enable row level security;

revoke all on admin_credentials from anon, authenticated;
revoke all on orders from anon, authenticated;
revoke all on inventory from anon, authenticated;
revoke all on app_settings from anon, authenticated;
revoke all on order_photos from anon, authenticated;
revoke all on auth_rate_limits from anon, authenticated;
