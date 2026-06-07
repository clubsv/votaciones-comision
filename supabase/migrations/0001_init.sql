-- ═══════════════════════════════════════════════════════════════
--  Club Salvadoreño – Sistema de Votación
--  Esquema inicial + Row Level Security
-- ═══════════════════════════════════════════════════════════════
--
--  Modelo de seguridad:
--  Todas las tablas tienen RLS habilitado y NINGUNA política para los
--  roles anon/authenticated. Es decir: el frontend (anon key) NO puede
--  leer ni escribir tablas directamente. Todo acceso ocurre dentro de
--  las Edge Functions usando la service_role key (que ignora RLS).
-- ═══════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ── SETTINGS (fila única) ─────────────────────────────────────
create table if not exists public.settings (
  id                  int primary key default 1 check (id = 1),
  titulo              text    not null default 'Elección',
  descripcion         text    not null default '',
  validar_padron      boolean not null default true,
  mostrar_resultados  boolean not null default false,
  modo_demo           boolean not null default false,
  emails_notificacion text[]  not null default '{}',
  email_asunto        text    not null default '[Club Salvadoreño] Nuevo voto registrado',
  updated_at          timestamptz not null default now()
);

-- ── PREGUNTAS ─────────────────────────────────────────────────
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  descripcion text not null default '',
  orden       int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ── OPCIONES (planillas) ──────────────────────────────────────
create table if not exists public.options (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id) on delete cascade,
  nombre         text not null,
  color          text not null default '#156082',
  capitan_nombre text,                 -- null = sin capitán destacado
  capitan_cargo  text,                 -- null = sin cargo
  orden          int  not null default 0
);
create index if not exists options_question_idx on public.options(question_id);

-- ── MIEMBROS DE LA OPCIÓN (planilla) ──────────────────────────
create table if not exists public.option_members (
  id        uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options(id) on delete cascade,
  nombre    text not null,
  cargo     text,                      -- null = cargo opcional (puede ir o no ir)
  orden     int  not null default 0
);
create index if not exists option_members_option_idx on public.option_members(option_id);

-- ── PADRÓN ────────────────────────────────────────────────────
create table if not exists public.padron (
  id            uuid primary key default gen_random_uuid(),
  uid           text not null unique,
  nombre        text not null default '',
  numero_socio  text,
  created_at    timestamptz not null default now()
);

-- ── VOTOS ─────────────────────────────────────────────────────
create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  uid        text not null unique,     -- unique = impide doble voto
  nombre     text not null default '',
  created_at timestamptz not null default now()
);

-- ── RESPUESTAS DEL VOTO ───────────────────────────────────────
create table if not exists public.vote_answers (
  id          uuid primary key default gen_random_uuid(),
  vote_id     uuid not null references public.votes(id) on delete cascade,
  question_id uuid not null,
  option_id   uuid not null
);
create index if not exists vote_answers_vote_idx on public.vote_answers(vote_id);
create index if not exists vote_answers_question_idx on public.vote_answers(question_id);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
-- Habilitado sin políticas → deny-all para anon/authenticated.
-- service_role (usado dentro de las Edge Functions) ignora RLS.
alter table public.settings       enable row level security;
alter table public.questions      enable row level security;
alter table public.options        enable row level security;
alter table public.option_members enable row level security;
alter table public.padron         enable row level security;
alter table public.votes          enable row level security;
alter table public.vote_answers   enable row level security;

-- Revocar permisos directos de los roles públicos (defensa en profundidad).
revoke all on all tables in schema public from anon, authenticated;

-- Fila de settings por defecto.
insert into public.settings (id) values (1)
on conflict (id) do nothing;
