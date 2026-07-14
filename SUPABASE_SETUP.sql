
-- Run this in your Supabase SQL Editor to create the necessary table

-- Create the enum for status
create type item_status as enum ('in_stock', 'sold');
create type item_condition as enum ('nuevo', 'semi_uso', 'usado');

create table items (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  date timestamptz default now(), -- The actual purchase/acquisition date
  product_name text not null,
  purchase_price numeric not null default 0,
  sale_price numeric,
  quantity integer not null default 1,
  sale_date timestamptz,
  status item_status not null default 'in_stock',
  item_condition item_condition not null default 'nuevo',
  batch_ref text
);

-- If your table already exists, run these too:
alter table items
add column if not exists item_condition item_condition not null default 'nuevo';

alter table items
add column if not exists batch_ref text;

alter table items
add column if not exists location text;

alter table items
add column if not exists estimated_sale_price numeric;

alter table items
add column if not exists publish_urls text;

-- Enable Row Level Security (RLS)
alter table items enable row level security;

-- Políticas seguras: usuarios autenticados acceso total,
-- anónimos solo lectura de productos publicados en la tienda
drop policy if exists "Allow public access" on items;

create policy "Authenticated full access" on items
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Public store read" on items
  for select
  to anon
  using (public_in_store = true and status = 'in_stock');
-- Create the batches table for history
create table if not exists batches (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  batch_code text not null,
  batch_type text not null,
  total_paid numeric not null default 0,
  total_sell_revenue numeric not null default 0,
  cash_profit numeric not null default 0,
  retained_value numeric not null default 0,
  items_count integer not null default 0,
  items_json jsonb not null default '[]'::jsonb
);

-- Enable RLS for batches
alter table batches enable row level security;

-- Batches: solo usuarios autenticados (la tienda pública no la usa)
drop policy if exists "Allow public access for batches" on batches;

create policy "Authenticated full access batches" on batches
  for all
  to authenticated
  using (true)
  with check (true);

-- =====================================================
-- TIENDA PÚBLICA
-- =====================================================
alter table items add column if not exists public_in_store boolean not null default false;
alter table items add column if not exists store_images jsonb default '[]';
alter table items add column if not exists store_video_url text;
alter table items add column if not exists description text;
alter table items add column if not exists store_title text;
alter table items add column if not exists store_group text;
alter table items add column if not exists store_variant_name text;

-- New columns for categories and batch status
alter table items add column if not exists category text;
alter table batches add column if not exists batch_status text not null default 'completado';

-- =========================================================================
-- SUPABASE STORAGE SETUP FOR PRODUCT IMAGES & VIDEOS
-- =========================================================================

-- 1. Create the bucket for product images (if it doesn't exist)
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- 2. Create policy to allow public select (read/list)
-- Anyone can view product images/videos in the store or dashboard
create policy "Allow public read of product-images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

-- 3. Create policy to allow inserts (uploads)
-- Covers both images and videos uploaded to this bucket
create policy "Allow public uploads to product-images"
on storage.objects for insert
to public
with check (bucket_id = 'product-images');

-- 4. Create policy to allow deletes (for cleaning up unused store files)
-- Restricted to authenticated users since it's a dashboard operation
create policy "Allow authenticated delete from product-images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images');

