-- =============================================================
--  升級：每月排程可指定「第幾個星期幾」
--  用法：Supabase → SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會動到既有資料。
-- =============================================================

-- 'day' = 每月幾號（既有行為）；'nth' = 每月第 N 個星期幾
alter table public.schedules add column if not exists month_mode    text;
-- 1..4 = 第一～第四個；-1 = 最後一個
alter table public.schedules add column if not exists week_of_month int;

-- 既有的每月排程都是「幾號」
update public.schedules
   set month_mode = 'day'
 where month_mode is null
   and (freq = 'monthly' or (freq = 'custom' and custom_unit = 'month'));

alter table public.schedules drop constraint if exists schedules_month_mode_check;
alter table public.schedules add  constraint schedules_month_mode_check
  check (month_mode is null or month_mode in ('day','nth'));

alter table public.schedules drop constraint if exists schedules_week_of_month_check;
alter table public.schedules add  constraint schedules_week_of_month_check
  check (week_of_month is null or week_of_month in (1,2,3,4,-1));
