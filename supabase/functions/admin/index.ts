// ═══════════════════════════════════════════════════════════════
//  Edge Function "admin" — panel administrativo (clave compartida)
//  TODAS las acciones exigen la cabecera X-Admin-Password correcta.
//  La validación vive AQUÍ (servidor), nunca en el navegador.
//  Desplegar con: supabase functions deploy admin --no-verify-jwt
// ═══════════════════════════════════════════════════════════════
import { handleOptions, json } from "../_shared/cors.ts";
import { computeResults, getBallot, getSettings, serviceClient } from "../_shared/lib.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DB = SupabaseClient;
type Body = Record<string, any>;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  // ── Puerta de clave (server-side) ───────────────────────────
  const pw = req.headers.get("x-admin-password") ?? "";
  const expected = Deno.env.get("ADMIN_PASSWORD") ?? "";
  if (!expected || pw !== expected) {
    return json({ error: "Clave administrativa incorrecta." }, 401);
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const action = String(url.searchParams.get("action") ?? body.action ?? "").trim();
    const db = serviceClient();

    switch (action) {
      case "login":         return json({ ok: true });
      case "getConfig":     return json(await getConfig(db));
      case "saveSettings":  return json(await saveSettings(db, body));
      case "saveBallot":    return json(await saveBallot(db, body));
      case "savePadron":    return json(await savePadron(db, body));
      case "getResults":    return json(await getResultsDetail(db));
      case "resetResults":  return json(await resetResults(db));
      case "generateLinks": return json(await generateLinks(db, body));
      default:              return json({ error: "Acción no válida." }, 400);
    }
  } catch (err) {
    console.error("[admin] Error:", err);
    return json({ error: (err as Error).message ?? "Error interno." }, 500);
  }
});

// ── getConfig ─────────────────────────────────────────────────
async function getConfig(db: DB) {
  const settings = await getSettings(db);
  const preguntas = await getBallot(db);
  const { data: padron } = await db
    .from("padron").select("uid, nombre, numero_socio").order("nombre", { ascending: true });
  return { settings, preguntas, padron: padron ?? [] };
}

// ── saveSettings ──────────────────────────────────────────────
async function saveSettings(db: DB, body: Body) {
  const s = body.settings ?? {};
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["titulo", "descripcion", "email_asunto"]) {
    if (s[k] !== undefined) update[k] = String(s[k]);
  }
  for (const k of ["validar_padron", "mostrar_resultados", "modo_demo"]) {
    if (s[k] !== undefined) update[k] = Boolean(s[k]);
  }
  if (Array.isArray(s.emails_notificacion)) {
    update.emails_notificacion = s.emails_notificacion
      .map((e: string) => String(e).trim()).filter(Boolean);
  }
  const { error } = await db.from("settings").update(update).eq("id", 1);
  if (error) throw new Error("No se pudo guardar la configuración.");
  return { ok: true };
}

// ── saveBallot ── reemplaza toda la papeleta ──────────────────
async function saveBallot(db: DB, body: Body) {
  const preguntas = Array.isArray(body.preguntas) ? body.preguntas : [];

  await db.from("questions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  for (let qi = 0; qi < preguntas.length; qi++) {
    const q = preguntas[qi];
    const { data: qRow, error: qErr } = await db.from("questions")
      .insert({ titulo: String(q.titulo ?? ""), descripcion: String(q.descripcion ?? ""), orden: qi })
      .select("id").single();
    if (qErr) throw new Error("No se pudo guardar una pregunta.");

    const opciones = Array.isArray(q.opciones) ? q.opciones : [];
    for (let oi = 0; oi < opciones.length; oi++) {
      const o = opciones[oi];
      const { data: oRow, error: oErr } = await db.from("options").insert({
        question_id: qRow.id,
        nombre: String(o.nombre ?? ""),
        color: String(o.color ?? "#1E656D"),
        capitan_nombre: o.capitan?.nombre ? String(o.capitan.nombre) : null,
        capitan_cargo: o.capitan?.cargo ? String(o.capitan.cargo) : null,
        orden: oi,
      }).select("id").single();
      if (oErr) throw new Error("No se pudo guardar una opción.");

      const miembros = Array.isArray(o.miembros) ? o.miembros : [];
      if (miembros.length) {
        const { error: mErr } = await db.from("option_members").insert(
          miembros.map((m, mi: number) => ({
            option_id: oRow.id,
            nombre: String(m.nombre ?? ""),
            cargo: m.cargo ? String(m.cargo) : null,
            orden: mi,
          })),
        );
        if (mErr) throw new Error("No se pudieron guardar los miembros.");
      }
    }
  }
  return { ok: true };
}

