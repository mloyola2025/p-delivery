create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null,
  account_id text,
  device_id text not null,
  provider text not null default 'fcm',
  token text not null unique,
  platform text,
  browser text,
  device_name text,
  user_agent text,
  permission_status text not null default 'default',
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  last_token_refresh_at timestamptz not null default now(),
  last_notification_sent_at timestamptz,
  last_notification_opened_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);
create index if not exists push_subscriptions_user_active_idx on push_subscriptions (user_id, active);
create index if not exists push_subscriptions_last_seen_idx on push_subscriptions (last_seen_at);

create table if not exists notifications (
  id text primary key,
  user_id text not null,
  business_id text,
  type text not null,
  title text not null,
  message text not null,
  entity_type text,
  entity_id text,
  target_url text not null default '/',
  priority text not null default 'normal',
  status text not null default 'created',
  idempotency_key text unique,
  read_at timestamptz,
  opened_at timestamptz,
  acknowledged_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);

create table if not exists notification_delivery_attempts (
  id text primary key,
  notification_id text not null references notifications(id) on delete cascade,
  push_subscription_id text references push_subscriptions(id) on delete set null,
  provider text not null default 'fcm',
  status text not null,
  provider_message_id text,
  error_code text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notification_attempts_notification_idx on notification_delivery_attempts (notification_id);

create table if not exists notification_preferences (
  id text primary key,
  user_id text not null,
  event_type text not null,
  internal_enabled boolean not null default true,
  push_enabled boolean not null default true,
  email_enabled boolean not null default false,
  critical_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_type)
);

create table if not exists notification_audit (
  id text primary key,
  event text not null,
  actor text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Estas tablas son exclusivamente server-side. El propietario de la conexión
-- PostgreSQL usada por las Route Handlers puede acceder; PostgREST queda denegado.
alter table push_subscriptions enable row level security;
alter table notifications enable row level security;
alter table notification_delivery_attempts enable row level security;
alter table notification_preferences enable row level security;
alter table notification_audit enable row level security;

revoke all on push_subscriptions from anon, authenticated;
revoke all on notifications from anon, authenticated;
revoke all on notification_delivery_attempts from anon, authenticated;
revoke all on notification_preferences from anon, authenticated;
revoke all on notification_audit from anon, authenticated;
