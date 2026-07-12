// _worker.js — LaJugadaSegura00
// Sirve el sitio estático y añade una API de comentarios propia,
// respaldada por Cloudflare KV. Compatible con despliegue por
// arrastrar y soltar (no requiere Wrangler ni carpeta /functions).

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ==========================================================================
//  GEO-RESTRICCIÓN
//  Países donde el juego online (o su publicidad) está prohibido o muy
//  restringido. En estas regiones se ocultan las ofertas/bonos y los
//  enlaces de afiliado, pero el contenido informativo (blog) sigue visible.
//
//  Códigos ISO 3166-1 alpha-2. Edita libremente esta lista.
//  NOTA: EE.UU. (US) NO está bloqueado por decisión del propietario.
// ==========================================================================
const GEO_RESTRICTED_COUNTRIES = new Set([
  // --- Oriente Medio y Norte de África (prohibición general) ---
  "SA", "AE", "QA", "KW", "BH", "OM", "YE", // Golfo + Yemen
  "IR", "IQ", "SY", "LY", "SD", "DZ",        // Irán, Irak, Siria, Libia, Sudán, Argelia
  "AF", "PK", "BD", "BN",                     // Afganistán, Pakistán, Bangladés, Brunéi
  // --- Asia (prohibición o régimen muy estricto) ---
  "CN", "HK", "KP", "SG", "TH", "ID", "VN", "KH",
  // --- Europa ---
  "TR", // Turquía: juego online prohibido salvo lotería estatal
  // Añade aquí cualquier otro país que quieras excluir, p. ej. "IN".
]);

// Rutas de la sección de ofertas/bonos que se bloquean por completo.
function isOffersPath(path) {
  return (
    path === "/offers" ||
    path === "/offers/" ||
    path.startsWith("/offers/") ||
    path === "/es/ofertas" ||
    path === "/es/ofertas.html" ||
    path.startsWith("/es/ofertas")
  );
}

// Aviso mostrado cuando una región restringida intenta ver ofertas/afiliados.
// El idioma se decide por la sección del sitio: inglés (principal) por
// defecto, y español solo en las rutas /es/.
function geoNoticeResponse(request, country, path) {
  const es = typeof path === "string" && path.startsWith("/es/");
  const title = es
    ? "Contenido no disponible en tu región"
    : "Content not available in your region";
  const body = es
    ? "Por motivos legales, las ofertas, bonos y enlaces a operadores de juego no están disponibles en tu ubicación. Puedes seguir consultando nuestras guías y artículos informativos."
    : "For legal reasons, gambling offers, bonuses and operator links are not available in your location. You can still read our informational guides and articles.";
  const backHome = es ? "Volver al inicio" : "Back to home";
  const backBlog = es ? "Ver el blog" : "Read the blog";
  const blogHref = es ? "/es/blog/index.html" : "/blog/index.html";
  const homeHref = es ? "/es/index.html" : "/index.html";
  const responsible = es ? "juego responsable" : "responsible gambling";
  const html =
    "<!DOCTYPE html>\n" +
    '<html lang="' + (es ? "es" : "en") + '">\n' +
    "<head>\n" +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="robots" content="noindex">\n' +
    "<title>" + title + " — LaJugadaSegura00</title>\n" +
    "<style>\n" +
    ":root{--bg:#0E0F0D;--cream:#F3EFE6;--gold:#C9A227;--muted:#9a9488;}\n" +
    "*{box-sizing:border-box;margin:0;padding:0;}\n" +
    "body{background:var(--bg);color:var(--cream);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}\n" +
    ".card{max-width:560px;text-align:center;}\n" +
    ".badge{display:inline-block;border:1px solid var(--gold);color:var(--gold);border-radius:999px;padding:4px 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:22px;}\n" +
    "h1{font-size:26px;margin-bottom:14px;color:var(--cream);}\n" +
    "p{color:var(--muted);font-size:16px;margin-bottom:26px;}\n" +
    ".actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}\n" +
    "a.btn{display:inline-block;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;}\n" +
    "a.primary{background:var(--gold);color:#1a1400;}\n" +
    "a.ghost{border:1px solid #3a3833;color:var(--cream);}\n" +
    ".foot{margin-top:30px;font-size:12px;color:#5f5b53;}\n" +
    "</style>\n" +
    "</head>\n" +
    "<body>\n" +
    '  <div class="card">\n' +
    '    <span class="badge">18+ · ' + (country || "—") + "</span>\n" +
    "    <h1>" + title + "</h1>\n" +
    "    <p>" + body + "</p>\n" +
    '    <div class="actions">\n' +
    '      <a class="btn primary" href="' + homeHref + '">' + backHome + "</a>\n" +
    '      <a class="btn ghost" href="' + blogHref + '">' + backBlog + "</a>\n" +
    "    </div>\n" +
    '    <p class="foot">LaJugadaSegura00 — ' + responsible + "</p>\n" +
    "  </div>\n" +
    "</body>\n" +
    "</html>";
  return new Response(html, {
    status: 451, // Unavailable For Legal Reasons
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Elimina del HTML cualquier elemento marcado con [data-geo-restricted]
// (botones de bono, enlaces de afiliado, items de menú, etc.).
class GeoStrip {
  element(el) {
    el.remove();
  }
}

function badRequest(msg) {
  return json({ ok: false, error: msg }, 400);
}

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, 401);
}

async function isAuthorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !env.ADMIN_TOKEN) return false;
  const secret = await env.ADMIN_TOKEN.get();
  return secret && token === secret;
}

