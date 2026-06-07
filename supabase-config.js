// ═══════════════════════════════════════════════════════════════
//  Configuración pública del frontend (votación / resultados / admin)
//  Estos valores son PÚBLICOS por diseño: el anon key solo permite
//  invocar Edge Functions. El acceso a datos está bloqueado por RLS,
//  y la clave administrativa se valida del lado del servidor.
//
//  ► Reemplace los dos valores con los de SU proyecto Supabase:
//    Dashboard → Project Settings → API
// ═══════════════════════════════════════════════════════════════
window.SUPABASE = {
  // Ej: https://abcdefghijklmno.supabase.co
  URL: "https://mfyrudjkvcvaghlkqzxw.supabase.co",

  // anon public key (NO la service_role)
  ANON_KEY: "sb_publishable_jUV0JO4kJvio-cacvFBxaQ_lNOGc7p2",
};

// URL base de las Edge Functions (derivada de URL).
window.SUPABASE.FUNCTIONS_URL = window.SUPABASE.URL + "/functions/v1";
