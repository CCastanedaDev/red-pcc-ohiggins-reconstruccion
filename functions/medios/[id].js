export async function onRequestGet({ params, env }) {
  const id = String(params.id || "");
  if (!/^[0-9a-f]{32}$/.test(id)) return new Response("No encontrado", { status: 404 });
  const f = await env.DB.prepare("SELECT tipo, datos FROM fotos WHERE id = ?").bind(id).first();
  if (!f) return new Response("No encontrado", { status: 404 });
  return new Response(f.datos instanceof ArrayBuffer ? f.datos : new Uint8Array(f.datos), {
    headers: {
      "content-type": f.tipo,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
