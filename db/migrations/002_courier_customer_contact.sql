create table if not exists courier_location_events (
  id text primary key,
  courier_id text not null,
  route_id text,
  order_id text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters >= 0),
  source text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists courier_location_recent_idx
  on courier_location_events (courier_id, captured_at desc);
create index if not exists courier_location_order_idx
  on courier_location_events (order_id, captured_at desc);

create table if not exists customer_contact_events (
  id text primary key,
  order_id text not null,
  route_id text,
  courier_id text not null,
  business_id text not null,
  channel text not null default 'whatsapp',
  event_type text not null,
  phone text not null,
  message_snapshot text not null,
  gps_latitude double precision,
  gps_longitude double precision,
  gps_accuracy_meters double precision,
  calculated_duration_minutes integer,
  eta_start timestamptz,
  eta_end timestamptz,
  route_provider text,
  forced boolean not null default false,
  status text not null default 'prepared',
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists customer_contact_order_created_idx
  on customer_contact_events (order_id, created_at desc);
create index if not exists customer_contact_courier_created_idx
  on customer_contact_events (courier_id, created_at desc);

alter table courier_location_events enable row level security;
alter table customer_contact_events enable row level security;
revoke all on courier_location_events from anon, authenticated;
revoke all on customer_contact_events from anon, authenticated;
