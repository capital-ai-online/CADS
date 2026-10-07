import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrations/20261006210500_cads_marketplace_paid_entitlements.sql', import.meta.url),
  'utf8',
);

test('CADS Marketplace entitlement tables are service-role-only and RLS protected', () => {
  assert.match(sql, /alter table public\.cads_marketplace_entitlements enable row level security/i);
  assert.match(sql, /alter table public\.cads_marketplace_event_inbox enable row level security/i);
  assert.match(sql, /revoke all on table public\.cads_marketplace_entitlements from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.capital_ai_apply_cads_marketplace_purchase[\s\S]*to service_role/i);
});

test('Marketplace purchase application is idempotent by delivery id', () => {
  assert.match(sql, /delivery_id text primary key/i);
  assert.match(sql, /on conflict \(delivery_id\) do nothing/i);
  assert.match(sql, /'duplicate', true/i);
});

test('cancelled Marketplace customer data has an explicit purge path', () => {
  assert.match(sql, /capital_ai_purge_cads_marketplace_data/i);
  assert.match(sql, /status = 'CANCELLED'/i);
  assert.match(sql, /cancelled_at < _before/i);
  assert.match(sql, /delete from public\.cads_marketplace_event_inbox/i);
});

test('Marketplace user links are service-role-only and require an active entitlement', () => {
  assert.match(sql, /create table if not exists public\.cads_marketplace_user_links/i);
  assert.match(sql, /alter table public\.cads_marketplace_user_links enable row level security/i);
  assert.match(sql, /revoke all on table public\.cads_marketplace_user_links from public, anon, authenticated, service_role/i);
  assert.match(sql, /capital_ai_link_cads_marketplace_user/i);
  assert.match(sql, /status = 'ACTIVE'/i);
  assert.match(sql, /ACTIVE_CADS_MARKETPLACE_ENTITLEMENT_REQUIRED/i);
  assert.match(sql, /capital_ai_get_cads_marketplace_user_entitlement/i);
  assert.match(sql, /when 'enterprise' then 3[\s\S]*when 'pro' then 2[\s\S]*when 'starter' then 1/i);
});
