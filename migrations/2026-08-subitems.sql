-- =============================================================
--  升級：重複排程與單一行程也能加子事項
--  用法：Supabase → SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會動到既有資料。
--
--  子事項的「定義」存在排程／行程自己身上（subtasks），
--  「哪一天勾了哪一項」則另外記在 sub_done——因為重複排程會在很多天
--  出現，勾選必須逐次計算，否則今天勾完，明天再看還是勾的。
--  這跟項目本身的完成走 completions 是同一個道理。
-- =============================================================

create extension if not exists pgcrypto;

alter table public.schedules add column if not exists subtasks jsonb not null default '[]'::jsonb;
alter table public.events    add column if not exists subtasks jsonb not null default '[]'::jsonb;
-- 上面兩個欄位存的是 [{id, title}]，沒有 done——done 是逐日的，在下面這張表。

create table if not exists public.sub_done (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null,                                    -- 排程或行程的 id
  item_kind  text not null check (item_kind in ('schedule','event')),
  sub_id     text not null,                                    -- subtasks[].id
  occur_date date not null,                                    -- 哪一天勾的
  created_at timestamptz not null default now(),
  unique (user_id, item_id, sub_id, occur_date)
);

create index if not exists sub_done_lookup on public.sub_done (user_id, occur_date);
create index if not exists sub_done_item   on public.sub_done (user_id, item_id);

-- Row Level Security：只讀得到自己的資料
alter table public.sub_done enable row level security;

drop policy if exists own_select on public.sub_done;
drop policy if exists own_insert on public.sub_done;
drop policy if exists own_update on public.sub_done;
drop policy if exists own_delete on public.sub_done;

create policy own_select on public.sub_done for select using (auth.uid() = user_id);
create policy own_insert on public.sub_done for insert with check (auth.uid() = user_id);
create policy own_update on public.sub_done for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_delete on public.sub_done for delete using (auth.uid() = user_id);
