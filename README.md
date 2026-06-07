# Sistema de Votación Electrónica — Club Salvadoreño

Aplicación web estática (GitHub Pages) con backend en **Supabase** (Postgres + Edge Functions) y notificación por correo vía **Resend**. Incluye un **panel administrativo** para configurar la elección, las planillas, el padrón y los correos.

Identidad visual basada en el *brand manual* del club: colores institucionales (navy `#003563` / `#153662`, azul `#659ABC`) con acentos **Corinto** (teal `#1E656D`, vino `#752A07`, crema `#F1F3CE`).

---

## Arquitectura

```
Navegador (GitHub Pages, estático)
  ├── index.html        votación
  ├── resultados.html   resultados (público o por clave)
  ├── admin.html        panel administrativo (clave compartida)
  └── supabase-config.js   SUPABASE_URL + ANON_KEY (públicos por diseño)
        │  fetch → Edge Functions (anon key)
        ▼
Supabase Edge Functions (Deno, service_role por dentro)
  ├── api    → config | check | vote | results
  └── admin  → CRUD protegido por X-Admin-Password
        │
        ├── Postgres (RLS deny-all: el frontend NO toca tablas directamente)
        └── Resend (email por cada voto)
```

**Seguridad:** las tablas tienen RLS sin políticas para `anon` → el anon key **no** da acceso a datos; solo permite invocar funciones. La clave administrativa se valida **dentro de la Edge Function** (servidor), nunca en el navegador.

---

## Estructura del repositorio

```
/ (raíz = GitHub Pages)
  index.html  admin.html  resultados.html
  supabase-config.js  logo.jpg  brand_manual.pdf  README.md
/supabase
  config.toml
  migrations/0001_init.sql   esquema + RLS
  seed.sql                   elección + planilla + padrón actuales
  functions/_shared/         cors.ts, lib.ts (cliente, papeleta, resultados, email)
  functions/api/index.ts     endpoints del votante
  functions/admin/index.ts   endpoints del admin
```

---

## Configuración paso a paso

### 1. Crear el proyecto Supabase
1. Crear un proyecto en [supabase.com](https://supabase.com).
2. Instalar el CLI: `npm i -g supabase` (o `scoop install supabase`).
3. Iniciar sesión y vincular:
   ```bash
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   ```

### 2. Base de datos
```bash
supabase db push                       # aplica migrations/0001_init.sql
# Cargar los datos actuales (elección + planilla + 89 votantes Comisión de Golf):
supabase db execute --file supabase/seed.sql
```

### 3. Edge Functions y secretos
```bash
supabase functions deploy api   --no-verify-jwt
supabase functions deploy admin --no-verify-jwt

supabase secrets set ADMIN_PASSWORD="una-clave-fuerte"
supabase secrets set RESEND_API_KEY="re_xxxxxxxx"
supabase secrets set EMAIL_FROM="Votaciones Club <votaciones@clubsalvadoreno.com>"
```
> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles dentro de las funciones; no se configuran manualmente.

### 4. Resend (correo)
1. Crear cuenta en [resend.com](https://resend.com) y obtener un API key.
2. **Verificar el dominio** `clubsalvadoreno.com` (registros SPF/DKIM en el DNS) para enviar desde una dirección del club.
   - *Fallback inicial:* mientras se verifica el dominio, usar el remitente de prueba `onboarding@resend.dev` en `EMAIL_FROM`.
3. Si no se configura `RESEND_API_KEY`/`EMAIL_FROM`, el voto se registra igual pero **no** se envía correo.

### 5. Frontend (`supabase-config.js`)
Editar con los valores del proyecto (Dashboard → Project Settings → API):
```js
window.SUPABASE = {
  URL: "https://TU-PROYECTO.supabase.co",
  ANON_KEY: "TU_ANON_KEY",   // anon public, NO la service_role
};
```

### 6. Publicar en GitHub Pages
1. Subir el repositorio a GitHub.
2. **Settings → Pages → Deploy from a branch → main → / (root)**.
3. La app queda en `https://[usuario].github.io/[repositorio]/`.

---

## Panel administrativo (`/admin.html`)

Acceso con la clave de `ADMIN_PASSWORD`. Secciones:

| Sección | Qué configura |
|---------|---------------|
| **Elección** | Título, descripción, validar padrón, mostrar resultados, modo demo |
| **Planillas** | Preguntas y opciones; capitán (nombre + cargo) y miembros con **cargo opcional** |
| **Padrón** | UIDs, nombres y número de socio; generar UID, importar/pegar lista |
| **Correos** | Direcciones que reciben la notificación por cada voto + asunto |
| **Resultados** | Conteo, participación y detalle auditable de votos |
| **Links** | Genera enlaces personales `?uid=...` y mensajes de WhatsApp |

---

## Flujo del votante

1. Abre el link personal `…/?uid=XXXX` (o ingresa el UID).
2. `api/check` valida el UID contra el padrón y que no haya votado.
3. Selecciona y confirma → `api/vote` registra el voto y envía el correo.
4. `votes.uid` es único: **un solo voto por identificador**.

---

## Modelo de datos (Postgres)

`settings` (config única) · `questions` → `options` → `option_members` (papeleta) · `padron` (uid único) · `votes` (uid único) → `vote_answers`. Detalle en `supabase/migrations/0001_init.sql`.

---

## Migración desde el sistema anterior (Sheets/Apps Script)

El backend de Google Apps Script (`apps-script/Code.gs`), `config.json` y `gen_links.js` quedan como **referencia histórica**. La configuración vive ahora en la base de datos y la generación de links está en el panel administrativo (pestaña *Links*). El `seed.sql` ya incluye la elección, la planilla y los 89 votantes del padrón definitivo de la **Comisión de Golf 2026-2028** (xlsx 03/06/2026), cada uno con un UID nuevo.

---

## Desarrollo local (opcional)

```bash
supabase start                         # Postgres + funciones locales
supabase functions serve api admin --no-verify-jwt --env-file ./supabase/.env.local
```
Servir el frontend con cualquier servidor estático (ej. `npx serve .`) apuntando `supabase-config.js` a la URL local.
wBF9k4obKeyqJm6y
