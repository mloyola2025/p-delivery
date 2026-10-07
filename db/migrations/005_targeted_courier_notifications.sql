alter table notifications add column if not exists account_id text;

create index if not exists notifications_account_created_idx
  on notifications (account_id, created_at desc);
