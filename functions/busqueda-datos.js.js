/**
 * Índice del buscador (/busqueda-datos.js). Parte del archivo estático y le aplica lo hecho en el panel:
 * saca las organizaciones quitadas, agrega las nuevas y usa el nombre, la comuna y la reseña publicados.
 */
import { organizaciones } from "./_lib/util.js";

const PREFIJO = "window.PCC_SEARCH_INDEX = ";

export async function onRequestGet({ env, next }) {
  const respuesta = await next();
  if (!respuesta.ok) return respuesta;
  const [{ results: filas }, { results: pubs }] = await env.DB.batch([
    env.DB.prepare("SELECT slug FROM organizaciones"),
    env.DB.prepare("SELECT org, datos FROM publicadas"),
  ]);
  if (!filas.length && !pubs.length) return respuesta;

  const texto = await respuesta.text();
  let indice;
  try {
    indice = JSON.parse(texto.slice(texto.indexOf("[")).trim().replace(/;$/, ""));
  } catch {
    return new Response(texto, respuesta);
  }

  const O = await organizaciones(env);
  const P = Object.fromEntries(pubs.map((p) => [p.org, JSON.parse(p.datos)]));
  const entrada = (o, resena) => {
    const lugar = `Punto de Cultura Comunitaria${o.comuna ? " · " + o.comuna : ""}`;
    return { title: o.nombre, url: `PCC/${o.slug}/index.html`, text: `${lugar} ${resena || ""}`.trim(), excerpt: lugar };
  };

  const vistos = new Set();
  const salida = [];
  for (const x of indice) {
    const m = /^PCC\/([a-z0-9-]+)\/index\.html$/.exec(x.url || "");
    const o = m && O[m[1]];
    if (!o) {
      salida.push(x);
      continue;
    }
    vistos.add(o.slug);
    if (o.oculta) continue;
    salida.push(P[o.slug] || o.cambiada ? entrada(o, P[o.slug]?.resena ?? o.resena) : x);
  }
  for (const o of Object.values(O)) if (o.nueva && !o.oculta && !vistos.has(o.slug)) salida.push(entrada(o, P[o.slug]?.resena));

  const h = new Headers(respuesta.headers);
  h.set("content-type", "application/javascript; charset=utf-8");
  h.set("cache-control", "public, max-age=0, must-revalidate");
  h.delete("etag");
  h.delete("content-length");
  return new Response(PREFIJO + JSON.stringify(salida) + ";", { status: 200, headers: h });
}
