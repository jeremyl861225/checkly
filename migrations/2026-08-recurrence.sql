-- =============================================================
--  升級：重複排程加入起訖日與「自訂」頻率；單一行程可跨多日
--  用法：Supabase → SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會動到既有資料。
-- =============================================================

-- 重複排程：結束日、自訂間隔
alter table public.schedules add column if not exists end_date    date;
alter table public.schedules add column if not exists interval_n  int;
alter table public.schedules add column if not exists custom_unit text;

-- 單一行程：多日活動的結束日（null = 單日）
alter table public.events    add column if not exists end_date    date;

-- 既有排程若沒有起始日，補上建立日期（起始日在程式裡已改為必填）
update public.schedules
   set start_date = coalesce(start_date, anchor_date, created_at::date)
 where start_date is null;

-- freq 允許 'custom'；'biweekly' 保留給舊資料，程式會當成「每 2 週」顯示
alter table public.schedules drop constraint if exists schedules_freq_check;
alter table public.schedules add  constraint schedules_freq_check
  check (freq in ('daily','weekly','biweekly','monthly','custom'));

alter table public.schedules drop constraint if exists schedules_custom_unit_check;
alter table public.schedules add  constraint schedules_custom_unit_check
  check (custom_unit is null or custom_unit in ('day','week','month'));

-- 結束日不得早於起始日
alter table public.schedules drop constraint if exists schedules_range_check;
alter table public.schedules add  constraint schedules_range_check
  check (end_date is null or start_date is null or end_date >= start_date);

alter table public.events drop constraint if exists events_range_check;
alter table public.events add  constraint events_range_check
  check (end_date is null or end_date >= date);

-- 跨多日行程的查詢
create index if not exists events_user_range on public.events (user_id, date, end_date);
