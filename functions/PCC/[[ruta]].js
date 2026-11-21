/**
 * Fichas de organizaciones y directorio /PCC/.
 * - Si la red aprobó cambios desde el panel, se reemplaza el contenido de <main> por la versión publicada.
 * - Las organizaciones creadas en el panel se sirven con la plantilla /PCC/plantilla-ficha/.
 * - Las organizaciones quitadas de la página redirigen al directorio.
 * - El directorio refleja altas, bajas y cambios de nombre o comuna.
 * Con ?vista=<id> la red puede ver un cambio pendiente o una versión anterior.
 */
import { baseDeFicha, escapar, organizacion, organizaciones, renderFicha, usuarioActual } from "../_lib/util.js";

const PLANTILLA = "/PCC/plantilla-ficha/";

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
  if (partes.length === 0 || (partes.length === 1 && partes[0] === "index.html")) return directorio(context);

  const slug = partes[0];
  const url = new URL(request.url);
  const esPagina = partes.length === 1 || (partes.length === 2 && partes[1] === "index.html");
  if (slug === "plantilla-ficha") return Response.redirect(new URL("/PCC/", url), 302);
  if (!esPagina) return next();
  const f = await organizacion(env, slug);
  if (!f) return next();

  const yo = await usuarioActual(env, request);
  const esRed = yo && (yo.rol === "admin" || yo.org === slug);
  if (f.oculta && !(yo && yo.rol === "admin")) return Response.redirect(new URL("/PCC/", url), 302);

  let datos = null;
  let aviso = "";
  const vista = url.searchParams.get("vista");
  if (vista && /^\d+$/.test(vista) && esRed) {
    const c = await env.DB.prepare("SELECT datos, estado FROM cambios WHERE id = ? AND org = ?").bind(Number(vista), slug).first();
    if (c) {
      datos = JSON.parse(c.datos);
      aviso = c.estado === "pendiente"
        ? `<div class="aviso-vista"><strong>Vista previa:</strong> así se verá la ficha si se aprueba este cambio. Todavía no está publicada.</div>`
        : `<div class="aviso-vista"><strong>Versión #${Number(vista)}:</strong> así se veía la ficha con esta versión. Puede no ser la que está publicada ahora.</div>`;
    }
  }
  if (f.oculta) aviso = `<div class="aviso-vista"><strong>Esta organización está quitada de la página.</strong> Solo la coordinación la puede ver. Para mostrarla de nuevo, entra a «Puntos de cultura» en el panel.</div>` + aviso;
  if (!datos) {
    const pub = await env.DB.prepare("SELECT datos FROM publicadas WHERE org = ?").bind(slug).first();
    if (pub) datos = JSON.parse(pub.datos);
  }
  if (!datos && f.nueva) datos = baseDeFicha(f);

  const respuesta = f.nueva ? await env.ASSETS.fetch(new URL(PLANTILLA, url)) : await next();
  if (!respuesta.ok || !(respuesta.headers.get("content-type") || "").includes("text/html")) return respuesta;
  // Sin cambios del panel: la página estática tal cual
  if (!datos && !f.cambiada && !aviso) return respuesta;

  const reescribir = new HTMLRewriter();
  if (datos) {
    const html = ESTILO + aviso + renderFicha(f, datos);
    reescribir.on("main", { element: (el) => el.setInnerContent(html, { html: true }) });
  } else {
    if (aviso) reescribir.on("main", { element: (el) => el.prepend(ESTILO + aviso, { html: true }) });
    if (f.cambiada) reescribir.on("main h1", { element: (el) => el.setInnerContent(f.nombre) });
  }
  if (f.nueva || f.cambiada) {
    const titulo = `${f.nombre} | Red PCC O’Higgins`;
    const meta = (sel, valor) => reescribir.on(sel, { element: (el) => el.setAttribute("content", valor) });
    reescribir.on("title", { element: (el) => el.setInnerContent(titulo) });
    meta('meta[property="og:title"]', titulo);
    if (f.nueva) {
      const r = String(datos?.resena || "").replace(/\s+/g, " ").trim();
      const desc = r ? (r.length > 160 ? r.slice(0, 157).replace(/\s+\S*$/, "") + "…" : r)
        : `${f.nombre}, Punto de Cultura Comunitaria${f.comuna ? " de " + f.comuna : ""} en la Red PCC O’Higgins.`;
      meta('meta[name="description"]', desc);
      meta('meta[property="og:description"]', desc);
      meta('meta[property="og:url"]', `${url.origin}/PCC/${slug}/`);
    }
  }
  const nueva = reescribir.transform(respuesta);
  const h = new Headers(nueva.headers);
  h.set("cache-control", aviso ? "no-store" : "public, max-age=0, must-revalidate");
  h.delete("etag");
  if (f.cambiada && !datos) {
    // Página estática con comuna cambiada: se ajusta la línea «Punto de Cultura Comunitaria · comuna»
    const html = (await nueva.text()).replace(
      /(<strong>Punto de Cultura Comunitaria<\/strong> · )[^<]*/,
      (_, a) => a + escapar(f.comuna),
    );
    h.delete("content-length");
    return new Response(html, { status: nueva.status, headers: h });
  }
  return new Response(nueva.body, { status: nueva.status, headers: h });
}

/** Directorio /PCC/: quita las organizaciones ocultas, aplica cambios de nombre y agrega las nuevas. */
async function directorio({ env, next }) {
  const respuesta = await next();
  const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM organizaciones").first();
  if (!n || !respuesta.ok || !(respuesta.headers.get("content-type") || "").includes("text/html")) return respuesta;

  const O = await organizaciones(env);
  const item = (o) => `<li><strong><a href="${o.slug}/index.html">${escapar(o.nombre)}</a></strong><span>${escapar(o.comuna)}</span></li>`;
  let html = await respuesta.text();

  // Lista principal
  html = html.replace(/<li><strong><a href="([a-z0-9-]+)\/index\.html">[\s\S]*?<\/a><\/strong><span>[\s\S]*?<\/span><\/li>/g, (todo, slug) => {
    const o = O[slug];
    if (!o) return todo;
    if (o.oculta) return "";
    return o.cambiada ? item(o) : todo;
  });
  // Otras fichas recuperadas
  html = html.replace(/<li><a href="([a-z0-9-]+)\/index\.html">([\s\S]*?)<\/a><\/li>/g, (todo, slug) => {
    const o = O[slug];
    if (!o) return todo;
    if (o.oculta) return "";
    return o.cambiada ? `<li><a href="${slug}/index.html">${escapar(o.nombre)}</a></li>` : todo;
  });
  // Nuevas, al final de la lista principal
  const nuevas = Object.values(O).filter((o) => o.nueva && !o.oculta);
  const inicio = html.indexOf('<ul class="directorio-lista">');
  if (nuevas.length && inicio >= 0) {
    const fin = html.indexOf("</ul>", inicio);
    html = html.slice(0, fin) + nuevas.map(item).join("") + html.slice(fin);
  }
  // Si «Otras fichas recuperadas» quedó vacía, se saca la sección
  html = html.replace(/<section class="directorio-historico">(?:(?!<\/section>)[\s\S])*?<ul><\/ul><\/section>/, "");

  const h = new Headers(respuesta.headers);
  h.set("cache-control", "public, max-age=0, must-revalidate");
  h.delete("etag");
  h.delete("content-length");
  return new Response(html, { status: respuesta.status, headers: h });
}
