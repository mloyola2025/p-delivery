-- Un mismo PWA puede utilizarse como administrador y como motorizado.
-- El token FCM identifica al navegador, no al rol, por lo que debe poder
-- vincularse a más de una audiencia del mismo dispositivo.
alter table push_subscriptions
  drop constraint if exists push_subscriptions_token_key;

create index if not exists push_subscriptions_token_idx
  on push_subscriptions (token);

