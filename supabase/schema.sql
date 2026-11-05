-- RecycLedger schema. Run once in Supabase SQL Editor using a project owner account.
create extension if not exists pgcrypto;

create table if not exists public.factories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);

create table if not exists public.factory_members (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','staff')),
  active boolean not null default true,
  unique(factory_id,user_id)
);

create or replace function public.is_factory_admin(fid uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists (
  select 1 from public.factory_members m
  where m.factory_id=fid and m.user_id=auth.uid()
    and m.active=true and m.role in ('owner','admin')
); $$;

create table if not exists public.purchases (
 id uuid primary key default gen_random_uuid(), factory_id uuid not null references factories(id),
 created_by uuid references auth.users(id), party_name text not null, material text not null,
 quantity_kg numeric(14,3) not null check(quantity_kg>0), rate_paise bigint not null check(rate_paise>=0),
 paid_paise bigint not null default 0 check(paid_paise>=0), due_date date, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(factory_id,id)
);
create table if not exists public.production_batches (
 id uuid primary key default gen_random_uuid(), factory_id uuid not null references factories(id),
 created_by uuid references auth.users(id), batch_code text not null, product_name text not null,
 input_kg numeric(14,3) not null check(input_kg>0), output_kg numeric(14,3) not null check(output_kg>=0),
 scrap_kg numeric(14,3) not null default 0 check(scrap_kg>=0),
 raw_material_cost_paise bigint not null default 0 check(raw_material_cost_paise>=0),
 labour_cost_paise bigint not null default 0 check(labour_cost_paise>=0),
 overhead_cost_paise bigint not null default 0 check(overhead_cost_paise>=0),
 notes text, created_at timestamptz not null default now(),
 unique(factory_id,batch_code)
);
create table if not exists public.sales (
 id uuid primary key default gen_random_uuid(), factory_id uuid not null references factories(id),
 created_by uuid references auth.users(id), party_name text not null, invoice_no text not null,
 product_name text not null, quantity_kg numeric(14,3) not null check(quantity_kg>0),
 rate_paise bigint not null check(rate_paise>=0), paid_paise bigint not null default 0 check(paid_paise>=0),
 due_date date, notes text, created_at timestamptz not null default now(),
 unique(factory_id,invoice_no)
);
create table if not exists public.expenses (
 id uuid primary key default gen_random_uuid(), factory_id uuid not null references factories(id),
 created_by uuid references auth.users(id), category text not null, description text,
 amount_paise bigint not null check(amount_paise>0), paid_paise bigint not null default 0 check(paid_paise>=0),
 expense_date date not null default current_date, notes text, created_at timestamptz not null default now()
);
create table if not exists public.workers (
 id uuid primary key default gen_random_uuid(), factory_id uuid not null references factories(id),
 created_by uuid references auth.users(id), full_name text not null, phone text, role_title text,
 daily_wage_paise bigint not null default 0 check(daily_wage_paise>=0), active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.inventory_balances (
 id uuid primary key default gen_random_uuid(), factory_id uuid not null references factories(id),
 item_name text not null, item_type text not null check(item_type in ('raw_material','finished_goods','scrap')),
 quantity_kg numeric(14,3) not null default 0, unit text not null default 'kg',
 unique(factory_id,item_name,item_type)
);

-- Inventory receipts from purchases and finished output from batches.
create or replace function public.purchase_to_inventory()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into inventory_balances(factory_id,item_name,item_type,quantity_kg)
 values(new.factory_id,new.material,'raw_material',new.quantity_kg)
 on conflict(factory_id,item_name,item_type)
 do update set quantity_kg=inventory_balances.quantity_kg+excluded.quantity_kg;
 return new;
end; $$;
drop trigger if exists trg_purchase_inventory on public.purchases;
create trigger trg_purchase_inventory after insert on public.purchases
for each row execute function public.purchase_to_inventory();

create or replace function public.production_to_inventory()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into inventory_balances(factory_id,item_name,item_type,quantity_kg)
 values(new.factory_id,new.product_name,'finished_goods',new.output_kg)
 on conflict(factory_id,item_name,item_type)
 do update set quantity_kg=inventory_balances.quantity_kg+excluded.quantity_kg;
 if new.scrap_kg>0 then
  insert into inventory_balances(factory_id,item_name,item_type,quantity_kg)
  values(new.factory_id,'Production scrap','scrap',new.scrap_kg)
  on conflict(factory_id,item_name,item_type)
  do update set quantity_kg=inventory_balances.quantity_kg+excluded.quantity_kg;
 end if;
 return new;
end; $$;
drop trigger if exists trg_production_inventory on public.production_batches;
create trigger trg_production_inventory after insert on public.production_batches
for each row execute function public.production_to_inventory();

-- Prevent sales that exceed available finished-goods stock; decrement atomically.
create or replace function public.validate_and_deduct_sale()
returns trigger language plpgsql security definer set search_path=public
as $$
declare available numeric(14,3);
begin
 select quantity_kg into available from inventory_balances
 where factory_id=new.factory_id and item_name=new.product_name and item_type='finished_goods'
 for update;
 if coalesce(available,0)<new.quantity_kg then
   raise exception 'Insufficient finished goods inventory. Available: % kg', coalesce(available,0);
 end if;
 update inventory_balances set quantity_kg=quantity_kg-new.quantity_kg
 where factory_id=new.factory_id and item_name=new.product_name and item_type='finished_goods';
 return new;
end; $$;
drop trigger if exists trg_sale_inventory on public.sales;
create trigger trg_sale_inventory before insert on public.sales
for each row execute function public.validate_and_deduct_sale();

-- Financial summary: purchases are excluded from operating expenses; cash and accrual values are distinct.
create or replace view public.financial_summary as
select f.id as factory_id,
 coalesce((select sum(quantity_kg*rate_paise) from sales s where s.factory_id=f.id),0)::bigint as sales_total_paise,
 coalesce((select sum(quantity_kg*rate_paise) from purchases p where p.factory_id=f.id),0)::bigint as purchase_total_paise,
 coalesce((select sum(amount_paise) from expenses e where e.factory_id=f.id),0)::bigint as expense_total_paise,
 coalesce((select sum(raw_material_cost_paise+labour_cost_paise+overhead_cost_paise) from production_batches b where b.factory_id=f.id),0)::bigint as cogs_total_paise,
 (coalesce((select sum(quantity_kg*rate_paise) from sales s where s.factory_id=f.id),0) -
  coalesce((select sum(raw_material_cost_paise+labour_cost_paise+overhead_cost_paise) from production_batches b where b.factory_id=f.id),0))::bigint as gross_profit_paise,
 (coalesce((select sum(quantity_kg*rate_paise) from sales s where s.factory_id=f.id),0) -
  coalesce((select sum(raw_material_cost_paise+labour_cost_paise+overhead_cost_paise) from production_batches b where b.factory_id=f.id),0) -
  coalesce((select sum(amount_paise) from expenses e where e.factory_id=f.id),0))::bigint as net_profit_paise,
 coalesce((select sum(quantity_kg*rate_paise-paid_paise) from sales s where s.factory_id=f.id),0)::bigint as receivables_paise,
 (coalesce((select sum(quantity_kg*rate_paise-paid_paise) from purchases p where p.factory_id=f.id),0) +
  coalesce((select sum(amount_paise-paid_paise) from expenses e where e.factory_id=f.id),0))::bigint as payables_paise,
 (coalesce((select sum(paid_paise) from sales s where s.factory_id=f.id),0))::bigint as cash_received_paise,
 (coalesce((select sum(paid_paise) from purchases p where p.factory_id=f.id),0) +
  coalesce((select sum(paid_paise) from expenses e where e.factory_id=f.id),0))::bigint as cash_paid_paise
from factories f;

-- RLS: owner/admin only. The app intentionally does not expose staff login.
alter table factories enable row level security;
alter table factory_members enable row level security;
alter table purchases enable row level security;
alter table production_batches enable row level security;
alter table sales enable row level security;
alter table expenses enable row level security;
alter table workers enable row level security;
alter table inventory_balances enable row level security;

create policy "members can view own factory" on factories for select using (public.is_factory_admin(id));
create policy "members can view membership" on factory_members for select using (user_id=auth.uid() or public.is_factory_admin(factory_id));
do $$
declare t text;
begin
 foreach t in array array['purchases','production_batches','sales','expenses','workers','inventory_balances'] loop
  execute format('drop policy if exists "admin all %1$s" on public.%1$I',t);
  execute format('create policy "admin all %1$s" on public.%1$I for all using (public.is_factory_admin(factory_id)) with check (public.is_factory_admin(factory_id))',t);
 end loop;
end $$;
grant select on public.financial_summary to authenticated;
