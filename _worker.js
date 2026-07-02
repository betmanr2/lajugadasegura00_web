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

function badRequest(msg) {
  return json({ ok: false, error: msg }, 400);
}

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, 401);
}

function isAuthorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
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
  if (!isAuthorized(request, env)) return unauthorized();
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
  if (!isAuthorized(request, env)) return unauthorized();
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
    return env.ASSETS.fetch(request);
  },
};
