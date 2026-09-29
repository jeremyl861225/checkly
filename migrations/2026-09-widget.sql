-- =============================================================
--  桌面小工具（Scriptable）— 唯讀快照
--  用法：Supabase 專案 → SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會刪除既有資料。
--
--  一人一列。App 每次變更後把「已經展開好的事項」寫進 payload；
--  小工具帶 token 打 Edge Function `widget` 換這一列的內容，不必登入。
--  重複排程的展開規則留在 App（唯一真相），這裡只存結果。
-- =============================================================

create table if not exists public.widget_feeds (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  token      text not null unique,          -- 小工具網址上的鑰匙，可隨時重新產生
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.widget_feeds enable row level security;

drop policy if exists own_select on public.widget_feeds;
drop policy if exists own_insert on public.widget_feeds;
drop policy if exists own_update on public.widget_feeds;
drop policy if exists own_delete on public.widget_feeds;

create policy own_select on public.widget_feeds for select using (auth.uid() = user_id);
create policy own_insert on public.widget_feeds for insert with check (auth.uid() = user_id);
create policy own_update on public.widget_feeds for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_delete on public.widget_feeds for delete using (auth.uid() = user_id);
