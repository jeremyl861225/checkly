-- =============================================================
--  升級：重大事件標記
--  用法：Supabase → SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會動到既有資料。
-- =============================================================

alter table public.schedules add column if not exists important boolean not null default false;
alter table public.events    add column if not exists important boolean not null default false;

-- 只挑重大事件時用得到
create index if not exists schedules_important on public.schedules (user_id) where important;
create index if not exists events_important    on public.events    (user_id) where important;
