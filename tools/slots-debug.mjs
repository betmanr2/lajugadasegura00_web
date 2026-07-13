// Diagnóstico rápido de la API de Slotslaunch.
// Uso:  $env:SLOTSLAUNCH_TOKEN="tu_token"; node tools/slots-debug.mjs

const TOKEN = process.env.SLOTSLAUNCH_TOKEN;
const ORIGIN = process.env.SLOTS_ORIGIN || "https://lajugadasegura00.com";

if (!TOKEN) {
  console.error("Falta SLOTSLAUNCH_TOKEN");
  process.exit(1);
}

async function q(url) {
  const r = await fetch(url, {
    headers: {
      Authorization: "Bearer " + TOKEN,
      Origin: ORIGIN,
      Referer: ORIGIN + "/",
      Accept: "application/json",
    },
  });
  return { status: r.status, text: await r.text() };
}

console.log("ORIGIN usado:", ORIGIN);

const games = await q("https://slotslaunch.com/api/games?per_page=3&page=1");
console.log("\n== /api/games (sin filtros) — HTTP " + games.status + " ==");
console.log(games.text.slice(0, 1500));

const prov = await q("https://slotslaunch.com/api/providers?per_page=3&page=1");
console.log("\n== /api/providers — HTTP " + prov.status + " ==");
console.log(prov.text.slice(0, 600));
