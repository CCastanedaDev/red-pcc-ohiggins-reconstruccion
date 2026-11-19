import FICHAS from "./fichas.json";

export { FICHAS };

export const SESION_DIAS = 14;
const ITERACIONES = 100000; // máximo que permite Workers para PBKDF2
const COOKIE = "pcc_sesion";

export function json(datos, estado = 200, extra = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export function error(mensaje, estado = 400) {
  return json({ error: mensaje }, estado);
}

export const ahora = () => Math.floor(Date.now() / 1000);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const deHex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

export function aleatorio(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashClave(clave, salHex = aleatorio(16)) {
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: deHex(salHex), iterations: ITERACIONES },
    llave,
    256,
  );
  return { hash: hex(bits), sal: salHex };
}

export function igualSeguro(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function sha256(texto) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

/** Clave temporal fácil de dictar por WhatsApp: tres palabras y un número. */
const PALABRAS = [
  "maqui", "boldo", "quillay", "peumo", "litre", "copihue", "canelo", "chagual", "queltehue", "chincol",
  "zorzal", "loica", "tenca", "diuca", "picaflor", "lechuza", "huemul", "pudu", "guanaco", "cometa",
  "volantin", "trompo", "charango", "guitarra", "bombo", "cueca", "tonada", "telar", "greda", "mimbre",
  "ruana", "chamanto", "sandia", "durazno", "membrillo", "nogal", "palmera", "laguna", "cerro", "estero",
];
export function claveTemporal() {
  const n = crypto.getRandomValues(new Uint32Array(4));
  const p = (i) => PALABRAS[n[i] % PALABRAS.length];
  return `${p(0)}-${p(1)}-${p(2)}-${10 + (n[3] % 90)}`;
}

export function leerCookie(request, nombre = COOKIE) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? m[1] : null;
}

export function cookieSesion(token, request) {
  const segura = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const edad = token ? SESION_DIAS * 86400 : 0;
  return `${COOKIE}=${token || ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${edad}${segura}`;
}

