---
name: email-brevo-setup
description: Cómo y por qué se envían los correos de notificación (Brevo, no Resend/Gmail)
metadata:
  type: project
---

El sistema de votación envía un correo de notificación por cada voto vía **Brevo (API HTTP)**, configurado en `supabase/functions/_shared/lib.ts` (`sendVoteEmail`).

**Por qué Brevo:** el cliente NO tiene acceso al DNS de `clubsalvadoreno.com`, así que Resend (que exige verificar dominio) no podía entregar a las direcciones del club. Se probó Gmail SMTP vía denomailer pero el MIME llegaba malformado/crudo desde la Edge Function (bug de CRLF en serverless). Brevo con **"single sender"** verificado (`eleccionescapitancs@gmail.com`) no requiere DNS, entrega a cualquier destinatario y renderiza el HTML bien.

**Secretos en Supabase:** `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`. (Sin valores aquí.)

**Lista de destinatarios:** se gestiona en admin.html → pestaña *Correos* (campo `settings.emails_notificacion`). NO llega a los 89 votantes (ellos votan por link de WhatsApp); llega solo a las direcciones del club configuradas.

**Pendiente conocido:** Brevo muestra un aviso DKIM/DMARC porque el remitente es `@gmail.com` enviado vía Brevo. Es cosmético para este volumen bajo; se resolvería autenticando un dominio propio en Brevo cuando haya acceso al DNS.

Resultados: ver con [[resultados-acceso]] (resultados.html o admin, con ADMIN_PASSWORD; `mostrar_resultados=false` por defecto).
