
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

-- Enable Row Level Security (RLS)
alter table items enable row level security;

-- Policy to allow anonymous access (since we are using anon key for simplicity in this demo)
-- Ideally you would authenticate users, but for now:
create policy "Allow public access" 
on items for all 
using (true)
with check (true);
