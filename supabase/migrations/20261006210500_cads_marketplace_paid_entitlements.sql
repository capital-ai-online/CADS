create table if not exists public.cads_marketplace_entitlements (
  account_id bigint primary key check (account_id > 0),
  account_login text not null check (length(account_login) between 1 and 255),
  account_type text not null check (account_type in ('User','Organization')),
  marketplace_plan_id bigint not null check (marketplace_plan_id > 0),
  tier text not null check (tier in ('starter','pro','enterprise')),
  status text not null check (status in ('ACTIVE','CANCELLED')),
  effective_at timestamptz not null,
  cancelled_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((status = 'ACTIVE' and cancelled_at is null) or status = 'CANCELLED')
);

create table if not exists public.cads_marketplace_event_inbox (
  delivery_id text primary key check (length(delivery_id) between 8 and 128),
  action text not null check (action in ('purchased','changed','cancelled')),
  account_id bigint not null check (account_id > 0),
  marketplace_plan_id bigint not null check (marketplace_plan_id > 0),
  tier text not null check (tier in ('starter','pro','enterprise')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table if not exists public.cads_marketplace_user_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id bigint not null references public.cads_marketplace_entitlements(account_id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  linked_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, account_id)
);

create index if not exists cads_marketplace_user_links_user_idx
  on public.cads_marketplace_user_links (user_id);

create index if not exists cads_marketplace_entitlements_status_cancelled_idx
  on public.cads_marketplace_entitlements (status, cancelled_at)
  where status = 'CANCELLED';

create index if not exists cads_marketplace_event_inbox_received_idx
  on public.cads_marketplace_event_inbox (received_at);

alter table public.cads_marketplace_entitlements enable row level security;
alter table public.cads_marketplace_event_inbox enable row level security;
alter table public.cads_marketplace_user_links enable row level security;

drop policy if exists cads_marketplace_entitlements_explicit_deny on public.cads_marketplace_entitlements;
create policy cads_marketplace_entitlements_explicit_deny
  on public.cads_marketplace_entitlements for all to anon, authenticated
  using (false) with check (false);

drop policy if exists cads_marketplace_event_inbox_explicit_deny on public.cads_marketplace_event_inbox;
create policy cads_marketplace_event_inbox_explicit_deny
  on public.cads_marketplace_event_inbox for all to anon, authenticated
  using (false) with check (false);

drop policy if exists cads_marketplace_user_links_explicit_deny on public.cads_marketplace_user_links;
create policy cads_marketplace_user_links_explicit_deny
  on public.cads_marketplace_user_links for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.cads_marketplace_entitlements from public, anon, authenticated, service_role;
revoke all on table public.cads_marketplace_event_inbox from public, anon, authenticated, service_role;
revoke all on table public.cads_marketplace_user_links from public, anon, authenticated, service_role;

create or replace function public.capital_ai_apply_cads_marketplace_purchase(
  _delivery_id text,
  _action text,
  _account_id bigint,
  _account_login text,
  _account_type text,
  _marketplace_plan_id bigint,
  _tier text,
  _effective_at timestamptz,
  _payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_inserted integer;
  v_status text;
begin
  if _delivery_id is null or length(_delivery_id) not between 8 and 128
     or _action not in ('purchased','changed','cancelled')
     or _account_id is null or _account_id <= 0
     or _account_login is null or length(_account_login) not between 1 and 255
     or _account_type not in ('User','Organization')
     or _marketplace_plan_id is null or _marketplace_plan_id <= 0
     or _tier not in ('starter','pro','enterprise')
     or _effective_at is null
     or _payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CADS_MARKETPLACE_PURCHASE';
  end if;

  insert into public.cads_marketplace_event_inbox (
    delivery_id, action, account_id, marketplace_plan_id, tier, payload_sha256
  ) values (
    _delivery_id, _action, _account_id, _marketplace_plan_id, _tier, _payload_sha256
  )
  on conflict (delivery_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select status into v_status
      from public.cads_marketplace_entitlements
     where account_id = _account_id;
    return pg_catalog.jsonb_build_object(
      'duplicate', true,
      'status', v_status,
      'tier', _tier
    );
  end if;

  if _action in ('purchased','changed') then
    insert into public.cads_marketplace_entitlements (
      account_id, account_login, account_type, marketplace_plan_id, tier,
      status, effective_at, cancelled_at, updated_at
    ) values (
      _account_id, _account_login, _account_type, _marketplace_plan_id, _tier,
      'ACTIVE', _effective_at, null, pg_catalog.clock_timestamp()
    )
    on conflict (account_id) do update set
      account_login = excluded.account_login,
      account_type = excluded.account_type,
      marketplace_plan_id = excluded.marketplace_plan_id,
      tier = excluded.tier,
      status = 'ACTIVE',
      effective_at = excluded.effective_at,
      cancelled_at = null,
      updated_at = pg_catalog.clock_timestamp();
    v_status := 'ACTIVE';
  else
    insert into public.cads_marketplace_entitlements (
      account_id, account_login, account_type, marketplace_plan_id, tier,
      status, effective_at, cancelled_at, updated_at
    ) values (
      _account_id, _account_login, _account_type, _marketplace_plan_id, _tier,
      'CANCELLED', _effective_at, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    )
    on conflict (account_id) do update set
      account_login = excluded.account_login,
      account_type = excluded.account_type,
      marketplace_plan_id = excluded.marketplace_plan_id,
      tier = excluded.tier,
      status = 'CANCELLED',
      effective_at = excluded.effective_at,
      cancelled_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp();
    v_status := 'CANCELLED';
  end if;

  return pg_catalog.jsonb_build_object(
    'duplicate', false,
    'status', v_status,
    'tier', _tier
  );
end;
$function$;

create or replace function public.capital_ai_link_cads_marketplace_user(
  _user_id uuid,
  _account_id bigint,
  _installation_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_tier text;
begin
  if _user_id is null or _account_id is null or _account_id <= 0
     or _installation_id is null or _installation_id <= 0 then
    raise exception 'INVALID_CADS_MARKETPLACE_USER_LINK';
  end if;

  select tier into v_tier
    from public.cads_marketplace_entitlements
   where account_id = _account_id
     and status = 'ACTIVE';

  if v_tier is null then
    raise exception 'ACTIVE_CADS_MARKETPLACE_ENTITLEMENT_REQUIRED';
  end if;

  insert into public.cads_marketplace_user_links (
    user_id, account_id, installation_id, linked_at, updated_at
  ) values (
    _user_id, _account_id, _installation_id,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
  on conflict (user_id, account_id) do update set
    installation_id = excluded.installation_id,
    updated_at = pg_catalog.clock_timestamp();

  return pg_catalog.jsonb_build_object(
    'linked', true,
    'accountId', _account_id,
    'tier', v_tier
  );
end;
$function$;

create or replace function public.capital_ai_get_cads_marketplace_user_entitlement(_user_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $function$
  select pg_catalog.jsonb_build_object(
    'tier', e.tier,
    'accountId', e.account_id,
    'installationId', l.installation_id,
    'status', e.status
  )
  from public.cads_marketplace_user_links l
  join public.cads_marketplace_entitlements e on e.account_id = l.account_id
  where l.user_id = _user_id
    and e.status = 'ACTIVE'
  order by case e.tier
    when 'enterprise' then 3
    when 'pro' then 2
    when 'starter' then 1
    else 0
  end desc, e.updated_at desc
  limit 1;
$function$;

create or replace function public.capital_ai_get_cads_marketplace_entitlement(_account_id bigint)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $function$
  select pg_catalog.jsonb_build_object(
    'accountId', account_id,
    'tier', tier,
    'status', status,
    'effectiveAt', effective_at,
    'updatedAt', updated_at
  )
  from public.cads_marketplace_entitlements
  where account_id = _account_id;
$function$;

create or replace function public.capital_ai_purge_cads_marketplace_data(_before timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_entitlements integer := 0;
  v_events integer := 0;
begin
  if _before is null or _before > pg_catalog.clock_timestamp() then
    raise exception 'INVALID_CADS_MARKETPLACE_PURGE_BOUNDARY';
  end if;

  delete from public.cads_marketplace_entitlements
   where status = 'CANCELLED'
     and cancelled_at is not null
     and cancelled_at < _before;
  get diagnostics v_entitlements = row_count;

  delete from public.cads_marketplace_event_inbox
   where received_at < _before;
  get diagnostics v_events = row_count;

  return pg_catalog.jsonb_build_object(
    'entitlementsDeleted', v_entitlements,
    'eventsDeleted', v_events,
    'before', _before
  );
end;
$function$;

revoke all on function public.capital_ai_apply_cads_marketplace_purchase(
  text,text,bigint,text,text,bigint,text,timestamptz,text
) from public, anon, authenticated;
revoke all on function public.capital_ai_get_cads_marketplace_entitlement(bigint)
  from public, anon, authenticated;
revoke all on function public.capital_ai_link_cads_marketplace_user(uuid,bigint,bigint)
  from public, anon, authenticated;
revoke all on function public.capital_ai_get_cads_marketplace_user_entitlement(uuid)
  from public, anon, authenticated;
revoke all on function public.capital_ai_purge_cads_marketplace_data(timestamptz)
  from public, anon, authenticated;

grant execute on function public.capital_ai_apply_cads_marketplace_purchase(
  text,text,bigint,text,text,bigint,text,timestamptz,text
) to service_role;
grant execute on function public.capital_ai_get_cads_marketplace_entitlement(bigint)
  to service_role;
grant execute on function public.capital_ai_link_cads_marketplace_user(uuid,bigint,bigint)
  to service_role;
grant execute on function public.capital_ai_get_cads_marketplace_user_entitlement(uuid)
  to service_role;
grant execute on function public.capital_ai_purge_cads_marketplace_data(timestamptz)
  to service_role;

comment on table public.cads_marketplace_entitlements is
  'Service-role-only GitHub Marketplace entitlement state for CADS. No raw webhook payloads or secrets.';
comment on table public.cads_marketplace_event_inbox is
  'Idempotency ledger for CADS marketplace_purchase deliveries; stores only bounded metadata and SHA-256.';

comment on table public.cads_marketplace_user_links is
  'Verified binding between a CAPITAL-AI Supabase user and a GitHub App installation/account with an active CADS Marketplace entitlement.';
