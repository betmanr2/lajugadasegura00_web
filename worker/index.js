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

// Inyecta un botón flotante de Telegram al final del <body> de cada página.
class TelegramFloat {
  constructor(es) {
    this.es = es;
  }
  element(el) {
    const label = this.es ? "Únete a Telegram" : "Join Telegram";
    const btn =
      '<a href="https://t.me/lajugadasegura00" target="_blank" rel="noopener"' +
      ' aria-label="Telegram"' +
      ' style="position:fixed;bottom:20px;right:20px;z-index:9999;' +
      "display:inline-flex;align-items:center;gap:8px;background:#229ED9;" +
      "color:#fff;padding:12px 18px;border-radius:999px;" +
      "font-family:Inter,system-ui,-apple-system,sans-serif;font-weight:600;" +
      "font-size:15px;line-height:1;text-decoration:none;" +
      'box-shadow:0 6px 20px rgba(0,0,0,.35);">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">' +
      "<path d=\"M21.5 3.5 2.7 10.8c-1 .4-1 1.9.1 2.2l4.5 1.4 1.7 5.4c.3.9 1.4 1.1 2 .4l2.5-2.6 4.6 3.4c.9.6 2.1.1 2.3-.9l3-16.4c.2-1.1-.9-2-2-1.5zM8.7 14l8.6-6.9c.3-.2.6.2.3.4l-7.2 7.4-.3 3.4-1.4-4.3z\"/></svg>" +
      "<span>" + label + "</span></a>";
    el.append(btn, { html: true });
  }
}

// Inyecta un pop-up de verificación de edad (18+) al principio del <body>.
// Se muestra una vez por visitante; la aceptación se recuerda en localStorage.
class AgeGate {
  constructor(es) {
    this.es = es;
  }
  element(el) {
    const es = this.es;
    const title = es ? "¿Eres mayor de edad?" : "Are you of legal age?";
    const body = es
      ? "Esta web contiene información sobre juego y apuestas y está dirigida exclusivamente a personas adultas. Debes tener 18 años o más (o la edad legal en tu país) para entrar."
      : "This website contains information about gambling and betting and is intended for adults only. You must be 18 or older (or the legal age in your country) to enter.";
    const enter = es ? "Tengo 18 años o más — Entrar" : "I am 18 or older — Enter";
    const leave = es ? "Salir" : "Leave";
    const rg = es ? "Juega con responsabilidad." : "Please gamble responsibly.";
    const g =
      '<div id="lgs-agegate" style="position:fixed;inset:0;z-index:100000;' +
      "background:rgba(5,4,3,.94);display:flex;align-items:center;justify-content:center;" +
      'padding:24px;font-family:Inter,system-ui,-apple-system,sans-serif;">' +
      '<div style="max-width:460px;text-align:center;background:#141009;' +
      'border:1px solid rgba(201,162,39,.4);border-radius:14px;padding:34px 28px;">' +
      '<div style="width:64px;height:64px;border-radius:50%;background:#C9A227;color:#1a1400;' +
      "font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center;" +
      'margin:0 auto 20px;">18+</div>' +
      '<h2 style="font-family:Georgia,serif;color:#F3E9D2;font-size:22px;margin:0 0 12px;">' + title + "</h2>" +
      '<p style="color:#8C8272;font-size:15px;line-height:1.6;margin:0 0 24px;">' + body + "</p>" +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<button id="lgs-age-yes" style="background:#C9A227;color:#1a1400;border:none;' +
      'font-weight:600;font-size:15px;padding:13px;border-radius:9px;cursor:pointer;">' + enter + "</button>" +
      '<button id="lgs-age-no" style="background:transparent;color:#8C8272;' +
      'border:1px solid #3a3833;font-size:14px;padding:11px;border-radius:9px;cursor:pointer;">' + leave + "</button>" +
      "</div>" +
      '<p style="color:#6b6357;font-size:12px;margin:20px 0 0;">' + rg + "</p>" +
      "</div></div>" +
      "<script>(function(){try{if(localStorage.getItem('lgs_age_ok')==='1'){" +
      "var e=document.getElementById('lgs-agegate');if(e)e.remove();return;}}catch(x){}" +
      "var y=document.getElementById('lgs-age-yes'),n=document.getElementById('lgs-age-no');" +
      "if(y)y.onclick=function(){try{localStorage.setItem('lgs_age_ok','1')}catch(x){}" +
      "var e=document.getElementById('lgs-agegate');if(e)e.remove();};" +
      "if(n)n.onclick=function(){window.location.href='https://www.google.com';};})();<\/script>";
    el.prepend(g, { html: true });
  }
}