function sanitizeSlug(slug) {
  if (typeof slug !== "string") return null;
  if (!/^[a-z0-9/_-]{1,120}$/i.test(slug)) return null;
  return slug;
}

async function getComments(env, slug) {
  const raw = await env.COMMENTS_KV.get(`comments:${slug}`);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveComments(env, slug, comments) {
  await env.COMMENTS_KV.put(`comments:${slug}`, JSON.stringify(comments));
}

async function handlePublicList(request, env) {
  const url = new URL(request.url);
  const slug = sanitizeSlug(url.searchParams.get("slug") || "");
  if (!slug) return badRequest("invalid slug");
  const comments = await getComments(env, slug);
  const approved = comments
    .filter((c) => c.approved)
    .sort((a, b) => a.ts - b.ts)
    .map((c) => ({ id: c.id, name: c.name, text: c.text, ts: c.ts }));
  return json({ ok: true, comments: approved });
}

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid json");
  }

  const slug = sanitizeSlug(body.slug);
  const name = (body.name || "").toString().trim().slice(0, 60);
  const text = (body.text || "").toString().trim().slice(0, 2000);
  const website = (body.website || "").toString(); // honeypot

  if (!slug) return badRequest("invalid slug");
  if (website.trim() !== "") return json({ ok: true }); // silently drop bots
  if (!name || !text) return badRequest("name and text are required");
  if (text.length < 2) return badRequest("comment too short");

  const comment = {
    id: crypto.randomUUID(),
    name,
    text,
    ts: Date.now(),
    approved: false,
  };

  const comments = await getComments(env, slug);
  comments.push(comment);
  // Keep at most 500 per post to bound storage
  await saveComments(env, slug, comments.slice(-500));

  return json({ ok: true, pending: true });
}

async function handleAdminList(request, env) {
  if (!(await isAuthorized(request, env))) return unauthorized();
  const list = await env.COMMENTS_KV.list({ prefix: "comments:" });
  const result = {};
  for (const key of list.keys) {
    const slug = key.name.replace(/^comments:/, "");
    const raw = await env.COMMENTS_KV.get(key.name);
    try {
      result[slug] = JSON.parse(raw) || [];
    } catch {
      result[slug] = [];
    }
  }
  return json({ ok: true, bySlug: result });
}

async function handleAdminAction(request, env, action) {
  if (!(await isAuthorized(request, env))) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid json");
  }
  const slug = sanitizeSlug(body.slug);
  const id = (body.id || "").toString();
  if (!slug || !id) return badRequest("slug and id are required");

  const comments = await getComments(env, slug);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return badRequest("comment not found");

  if (action === "approve") {
    comments[idx].approved = true;
  } else if (action === "delete") {
    comments.splice(idx, 1);
  }
  await saveComments(env, slug, comments);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // País del visitante (Cloudflare lo inyecta). "XX"/undefined => sin dato.
    const country =
      (request.cf && request.cf.country) ||
      request.headers.get("cf-ipcountry") ||
      "XX";
    const geoRestricted = GEO_RESTRICTED_COUNTRIES.has(country);

    // En regiones restringidas: bloquea ofertas/bonos y redirecciones de
    // afiliado (/go/...) mostrando un aviso legal.
    if (geoRestricted && (isOffersPath(path) || path.startsWith("/go/"))) {
      return geoNoticeResponse(request, country, path);
    }

    if (path === "/api/comments" && request.method === "GET") {
      return handlePublicList(request, env);
    }
    if (path === "/api/comments" && request.method === "POST") {
      return handleSubmit(request, env);
    }
    if (path === "/api/admin/list" && request.method === "GET") {
      return handleAdminList(request, env);
    }
    if (path === "/api/admin/approve" && request.method === "POST") {
      return handleAdminAction(request, env, "approve");
    }
    if (path === "/api/admin/delete" && request.method === "POST") {
      return handleAdminAction(request, env, "delete");
    }

    // Everything else: serve the static site as usual
    const response = await env.ASSETS.fetch(request);

    // En regiones restringidas, elimina del HTML los elementos marcados con
    // [data-geo-restricted] (bonos, CTAs y enlaces de afiliado) sin ocultar
    // el resto del contenido informativo.
    if (
      geoRestricted &&
      (response.headers.get("content-type") || "").includes("text/html")
    ) {
      return new HTMLRewriter()
        .on("[data-geo-restricted]", new GeoStrip())
        .transform(response);
    }

    return response;
  },
};