export async function usuarioActual(env, request) {
  const token = leerCookie(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const fila = await env.DB.prepare(
    `SELECT u.id, u.usuario, u.nombre, u.rol, u.org, u.debe_cambiar, u.super
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira > ? AND u.activo = 1`,
  )
    .bind(await sha256(token), ahora())
    .first();
  return fila || null;
}

export function escapar(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ---------- Datos de una ficha ---------- */

export const REDES = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
  ["spotify", "Spotify"],
  ["whatsapp", "WhatsApp"],
  ["web", "Sitio web"],
];

export function baseDeFicha(slug) {
  const f = FICHAS[slug];
  if (!f) return null;
  const redes = { ...f.redes };
  if (redes.web && /wa\.me|whatsapp/.test(redes.web)) {
    redes.whatsapp = redes.web;
    delete redes.web;
  }
  return {
    resena: f.resena,
    redes,
    logo: f.logo,
    portada: f.portada,
    galeria: f.galeria,
  };
}

export async function fichaVigente(env, slug) {
  const pub = await env.DB.prepare("SELECT datos FROM publicadas WHERE org = ?").bind(slug).first();
  return pub ? JSON.parse(pub.datos) : baseDeFicha(slug);
}

const URL_FOTO = /^\/(medios\/[0-9a-f]{32}|wp-content\/uploads\/[\w\-./%]+\.(webp|jpe?g|png|gif))$/i;

/** Valida y limpia lo que envía el panel. Devuelve {datos} o {error}. */
export async function validarFicha(env, slug, entrada) {
  if (!entrada || typeof entrada !== "object") return { error: "Datos inválidos" };
  const texto = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

  const resena = texto(entrada.resena, 6000);
  if (resena.length < 20) return { error: "La reseña es muy corta." };

  const redes = {};
  for (const [clave] of REDES) {
    let v = texto(entrada.redes?.[clave], 300);
    if (!v) continue;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v.replace(/^\/+/, "");
    try {
      const u = new URL(v);
      if (!["http:", "https:"].includes(u.protocol)) throw 0;
      redes[clave] = u.toString();
    } catch {
      return { error: `El enlace de ${clave} no es válido.` };
    }
  }

  // Solo se permiten fotos de la propia ficha (base) o subidas por la misma organización
  const base = baseDeFicha(slug);
  const permitidas = new Set([base.logo, base.portada, ...base.galeria.map((g) => g.src)].filter(Boolean));
  const propias = await env.DB.prepare("SELECT id FROM fotos WHERE org = ?").bind(slug).all();
  for (const r of propias.results) permitidas.add(`/medios/${r.id}`);
  const vigente = await fichaVigente(env, slug);
  for (const s of [vigente.logo, vigente.portada, ...vigente.galeria.map((g) => g.src)]) if (s) permitidas.add(s);

  const foto = (src) => {
    src = texto(src, 300);
    if (!src) return "";
    if (!URL_FOTO.test(src) || !permitidas.has(src)) throw new Error("foto");
    return src;
  };
  try {
    const galeria = (Array.isArray(entrada.galeria) ? entrada.galeria : []).slice(0, 40).map((g) => ({
      src: foto(g?.src),
      texto: texto(g?.texto, 200),
    })).filter((g) => g.src);
    return { datos: { resena, redes, logo: foto(entrada.logo), portada: foto(entrada.portada), galeria } };
  } catch {
    return { error: "Hay una foto que no pertenece a esta ficha." };
  }
}

/* ---------- Render de la ficha pública ---------- */

function parrafos(t) {
  return String(t || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapar(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function lista(items) {
  return `<ul class="lista-recuperada">${items
    .map((i) => `<li><a href="${escapar(i.url)}">${escapar(i.titulo)}</a></li>`)
    .join("")}</ul>`;
}

export function renderFicha(slug, d) {
  const f = FICHAS[slug];
  const nombre = escapar(f.nombre);
  let h = `<h1>${nombre}</h1>`;
  if (d.logo) h += `<figure class="organizacion-logo"><img src="${escapar(d.logo)}" alt="Logotipo de ${nombre}" loading="lazy"></figure>`;
  if (d.portada) h += `<figure class="imagen-destacada"><img src="${escapar(d.portada)}" alt="Foto principal de ${nombre}" loading="eager"></figure>`;
  if (f.comuna) h += `<p class="ficha-lugar"><strong>Punto de Cultura Comunitaria</strong> · ${escapar(f.comuna)}</p>`;
  h += `<div class="ficha-resena">${parrafos(d.resena)}</div>`;

  const redes = REDES.filter(([k]) => d.redes?.[k]);
  if (redes.length) {
    h += `<ul class="ficha-redes">${redes
      .map(([k, etiqueta]) => `<li><a href="${escapar(d.redes[k])}" target="_blank" rel="noopener">${etiqueta}</a></li>`)
      .join("")}</ul>`;
  }
  if (f.plan) {
    h += `<h2>${escapar(f.plan.titulo)}</h2>`;
    if (f.plan.subtitulo) h += `<h3>${escapar(f.plan.subtitulo)}</h3>`;
    h += parrafos(f.plan.texto);
  }
  if (d.galeria?.length) {
    h += `<section class="galeria-recuperada" aria-label="Registro fotográfico de ${nombre}"><h2>Registro fotográfico</h2><div class="galeria-recuperada-grid">${d.galeria
      .map(
        (g) =>
          `<figure><img src="${escapar(g.src)}" alt="${escapar(g.texto || "Registro de " + f.nombre)}" loading="lazy">${
            g.texto ? `<figcaption>${escapar(g.texto)}</figcaption>` : ""
          }</figure>`,
      )
      .join("")}</div></section>`;
  }
  if (f.proyectos.length) h += `<h2>Proyectos</h2>${lista(f.proyectos)}`;
  if (f.noticias.length) h += `<h2>Noticias</h2>${lista(f.noticias)}`;
  return h;
}
