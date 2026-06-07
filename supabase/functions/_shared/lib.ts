// Lógica compartida: cliente service_role, papeleta, resultados y email.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export interface Settings {
  id: number;
  titulo: string;
  descripcion: string;
  validar_padron: boolean;
  mostrar_resultados: boolean;
  modo_demo: boolean;
  emails_notificacion: string[];
  email_asunto: string;
}

export async function getSettings(db: SupabaseClient): Promise<Settings> {
  const { data, error } = await db.from("settings").select("*").eq("id", 1).single();
  if (error) throw new Error("No se pudo leer la configuración.");
  return data as Settings;
}

// Papeleta completa (preguntas → opciones → miembros) ordenada.
export async function getBallot(db: SupabaseClient) {
  const { data: questions } = await db
    .from("questions").select("*").order("orden", { ascending: true });
  const { data: options } = await db
    .from("options").select("*").order("orden", { ascending: true });
  const { data: members } = await db
    .from("option_members").select("*").order("orden", { ascending: true });

  return (questions ?? []).map((q) => ({
    id: q.id,
    titulo: q.titulo,
    descripcion: q.descripcion,
    opciones: (options ?? [])
      .filter((o) => o.question_id === q.id)
      .map((o) => ({
        id: o.id,
        nombre: o.nombre,
        color: o.color,
        capitan: o.capitan_nombre
          ? { nombre: o.capitan_nombre, cargo: o.capitan_cargo ?? "" }
          : null,
        miembros: (members ?? [])
          .filter((m) => m.option_id === o.id)
          .map((m) => ({ nombre: m.nombre, cargo: m.cargo ?? null })),
      })),
  }));
}

// Resultados agregados (conteo + porcentaje + participación).
export async function computeResults(db: SupabaseClient) {
  const ballot = await getBallot(db);

  const { count: totalVotos } = await db
    .from("votes").select("*", { count: "exact", head: true });

  // Participación: solo miembros del padrón con nombre (excluye reservas).
  const { count: totalPadron } = await db
    .from("padron").select("*", { count: "exact", head: true }).neq("nombre", "");

  const { data: answers } = await db.from("vote_answers").select("question_id, option_id");

  const preguntas = ballot.map((q) => {
    const total = (answers ?? []).filter((a) => a.question_id === q.id).length;
    const opciones = q.opciones.map((o) => {
      const votos = (answers ?? []).filter(
        (a) => a.question_id === q.id && a.option_id === o.id,
      ).length;
      return {
        id: o.id,
        nombre: o.nombre,
        votos,
        porcentaje: total > 0 ? Math.round((votos / total) * 100) : 0,
      };
    }).sort((a, b) => b.votos - a.votos);
    return { id: q.id, titulo: q.titulo, opciones };
  });

  return { preguntas, totalVotos: totalVotos ?? 0, totalPadron: totalPadron ?? 0 };
}

