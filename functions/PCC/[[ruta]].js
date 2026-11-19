/**
 * Fichas de organizaciones: si la red aprobó cambios desde el panel, se reemplaza el contenido
 * de <main> de la página estática por la versión publicada. Si no, se sirve la página tal cual.
 * Con ?vista=<id> la red puede ver un cambio pendiente antes de aprobarlo.
 */
import { FICHAS, renderFicha, usuarioActual } from "../_lib/util.js";

const ESTILO = `<style>
.ficha-lugar{font-size:18px}
.ficha-redes{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}
.ficha-redes a{display:inline-block;background:#a90055;color:#fff!important;text-decoration:none;border-radius:999px;padding:8px 18px;font-size:14px}
.ficha-redes a:hover{background:#8e0048}
.aviso-vista{background:#fff4c2;border:2px dashed #c9a400;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:14px}
</style>`;

export async function onRequestGet(context) {
  const { request, env, params, next } = context;
  const partes = (params.ruta || []).filter(Boolean);
  const slug = partes[0];
  const esFicha = slug && FICHAS[slug] && (partes.length === 1 || (partes.length === 2 && partes[1] === "index.html"));
  if (!esFicha) return next();

  let datos = null;
  let aviso = "";
  const vista = new URL(request.url).searchParams.get("vista");
  if (vista && /^\d+$/.test(vista)) {
    const yo = await usuarioActual(env, request);
    if (yo && (yo.rol === "admin" || yo.org === slug)) {
      const c = await env.DB.prepare("SELECT datos, estado FROM cambios WHERE id = ? AND org = ?").bind(Number(vista), slug).first();
      if (c) {
        datos = JSON.parse(c.datos);
        aviso = c.estado === "pendiente"
          ? `<div class="aviso-vista"><strong>Vista previa:</strong> así se verá la ficha si se aprueba este cambio. Todavía no está publicada.</div>`
          : `<div class="aviso-vista"><strong>Versión #${Number(vista)}:</strong> así se veía la ficha con esta versión. Puede no ser la que está publicada ahora.</div>`;
      }
    }
  }
  if (!datos) {
    const pub = await env.DB.prepare("SELECT datos FROM publicadas WHERE org = ?").bind(slug).first();
    if (pub) datos = JSON.parse(pub.datos);
  }

  const respuesta = await next();
  if (!datos || !respuesta.ok || !(respuesta.headers.get("content-type") || "").includes("text/html")) return respuesta;

  const html = ESTILO + aviso + renderFicha(slug, datos);
  const nueva = new HTMLRewriter()
    .on("main", { element: (el) => el.setInnerContent(html, { html: true }) })
    .transform(respuesta);
  const h = new Headers(nueva.headers);
  h.set("cache-control", aviso ? "no-store" : "public, max-age=60");
  h.delete("etag");
  return new Response(nueva.body, { status: nueva.status, headers: h });
}