// Inyecta el token de Slotslaunch (desde el secret del Worker) solo en las
// páginas de /slots, para que el iframe del demo pueda cargar sin exponer el
// token en el repositorio. El token queda visible en el HTML servido, pero
// Slotslaunch lo restringe por dominio.
class SlotsToken {
  constructor(token) {
    this.token = token;
  }
  element(el) {
    el.append(
      "<script>window.SLOTS_TOKEN=" + JSON.stringify(this.token) + ";</" + "script>",
      { html: true }
    );
  }
}

// Sustituye el menú de navegación por uno unificado (mismas secciones en todas
// las páginas), con rutas absolutas para que funcione a cualquier profundidad.
class NavInject {
  constructor(es) {
    this.es = es;
  }
  element(el) {
    const items = this.es
      ? '<li><a href="/es/">Inicio</a></li>' +
        '<li><a href="/es/slots/">Slots gratis</a></li>' +
        '<li><a href="/es/premios/">Mayores premios</a></li>' +
        '<li><a href="/es/blog/">Blog</a></li>' +
        '<li><a href="/es/#normativa">Juego responsable</a></li>'
      : '<li><a href="/">Home</a></li>' +
        '<li><a href="/slots/">Free slots</a></li>' +
        '<li><a href="/wins/">Big wins</a></li>' +
        '<li><a href="/blog/">Blog</a></li>' +
        '<li><a href="/#normativa">Responsible play</a></li>';
    el.setInnerContent(items, { html: true });
  }
}

// Inyecta el botón hamburguesa en la cabecera (solo visible en móvil).
class MobileMenu {
  element(el) {
    el.append(
      '<button class="nav-toggle" aria-label="Menu" aria-controls="lgs-drawer" aria-expanded="false">☰</button>',
      { html: true }
    );
  }
}

// Panel lateral (drawer) con el menú completo, inyectado en el body. La
// hamburguesa lo abre; el fondo oscuro, la X o pulsar un enlace lo cierra.
class MobileDrawer {
  constructor(es) {
    this.es = es;
  }
  element(el) {
    const items = this.es
      ? '<a href="/es/">Inicio</a><a href="/es/slots/">Slots gratis</a><a href="/es/premios/">Mayores premios</a><a href="/es/blog/">Blog</a><a href="/es/#normativa">Juego responsable</a>'
      : '<a href="/">Home</a><a href="/slots/">Free slots</a><a href="/wins/">Big wins</a><a href="/blog/">Blog</a><a href="/#normativa">Responsible play</a>';
    const close = this.es ? "Cerrar" : "Close";
    const html =
      '<div id="lgs-drawer-overlay" class="lgs-drawer-overlay"></div>' +
      '<aside id="lgs-drawer" class="lgs-drawer" aria-hidden="true">' +
      '<button class="lgs-drawer-close" aria-label="' + close + '">✕</button>' +
      '<nav class="lgs-drawer-nav">' + items + "</nav></aside>" +
      "<script>(function(){var t=document.querySelector('.nav-toggle')," +
      "d=document.getElementById('lgs-drawer'),o=document.getElementById('lgs-drawer-overlay')," +
      "c=d?d.querySelector('.lgs-drawer-close'):null;" +
      "function op(){d.classList.add('open');o.classList.add('open');d.setAttribute('aria-hidden','false');if(t)t.setAttribute('aria-expanded','true');}" +
      "function cl(){d.classList.remove('open');o.classList.remove('open');d.setAttribute('aria-hidden','true');if(t)t.setAttribute('aria-expanded','false');}" +
      "if(t&&d&&o){t.addEventListener('click',op);o.addEventListener('click',cl);if(c)c.addEventListener('click',cl);" +
      "d.addEventListener('click',function(e){if(e.target.tagName==='A')cl();});}})();</" + "script>";
    el.append(html, { html: true });
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
    const contentType = response.headers.get("content-type") || "";

    // Sobre las páginas HTML: inyecta el botón flotante de Telegram (excepto
    // en /admin) y, en regiones restringidas, elimina los elementos marcados
    // con [data-geo-restricted] (bonos, CTAs y enlaces de afiliado).
    if (contentType.includes("text/html")) {
      let rewriter = new HTMLRewriter();
      if (!path.startsWith("/admin")) {
        const esLang = path.startsWith("/es/");
        rewriter = rewriter
          .on("header nav ul", new NavInject(esLang))
          .on("header .nav", new MobileMenu())
          .on("body", new MobileDrawer(esLang))
          .on("body", new AgeGate(esLang))
          .on("body", new TelegramFloat(esLang));
      }
      if ((path.startsWith("/slots") || path.startsWith("/es/slots")) && env.SLOTSLAUNCH_TOKEN) {
        rewriter = rewriter.on("head", new SlotsToken(env.SLOTSLAUNCH_TOKEN));
      }
      if (geoRestricted) {
        rewriter = rewriter.on("[data-geo-restricted]", new GeoStrip());
      }
      return rewriter.transform(response);
    }

    return response;
  },
};
