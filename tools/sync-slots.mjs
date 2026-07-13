// Sincroniza los juegos de Slotslaunch a public/slots/games.json
// (NO guarda el token en el archivo; el token va en un secret del Worker).
//
// Uso desde la carpeta sitio_web:
//   PowerShell:  $env:SLOTSLAUNCH_TOKEN="tu_token"; node tools/sync-slots.mjs
//   Bash/macOS:  SLOTSLAUNCH_TOKEN="tu_token" node tools/sync-slots.mjs
//
// Requiere Node 18 o superior (usa fetch nativo).

import { writeFile, mkdir } from "node:fs/promises";

const TOKEN = process.env.SLOTSLAUNCH_TOKEN;
const ORIGIN = process.env.SLOTS_ORIGIN || "https://lajugadasegura00.com";
const PAGES = Number(process.env.SLOTS_PAGES || 4); // 4 x 150 ≈ 600 juegos
const PER = 150;

if (!TOKEN) {
  console.error("Falta la variable SLOTSLAUNCH_TOKEN.");
  process.exit(1);
}

async function getPage(page) {
  const url =
    "https://slotslaunch.com/api/games?published=1&order_by=id&order=asc" +
    "&per_page=" + PER + "&page=" + page;
  const r = await fetch(url, {
    headers: {
      Authorization: "Bearer " + TOKEN,
      Origin: ORIGIN,
      Referer: ORIGIN + "/",
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    throw new Error("HTTP " + r.status + " — " + (await r.text()).slice(0, 250));
  }
  return r.json();
}

const games = [];
for (let p = 1; p <= PAGES; p++) {
  const j = await getPage(p);
  for (const g of j.data || []) {
    if (!g.thumb) continue;
    games.push({
      id: g.id,
      name: g.name,
      slug: g.slug,
      provider: g.provider || "",
      type: g.type || "",
      thumb: g.thumb,
      rtp: g.rtp ?? null,
      volatility: g.volatility || "",
    });
  }
  const last = (j.meta && j.meta.last_page) || 1;
  console.log("página " + p + " — acumulado " + games.length + " juegos");
  if (p >= last) break;
}

await mkdir("public/slots", { recursive: true });
await writeFile(
  "public/slots/games.json",
  JSON.stringify({ updated: new Date().toISOString(), count: games.length, games })
);
console.log("OK: " + games.length + " juegos escritos en public/slots/games.json");
