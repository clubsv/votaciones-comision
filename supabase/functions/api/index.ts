// ═══════════════════════════════════════════════════════════════
//  Edge Function "api" — endpoints públicos del votante
//  Acciones: config | check | vote | results
//  Espejo de apps-script/Code.gs::doGet, pero sobre Supabase.
//  Desplegar con: supabase functions deploy api --no-verify-jwt
// ═══════════════════════════════════════════════════════════════
import { handleOptions, json } from "../_shared/cors.ts";
import {
  computeResults,
  getBallot,
  getSettings,
  serviceClient,
  sendVoteEmail,
} from "../_shared/lib.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DB = SupabaseClient;

const UID_RE = /^[a-zA-Z0-9]{3,20}$/;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(
      url.searchParams.get("action") ?? body.action ?? "",
    ).toLowerCase().trim();
    const params = { ...Object.fromEntries(url.searchParams), ...body };

    const db = serviceClient();

    switch (action) {
      case "config":   return json(await doConfig(db));
      case "check":    return json(await doCheck(db, String(params.uid ?? params.socio ?? "")));
      case "vote":     return json(await doVote(db, params));
      case "results":  return json(await doResults(db, req));
      default:         return json({ error: "Acción no válida." }, 400);
    }
  } catch (err) {
    console.error("[api] Error:", err);
    return json({ error: (err as Error).message ?? "Error interno." }, 500);
  }
});

// ── config ────────────────────────────────────────────────────
async function doConfig(db: DB) {
  const s = await getSettings(db);
  return {
    titulo: s.titulo,
    descripcion: s.descripcion,
    modoDemo: s.modo_demo,
    validarPadron: s.validar_padron,
    mostrarResultados: s.mostrar_resultados,
    preguntas: await getBallot(db),
  };
}

// ── check ─────────────────────────────────────────────────────
async function doCheck(db: DB, uidRaw: string) {
  const uid = String(uidRaw ?? "").trim();
  if (!uid) return { valid: false, message: "Identificador único requerido." };
  if (!UID_RE.test(uid)) return { valid: false, message: "Identificador único inválido." };

  const s = await getSettings(db);
  let nombre = "";

  if (s.validar_padron) {
    const { data: p } = await db
      .from("padron").select("nombre").eq("uid", uid).maybeSingle();
    if (!p) return { valid: false, message: "El identificador no está registrado en el padrón." };
    nombre = String(p.nombre ?? "").trim();
  }

  const { data: yaVoto } = await db
    .from("votes").select("id").eq("uid", uid).maybeSingle();
  if (yaVoto) return { valid: true, alreadyVoted: true };

  return { valid: true, alreadyVoted: false, nombre };
}

// ── vote ──────────────────────────────────────────────────────
async function doVote(db: DB, params: Record<string, any>) {
  const uid = String(params.uid ?? params.socio ?? "").trim();
  if (!uid) throw new Error("Identificador único requerido.");

  // respuestas: { [question_id]: option_id }. Acepta JSON o claves voto_<id>.
  let respuestas: Record<string, string> = {};
  if (params.respuestas && typeof params.respuestas === "object") {
    respuestas = params.respuestas;
  } else {
    for (const [k, v] of Object.entries(params)) {
      if (k.startsWith("voto_")) respuestas[k.slice(5)] = String(v);
    }
  }

  // Double-check (igual que Code.gs::registrarVoto)
  const check = await doCheck(db, uid);
  if (!check.valid) throw new Error(check.message ?? "Identificador no válido.");
  if (check.alreadyVoted) throw new Error("Este identificador ya registró su voto.");
  const nombre = check.nombre ?? "";

  const ballot = await getBallot(db);
  if (ballot.length === 0) throw new Error("No hay preguntas configuradas.");

  // Validar que cada pregunta tenga una opción válida.
  const answers: { question_id: string; option_id: string }[] = [];
  const selecciones: { titulo: string; opcion: string }[] = [];
  for (const q of ballot) {
    const oid = String(respuestas[q.id] ?? "").trim();
    if (!oid) throw new Error(`Falta el voto para: "${q.titulo}".`);
    const op = q.opciones.find((o) => o.id === oid);
    if (!op) throw new Error(`Opción inválida para: "${q.titulo}".`);
    answers.push({ question_id: q.id, option_id: oid });
    selecciones.push({ titulo: q.titulo, opcion: op.nombre });
  }

  // Insertar voto (unique(uid) bloquea doble voto a nivel DB).
  const { data: vote, error: vErr } = await db
    .from("votes").insert({ uid, nombre }).select("id").single();
  if (vErr) {
    if (vErr.code === "23505") throw new Error("Este identificador ya registró su voto.");
    throw new Error("No se pudo registrar el voto.");
  }

  const { error: aErr } = await db
    .from("vote_answers")
    .insert(answers.map((a) => ({ ...a, vote_id: vote.id })));
  if (aErr) {
    await db.from("votes").delete().eq("id", vote.id); // rollback manual
    throw new Error("No se pudo registrar el detalle del voto.");
  }

  // Email (no bloquea el voto si falla).
  try {
    const settings = await getSettings(db);
    const resultados = await computeResults(db);
    const fechaHora = new Date().toLocaleString("es-SV", { timeZone: "America/El_Salvador" });
    await sendVoteEmail({ settings, uid, nombre, selecciones, resultados, fechaHora });
  } catch (e) {
    console.error("[api] Error email:", e);
  }

  return { success: true, timestamp: new Date().toISOString() };
}

// ── results ───────────────────────────────────────────────────
async function doResults(db: DB, req: Request) {
  const s = await getSettings(db);
  if (!s.mostrar_resultados) {
    const pw = req.headers.get("x-admin-password") ?? "";
    if (pw !== (Deno.env.get("ADMIN_PASSWORD") ?? "")) {
      return { error: "Los resultados no están habilitados.", locked: true };
    }
  }
  return await computeResults(db);
}