export function esc(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Envía la notificación por cada voto vía Resend (replica el email de Apps Script).
export async function sendVoteEmail(opts: {
  settings: Settings;
  uid: string;
  nombre: string;
  selecciones: { titulo: string; opcion: string }[];
  resultados: Awaited<ReturnType<typeof computeResults>>;
  fechaHora: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const to = (opts.settings.emails_notificacion ?? []).filter((e) => e && e.trim());
  if (!apiKey || !from || to.length === 0) return; // email opcional: no romper el voto

  const { totalVotos, totalPadron } = opts.resultados;
  const pct = totalPadron > 0 ? Math.round((totalVotos / totalPadron) * 100) : null;
  const pendientes = totalPadron > 0 ? totalPadron - totalVotos : null;

  const detalleVotosHtml = opts.selecciones.map((s) => `
    <tr>
      <td style="padding:8px 14px;color:#64748B;font-size:13px;border-bottom:1px solid #EEF2F7;width:220px;">${esc(s.titulo)}</td>
      <td style="padding:8px 14px;font-weight:700;font-size:13px;color:#0D2137;border-bottom:1px solid #EEF2F7;">${esc(s.opcion)}</td>
    </tr>`).join("");

  const resultadosHtml = opts.resultados.preguntas.map((preg) => {
    const filas = preg.opciones.map((o) => `
      <tr>
        <td style="padding:7px 12px;font-size:12px;border-bottom:1px solid #EEF2F7;color:#1E293B;">${esc(o.nombre)}</td>
        <td style="padding:7px 12px;text-align:center;font-size:12px;border-bottom:1px solid #EEF2F7;font-weight:700;color:#0D2137;">${o.votos}</td>
        <td style="padding:7px 12px;text-align:center;font-size:12px;border-bottom:1px solid #EEF2F7;color:#64748B;">${o.porcentaje}%</td>
      </tr>`).join("");
    return `<tr><td colspan="3" style="padding:10px 12px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748B;background:#F8FAFC;">${esc(preg.titulo)}</td></tr>${filas}`;
  }).join("");

  const pieHtml = pendientes !== null
    ? `<tr><td colspan="3" style="padding:8px 12px;font-size:11px;color:#64748B;">Participación: <strong>${totalVotos} de ${totalPadron} (${pct}%)</strong> &nbsp;·&nbsp; Pendientes: <strong>${pendientes}</strong></td></tr>`
    : `<tr><td colspan="3" style="padding:8px 12px;font-size:11px;color:#64748B;">Total de votos: <strong>${totalVotos}</strong></td></tr>`;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:24px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:#0D2137;border-radius:10px 10px 0 0;padding:26px 32px;text-align:center;">
    <div style="color:#FFFFFF;font-family:'Arial Black',Arial,sans-serif;font-size:18px;letter-spacing:.12em;text-transform:uppercase;">Club Salvadoreño</div>
    <div style="color:rgba(255,255,255,.55);font-size:11px;letter-spacing:.06em;margin-top:4px;text-transform:uppercase;">${esc(opts.settings.titulo)}</div>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#156082,#1B8EAD);"></td></tr>
  <tr><td style="background:#FFFFFF;padding:28px 32px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">
    <div style="display:inline-block;background:#F0FDF4;border:1px solid #BBF7D0;color:#14532D;border-radius:20px;padding:5px 14px;font-size:13px;font-weight:700;margin-bottom:20px;">✅ Nuevo voto registrado</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr><td style="padding:7px 0;color:#64748B;font-size:13px;width:180px;">Nombre del Votante:</td><td style="padding:7px 0;font-weight:700;font-size:14px;color:#0D2137;">${esc(opts.nombre || "(sin nombre registrado)")}</td></tr>
      <tr><td style="padding:7px 0;color:#64748B;font-size:13px;">Identificador (UID):</td><td style="padding:7px 0;font-weight:700;font-size:13px;color:#0D2137;font-family:monospace;">${esc(opts.uid)}</td></tr>
      <tr><td style="padding:7px 0;color:#64748B;font-size:13px;">Fecha / Hora:</td><td style="padding:7px 0;font-size:13px;color:#1E293B;">${esc(opts.fechaHora)}</td></tr>
    </table>
    <div style="border-top:2px solid #EEF2F7;margin:18px 0;"></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748B;margin-bottom:10px;">Selección del Votante</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;margin-bottom:22px;"><tbody>${detalleVotosHtml}</tbody></table>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748B;margin-bottom:10px;">Resultados Acumulados</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <thead><tr style="background:#EEF2F7;"><th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#0D2137;">Opción</th><th style="padding:9px 12px;text-align:center;font-size:10px;text-transform:uppercase;color:#0D2137;">Votos</th><th style="padding:9px 12px;text-align:center;font-size:10px;text-transform:uppercase;color:#0D2137;">%</th></tr></thead>
      <tbody>${resultadosHtml || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94A3B8;font-size:12px;">Sin datos</td></tr>'}</tbody>
      <tfoot>${pieHtml}</tfoot>
    </table>
  </td></tr>
  <tr><td style="background:#0D2137;border-radius:0 0 10px 10px;padding:14px 24px;text-align:center;"><div style="color:rgba(255,255,255,.4);font-size:11px;">Mensaje automático · Club Salvadoreño · Sistema de Votación</div></td></tr>
</table></td></tr></table></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: opts.settings.email_asunto, html }),
  });
  if (!res.ok) {
    console.error("[Resend] Error:", res.status, await res.text());
  }
}
