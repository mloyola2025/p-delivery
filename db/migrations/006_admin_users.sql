create table if not exists admin_users (
  id text primary key,
  username text not null,
  full_name text not null,
  role text not null check (role in ('suyai', 'aura')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_users_username_lower_idx
  on admin_users (lower(username));
create index if not exists admin_users_role_active_idx
  on admin_users (role, active, full_name);

alter table admin_users enable row level security;
revoke all on admin_users from anon, authenticated;
