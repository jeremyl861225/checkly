-- =============================================================
--  升級：近期任務（一次性任務 + 子任務）
--  用法：Supabase → SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會動到既有資料。
-- =============================================================

create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  description  text default '',
  due_date     date,            -- 截止日（選填，null = 未定）
  category     text default '',
  important    boolean not null default false,      -- 重大事件
  done         boolean not null default false,
  completed_at timestamptz,     -- 勾完成的時間；取消再勾會換成新的時間
  subtasks     jsonb not null default '[]'::jsonb,  -- [{id, title, done}]
  links        jsonb not null default '[]'::jsonb,  -- [{name, url}]
  created_at   timestamptz not null default now()
);

-- 舊版本已建過表時補欄位（同樣可重複執行）
alter table public.tasks add column if not exists due_date     date;
alter table public.tasks add column if not exists important    boolean not null default false;
alter table public.tasks add column if not exists done         boolean not null default false;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists subtasks     jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists links        jsonb not null default '[]'::jsonb;

create index if not exists tasks_user_due  on public.tasks (user_id, due_date);
create index if not exists tasks_user_done on public.tasks (user_id, done, completed_at);

-- Row Level Security：只讀得到自己的任務
alter table public.tasks enable row level security;

drop policy if exists own_select on public.tasks;
drop policy if exists own_insert on public.tasks;
drop policy if exists own_update on public.tasks;
drop policy if exists own_delete on public.tasks;

create policy own_select on public.tasks for select using (auth.uid() = user_id);
create policy own_insert on public.tasks for insert with check (auth.uid() = user_id);
create policy own_update on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_delete on public.tasks for delete using (auth.uid() = user_id);