// ── savePadron ── upsert por uid + borrado opcional ───────────
async function savePadron(db: DB, body: Body) {
  const filas = Array.isArray(body.padron) ? body.padron : [];
  const removeUids = Array.isArray(body.removeUids) ? body.removeUids : [];

  if (removeUids.length) {
    await db.from("padron").delete().in("uid", removeUids.map(String));
  }

  const rows = filas
    .map((f) => ({
      uid: String(f.uid ?? "").trim(),
      nombre: String(f.nombre ?? "").trim(),
      numero_socio: f.numero_socio ? String(f.numero_socio).trim() : null,
    }))
    .filter((f) => f.uid);

  if (rows.length) {
    const { error } = await db.from("padron").upsert(rows, { onConflict: "uid" });
    if (error) throw new Error("No se pudo guardar el padrón: " + error.message);
  }
  return { ok: true, total: rows.length };
}

// ── getResults ── agregados + detalle auditable ───────────────
async function getResultsDetail(db: DB) {
  const agregados = await computeResults(db);
  const ballot = await getBallot(db);
  const nombreOpcion: Record<string, string> = {};
  ballot.forEach((q) => q.opciones.forEach((o) => (nombreOpcion[o.id] = o.nombre)));

  const { data: votes } = await db
    .from("votes").select("id, uid, nombre, created_at")
    .order("created_at", { ascending: true });
  const { data: answers } = await db
    .from("vote_answers").select("vote_id, option_id");

  const detalle = (votes ?? []).map((v) => ({
    uid: v.uid,
    nombre: v.nombre,
    fecha: v.created_at,
    selecciones: (answers ?? [])
      .filter((a) => a.vote_id === v.id)
      .map((a) => nombreOpcion[a.option_id] ?? a.option_id),
  }));

  return { ...agregados, detalle };
}

// ── resetResults ── borra TODOS los votos (pone los resultados a cero) ──
// vote_answers se borra en cascada (on delete cascade sobre votes).
async function resetResults(db: DB) {
  const { error } = await db.from("votes").delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // borra todas las filas
  if (error) throw new Error("No se pudieron borrar los votos: " + error.message);
  return { ok: true };
}

// ── generateLinks ── reemplaza gen_links.js ───────────────────
async function generateLinks(db: DB, body: Body) {
  const base = String(body.baseUrl ?? "").replace(/[?#].*$/, "").replace(/\/$/, "");
  const s = await getSettings(db);
  const { data: padron } = await db
    .from("padron").select("uid, nombre, numero_socio")
    .neq("nombre", "").order("nombre", { ascending: true });

  const links = (padron ?? []).map((p) => {
    const link = `${base}/?uid=${p.uid}`;
    const whatsapp =
      `Estimado(a) miembro(a),\n\n` +
      `El *Club Salvadoreño* le invita a participar en la votación para la *${s.titulo}*.\n\n` +
      `Por favor emita su voto a través del siguiente enlace:\n${link}\n\n` +
      `_⚠️ Este enlace es de uso personal e intransferible, válido para un único voto. No lo comparta con otras personas._`;
    return { numero_socio: p.numero_socio, nombre: p.nombre, uid: p.uid, link, whatsapp };
  });
  return { links };
}
