-- Wheat2Wealth — schéma Supabase
-- À coller dans Supabase > SQL Editor > New query, puis "Run".

create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists saves (
  account_id uuid primary key references accounts(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  best_score numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Row Level Security : activée, mais aucune "policy" n'est créée pour l'accès
-- public. Le serveur Next.js utilise la clé "service role", qui contourne
-- systématiquement RLS — c'est donc lui, et uniquement lui, qui peut lire ou
-- écrire ces tables. Le navigateur du joueur n'a jamais cette clé.
alter table accounts enable row level security;
alter table saves enable row level security;
