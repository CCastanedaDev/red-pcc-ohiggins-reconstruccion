import {
  FICHAS, SESION_DIAS, ahora, aleatorio, claveTemporal, cookieSesion, error, fichaVigente,
  hashClave, igualSeguro, json, organizacion, organizaciones, sha256, usuarioActual, validarFicha,
} from "../_lib/util.js";

const MAX_FOTO = 1_500_000;
const MAX_FOTOS_ORG = 150;
const MAX_INTENTOS = 8;
const VENTANA_INTENTOS = 15 * 60;

export async function onRequest(context) {
  const { request, env, params } = context;
  const ruta = (params.ruta || []).join("/");
  const metodo = request.method;

  if (metodo !== "GET" && metodo !== "HEAD") {
    // Protección CSRF: solo se aceptan envíos desde el mismo sitio
    const origen = request.headers.get("origin");
    if (origen && origen !== new URL(request.url).origin) return error("Origen no permitido", 403);
  }

  try {
    if (ruta === "entrar" && metodo === "POST") return await entrar(request, env);
    if (ruta === "salir" && metodo === "POST") return await salir(request, env);

    const yo = await usuarioActual(env, request);
    if (!yo) return error("Tienes que iniciar sesión", 401);

    if (ruta === "yo") {
      let pendientes = 0;
      if (yo.rol === "admin") ({ n: pendientes } = await env.DB.prepare("SELECT COUNT(*) n FROM cambios WHERE estado = 'pendiente'").first());
      return json({ usuario: publico(yo), organizacion: yo.org ? (await organizacion(env, yo.org))?.nombre ?? null : null, pendientes });
    }
    if (ruta === "clave" && metodo === "POST") return await cambiarClave(request, env, yo);
    if (yo.debe_cambiar) return error("Primero tienes que cambiar tu contraseña", 403);

    if (ruta === "ficha" && metodo === "GET") return await verFicha(request, env, yo);
    if (ruta === "ficha" && metodo === "POST") return await guardarFicha(request, env, yo);
    if (ruta === "fotos" && metodo === "POST") return await subirFoto(request, env, yo);

    if (yo.rol !== "admin") return error("No tienes permiso para esto", 403);
    if (ruta === "organizaciones")
      return json(Object.values(await organizaciones(env)).filter((o) => !o.oculta).map((o) => ({ slug: o.slug, nombre: o.nombre })));
    if (ruta === "cambios" && metodo === "GET") return await listarCambios(env);
    let m;
    if ((m = ruta.match(/^cambios\/(\d+)\/(aprobar|rechazar)$/)) && metodo === "POST")
      return await revisar(request, env, yo, Number(m[1]), m[2]);
    if (ruta === "usuarios" && metodo === "GET") return await listarUsuarios(env);
    if (ruta === "usuarios" && metodo === "POST") return await crearUsuario(request, env, yo);
    if ((m = ruta.match(/^usuarios\/(\d+)\/(clave|activo)$/)) && metodo === "POST")
      return await editarUsuario(request, env, yo, Number(m[1]), m[2]);
    if (ruta === "puntos" && metodo === "GET") return await listarPuntos(env);
    if (ruta === "puntos" && metodo === "POST") return await crearPunto(request, env, yo);
    if ((m = ruta.match(/^puntos\/([a-z0-9-]+)\/(confianza|original|datos|quitar|mostrar|borrar)$/)) && metodo === "POST")
      return await editarPunto(request, env, yo, m[1], m[2]);
    if (ruta === "historial" && metodo === "GET") return await historial(request, env);
    if ((m = ruta.match(/^historial\/(\d+)\/restaurar$/)) && metodo === "POST")
      return await restaurar(env, yo, Number(m[1]));

    return error("No encontrado", 404);
  } catch (e) {
    console.error(e);
    return error("Algo falló en el servidor. Intenta de nuevo.", 500);
  }
}

const publico = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, org: u.org, debe_cambiar: !!u.debe_cambiar, super: !!u.super });

/** Deja constancia de una acción en el historial (devuelve la sentencia para usarla en un batch). */
function anotar(env, yo, org, accion, detalle = "") {
  return env.DB.prepare("INSERT INTO registro (ts, usuario_id, org, accion, detalle) VALUES (?, ?, ?, ?, ?)")
    .bind(ahora(), yo ? yo.id : null, org || null, accion, String(detalle).slice(0, 500));
}

async function esDeConfianza(env, slug) {
  return !!(await env.DB.prepare("SELECT 1 FROM confianza WHERE org = ?").bind(slug).first());
}

async function leerJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/* ---------- Sesión ---------- */

async function entrar(request, env) {
  const { usuario = "", clave = "" } = await leerJson(request);
  const nombre = String(usuario).trim().toLowerCase().slice(0, 60);
  if (!nombre || !clave) return error("Escribe tu usuario y contraseña");

  const desde = ahora() - VENTANA_INTENTOS;
  const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM intentos WHERE usuario = ? AND ts > ?").bind(nombre, desde).first();
  if (n >= MAX_INTENTOS) return error("Demasiados intentos. Espera 15 minutos e intenta de nuevo.", 429);

  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ? AND activo = 1").bind(nombre).first();
  const { hash } = await hashClave(String(clave), u ? u.sal : "00".repeat(16));
  if (!u || !igualSeguro(hash, u.hash)) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO intentos (usuario, ts) VALUES (?, ?)").bind(nombre, ahora()),
      env.DB.prepare("DELETE FROM intentos WHERE ts < ?").bind(ahora() - 86400),
    ]);
    return error("Usuario o contraseña incorrectos", 401);
  }

  const token = aleatorio(32);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, ?)").bind(await sha256(token), u.id, ahora() + SESION_DIAS * 86400),
    env.DB.prepare("DELETE FROM sesiones WHERE expira < ?").bind(ahora()),
    env.DB.prepare("DELETE FROM intentos WHERE usuario = ?").bind(nombre),
    env.DB.prepare("UPDATE usuarios SET ultimo_ingreso = ? WHERE id = ?").bind(ahora(), u.id),
  ]);
  return json({ usuario: publico(u) }, 200, { "set-cookie": cookieSesion(token, request) });
}

async function salir(request, env) {
  const m = (request.headers.get("cookie") || "").match(/pcc_sesion=([0-9a-f]{64})/);
  if (m) await env.DB.prepare("DELETE FROM sesiones WHERE token_hash = ?").bind(await sha256(m[1])).run();
  return json({ ok: true }, 200, { "set-cookie": cookieSesion(null, request) });
}

async function cambiarClave(request, env, yo) {
  const { actual = "", nueva = "" } = await leerJson(request);
  if (String(nueva).length < 8) return error("La contraseña nueva debe tener al menos 8 caracteres");
  const u = await env.DB.prepare("SELECT hash, sal FROM usuarios WHERE id = ?").bind(yo.id).first();
  const { hash } = await hashClave(String(actual), u.sal);
  if (!igualSeguro(hash, u.hash)) return error("La contraseña actual no es correcta", 401);
  const n = await hashClave(String(nueva));
  await env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ?, debe_cambiar = 0 WHERE id = ?").bind(n.hash, n.sal, yo.id).run();
  return json({ ok: true });
}

/* ---------- Ficha ---------- */

function orgPedida(request, yo) {
  if (yo.rol === "org") return yo.org;
  return new URL(request.url).searchParams.get("org");
}

async function verFicha(request, env, yo) {
  const slug = orgPedida(request, yo);
  const f = await organizacion(env, slug);
  if (!f) return error("Ficha no encontrada", 404);
  const pendiente = await env.DB.prepare("SELECT id, datos, creado FROM cambios WHERE org = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1").bind(slug).first();
  const ultimo = await env.DB.prepare("SELECT estado, comentario, revisado FROM cambios WHERE org = ? AND estado IN ('aprobado','rechazado') ORDER BY id DESC LIMIT 1").bind(slug).first();
  return json({
    ficha: { slug, nombre: f.nombre, comuna: f.comuna, url: `/PCC/${slug}/`, oculta: f.oculta },
    vigente: await fichaVigente(env, f),
    pendiente: pendiente ? { id: pendiente.id, datos: JSON.parse(pendiente.datos), creado: pendiente.creado } : null,
    ultimo,
    confianza: await esDeConfianza(env, slug),
  });
}

async function guardarFicha(request, env, yo) {
  const slug = orgPedida(request, yo);
  const f = await organizacion(env, slug);
  if (!f) return error("Ficha no encontrada", 404);
  const { datos } = await leerJson(request);
  const v = await validarFicha(env, f, datos);
  if (v.error) return error(v.error);
  const t = ahora();
  const texto = JSON.stringify(v.datos);

  if (yo.rol === "admin" || (await esDeConfianza(env, slug))) {
    // La red y los puntos de confianza publican directo
    const r = await env.DB.prepare("INSERT INTO cambios (org, usuario_id, datos, estado, creado, revisado, revisor_id) VALUES (?, ?, ?, 'aprobado', ?, ?, ?) RETURNING id")
      .bind(slug, yo.id, texto, t, t, yo.id).first();
    await env.DB.batch([
      env.DB.prepare("UPDATE cambios SET estado = 'reemplazado' WHERE org = ? AND estado = 'pendiente'").bind(slug),
      publicar(env, slug, texto, r.id),
      anotar(env, yo, slug, "publico", `Versión #${r.id}`),
    ]);
    return json({ ok: true, publicado: true });
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE cambios SET estado = 'reemplazado' WHERE org = ? AND estado = 'pendiente'").bind(slug),
    env.DB.prepare("INSERT INTO cambios (org, usuario_id, datos, creado) VALUES (?, ?, ?, ?)").bind(slug, yo.id, texto, t),
    anotar(env, yo, slug, "envio", "Cambios enviados a revisión"),
  ]);
  return json({ ok: true, publicado: false });
}

function publicar(env, slug, texto, cambioId) {
  return env.DB.prepare(
    `INSERT INTO publicadas (org, datos, cambio_id, actualizado) VALUES (?, ?, ?, ?)
     ON CONFLICT(org) DO UPDATE SET datos = excluded.datos, cambio_id = excluded.cambio_id, actualizado = excluded.actualizado`,
  ).bind(slug, texto, cambioId, ahora());
}

function tipoImagen(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function subirFoto(request, env, yo) {
  const slug = orgPedida(request, yo);
  if (!(await organizacion(env, slug))) return error("Ficha no encontrada", 404);
  const largo = Number(request.headers.get("content-length") || 0);
  if (largo > MAX_FOTO) return error("La foto es muy pesada", 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_FOTO || bytes.byteLength < 100) return error("La foto es muy pesada o está vacía", 413);
  const tipo = tipoImagen(bytes);
  if (!tipo) return error("El archivo no es una foto válida");
  const ancho = Math.min(Number(request.headers.get("x-ancho")) || 0, 4000);
  const alto = Math.min(Number(request.headers.get("x-alto")) || 0, 4000);

  const { n } = await env.DB.prepare("SELECT COUNT(*) n FROM fotos WHERE org = ?").bind(slug).first();
  if (n >= MAX_FOTOS_ORG) return error("Llegaron al máximo de fotos. Escríbanle a la red.", 413);

  const id = aleatorio(16);
  await env.DB.prepare("INSERT INTO fotos (id, org, usuario_id, tipo, ancho, alto, bytes, datos, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, slug, yo.id, tipo, ancho, alto, bytes.byteLength, bytes, ahora())
    .run();
  return json({ src: `/medios/${id}` });
}

/* ---------- Revisión (red) ---------- */

async function listarCambios(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.org, c.datos, c.creado, u.usuario, u.nombre
       FROM cambios c JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.estado = 'pendiente' ORDER BY c.creado`,
  ).all();
  const O = await organizaciones(env);
  const salida = [];
  for (const c of results) {
    if (!O[c.org]) continue;
    salida.push({
      id: c.id,
      org: c.org,
      nombre: O[c.org].nombre,
      autor: c.nombre || c.usuario,
      creado: c.creado,
      propuesto: JSON.parse(c.datos),
      vigente: await fichaVigente(env, O[c.org]),
    });
  }
  return json(salida);
}

async function revisar(request, env, yo, id, accion) {
  const c = await env.DB.prepare("SELECT * FROM cambios WHERE id = ? AND estado = 'pendiente'").bind(id).first();
  if (!c) return error("Ese cambio ya fue revisado", 404);
  const { comentario = "" } = await leerJson(request);
  const t = ahora();
  const estado = accion === "aprobar" ? "aprobado" : "rechazado";
  const pasos = [
    env.DB.prepare("UPDATE cambios SET estado = ?, comentario = ?, revisado = ?, revisor_id = ? WHERE id = ?")
      .bind(estado, String(comentario).slice(0, 1000), t, yo.id, id),
  ];
  if (estado === "aprobado") pasos.push(publicar(env, c.org, c.datos, id));
  pasos.push(anotar(env, yo, c.org, estado === "aprobado" ? "aprobo" : "rechazo", `Versión #${id}${comentario ? " · " + comentario : ""}`));
  await env.DB.batch(pasos);
  return json({ ok: true, estado });
}

/* ---------- Usuarios (red) ---------- */

async function listarUsuarios(env) {
  const { results } = await env.DB.prepare("SELECT id, usuario, nombre, rol, org, activo, debe_cambiar, super, creado, ultimo_ingreso FROM usuarios ORDER BY super DESC, rol, usuario").all();
  const O = await organizaciones(env);
  return json(results.map((u) => ({ ...u, organizacion: u.org ? O[u.org]?.nombre ?? u.org : null })));
}

async function crearUsuario(request, env, yo) {
  const d = await leerJson(request);
  const usuario = String(d.usuario || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return error("El usuario solo puede tener letras sin tilde, números, punto o guion (3 a 40)");
  const rol = d.rol === "admin" ? "admin" : "org";
  const org = rol === "org" ? String(d.org || "") : null;
  if (rol === "org") {
    const o = await organizacion(env, org);
    if (!o) return error("Elige la organización");
    if (o.oculta) return error("Esa organización está quitada de la página. Vuelve a mostrarla antes de darle acceso.");
  }
  const existe = await env.DB.prepare("SELECT 1 FROM usuarios WHERE usuario = ?").bind(usuario).first();
  if (existe) return error("Ese usuario ya existe");
  const clave = claveTemporal();
  const h = await hashClave(clave);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO usuarios (usuario, nombre, rol, org, hash, sal, creado) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(usuario, String(d.nombre || "").trim().slice(0, 80), rol, org, h.hash, h.sal, ahora()),
    anotar(env, yo, org, "acceso", rol === "admin" ? `Cuenta de coordinación «${usuario}»` : `Acceso «${usuario}»`),
  ]);
  return json({ ok: true, usuario, clave });
}

async function editarUsuario(request, env, yo, id, accion) {
  const u = await env.DB.prepare("SELECT id, usuario, org, super FROM usuarios WHERE id = ?").bind(id).first();
  if (!u) return error("Usuario no encontrado", 404);
  if (u.super && !yo.super) return error("Esta cuenta es de soporte técnico y no se puede modificar desde aquí", 403);
  if (accion === "clave") {
    const clave = claveTemporal();
    const h = await hashClave(clave);
    await env.DB.batch([
      env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ?, debe_cambiar = 1 WHERE id = ?").bind(h.hash, h.sal, id),
      env.DB.prepare("DELETE FROM sesiones WHERE usuario_id = ?").bind(id),
      anotar(env, yo, u.org, "clave", `Contraseña nueva para «${u.usuario}»`),
    ]);
    return json({ ok: true, clave });
  }
  if (id === yo.id) return error("No puedes desactivarte a ti misma/o");
  const { activo } = await leerJson(request);
  const pasos = [env.DB.prepare("UPDATE usuarios SET activo = ? WHERE id = ?").bind(activo ? 1 : 0, id)];
  if (!activo) pasos.push(env.DB.prepare("DELETE FROM sesiones WHERE usuario_id = ?").bind(id));
  pasos.push(anotar(env, yo, u.org, activo ? "activo" : "desactivo", `«${u.usuario}»`));
  await env.DB.batch(pasos);
  return json({ ok: true });
}

/* ---------- Puntos de cultura (red) ---------- */

async function listarPuntos(env) {
  const [us, pend, pub, conf, ult] = await env.DB.batch([
    env.DB.prepare("SELECT id, usuario, nombre, org, activo, debe_cambiar, ultimo_ingreso FROM usuarios WHERE rol = 'org' ORDER BY usuario"),
    env.DB.prepare("SELECT org, MAX(id) id, MAX(creado) creado FROM cambios WHERE estado = 'pendiente' GROUP BY org"),
    env.DB.prepare("SELECT org, actualizado FROM publicadas"),
    env.DB.prepare("SELECT org FROM confianza"),
    env.DB.prepare("SELECT org, MAX(ts) ts FROM registro WHERE org IS NOT NULL GROUP BY org"),
  ]);
  const por = (r) => Object.fromEntries(r.results.map((x) => [x.org, x]));
  const P = por(pend), U = por(pub), C = por(conf), L = por(ult);
  return json(
    Object.values(await organizaciones(env)).map((f) => ({
      slug: f.slug,
      nombre: f.nombre,
      comuna: f.comuna,
      nueva: f.nueva,
      oculta: f.oculta,
      cuentas: us.results.filter((u) => u.org === f.slug),
      pendiente: P[f.slug] ? { id: P[f.slug].id, creado: P[f.slug].creado } : null,
      editada: U[f.slug] ? U[f.slug].actualizado : null,
      confianza: !!C[f.slug],
      actividad: L[f.slug] ? L[f.slug].ts : null,
    })),
  );
}

const RESERVADOS = new Set(["index-html", "plantilla-ficha", "nueva", "panel"]);

function slugDe(nombre) {
  return nombre
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/, "");
}

function leerDatosPunto(d) {
  const nombre = String(d.nombre || "").replace(/\s+/g, " ").trim();
  const comuna = String(d.comuna || "").replace(/\s+/g, " ").trim();
  if (nombre.length < 3 || nombre.length > 120) return { error: "Escribe el nombre de la organización (3 a 120 letras)" };
  if (comuna.length > 60) return { error: "El nombre de la comuna es muy largo" };
  return { nombre, comuna };
}

async function crearPunto(request, env, yo) {
  const d = leerDatosPunto(await leerJson(request));
  if (d.error) return error(d.error);
  const O = await organizaciones(env);
  const repetida = Object.values(O).find((o) => o.nombre.toLowerCase() === d.nombre.toLowerCase());
  if (repetida) return error(`Ya existe «${repetida.nombre}»${repetida.oculta ? " (está quitada de la página: puedes volver a mostrarla)" : ""}.`);
  const base = slugDe(d.nombre);
  if (base.length < 3) return error("El nombre tiene que tener letras o números");
  let slug = base;
  for (let i = 2; O[slug] || FICHAS[slug] || RESERVADOS.has(slug); i++) slug = `${base}-${i}`;
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizaciones (slug, nombre, comuna, nueva, creada, actualizada) VALUES (?, ?, ?, 1, ?, ?)").bind(slug, d.nombre, d.comuna, t, t),
    anotar(env, yo, slug, "agrego", `«${d.nombre}»${d.comuna ? " · " + d.comuna : ""}`),
  ]);
  return json({ ok: true, slug });
}

async function editarPunto(request, env, yo, slug, accion) {
  const f = await organizacion(env, slug);
  if (!f) return error("Ficha no encontrada", 404);
  const t = ahora();
  // Crea la fila de cambios si no existe; si existe, solo toca los campos indicados
  const fila = (campos) =>
    env.DB.prepare(
      `INSERT INTO organizaciones (slug, nombre, comuna, oculta, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET ${Object.keys(campos).map((k) => `${k} = excluded.${k}`).join(", ")}, actualizada = excluded.actualizada`,
    ).bind(slug, campos.nombre ?? null, campos.comuna ?? null, campos.oculta ?? 0, t, t);

  if (accion === "datos") {
    const d = leerDatosPunto(await leerJson(request));
    if (d.error) return error(d.error);
    const orig = FICHAS[slug];
    // En las fichas del sitio se guarda solo lo que cambia; si vuelve al original queda NULL
    const nombre = orig && d.nombre === orig.nombre ? null : d.nombre;
    const comuna = orig && d.comuna === (orig.comuna || "") ? null : d.comuna;
    const antes = `${f.nombre}${f.comuna ? " · " + f.comuna : ""}`;
    await env.DB.batch([
      fila({ nombre, comuna }),
      anotar(env, yo, slug, "datos", `Antes: «${antes}». Ahora: «${d.nombre}${d.comuna ? " · " + d.comuna : ""}»`),
    ]);
    return json({ ok: true });
  }
  if (accion === "quitar") {
    const { results: cuentas } = await env.DB.prepare("SELECT id FROM usuarios WHERE org = ? AND activo = 1").bind(slug).all();
    await env.DB.batch([
      fila({ oculta: 1 }),
      env.DB.prepare("UPDATE usuarios SET activo = 0 WHERE org = ?").bind(slug),
      env.DB.prepare("DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE org = ?)").bind(slug),
      anotar(env, yo, slug, "quito", cuentas.length === 1 ? "Se desactivó su cuenta" : cuentas.length ? `Se desactivaron sus ${cuentas.length} cuentas` : ""),
    ]);
    return json({ ok: true, cuentas: cuentas.length });
  }
  if (accion === "mostrar") {
    await env.DB.batch([fila({ oculta: 0 }), anotar(env, yo, slug, "mostro", "")]);
    return json({ ok: true });
  }
  if (accion === "borrar") {
    // Solo para organizaciones creadas en el panel por error, que nunca se usaron
    if (!f.nueva) return error("Las organizaciones del sitio no se borran: usa «Quitar de la página».");
    const [u, c, fo] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) n FROM usuarios WHERE org = ?").bind(slug),
      env.DB.prepare("SELECT COUNT(*) n FROM cambios WHERE org = ?").bind(slug),
      env.DB.prepare("SELECT COUNT(*) n FROM fotos WHERE org = ?").bind(slug),
    ]);
    if (u.results[0].n || c.results[0].n || fo.results[0].n)
      return error("Esta organización ya tiene cuentas, fotos o cambios guardados. Usa «Quitar de la página».");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM organizaciones WHERE slug = ?").bind(slug),
      env.DB.prepare("DELETE FROM confianza WHERE org = ?").bind(slug),
      anotar(env, yo, null, "borro", `«${f.nombre}»`),
    ]);
    return json({ ok: true });
  }
  if (accion === "confianza") {
    const { confianza } = await leerJson(request);
    await env.DB.batch([
      confianza
        ? env.DB.prepare("INSERT OR IGNORE INTO confianza (org, desde, usuario_id) VALUES (?, ?, ?)").bind(slug, ahora(), yo.id)
        : env.DB.prepare("DELETE FROM confianza WHERE org = ?").bind(slug),
      anotar(env, yo, slug, confianza ? "confianza" : "sin-confianza", confianza ? "Publica sin revisión" : "Sus cambios vuelven a pasar por revisión"),
    ]);
    return json({ ok: true });
  }
  // Volver a la ficha original (la del sitio estático)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM publicadas WHERE org = ?").bind(slug),
    anotar(env, yo, slug, "original", "Se volvió a la ficha original del sitio"),
  ]);
  return json({ ok: true });
}

/* ---------- Historial (red) ---------- */

async function historial(request, env) {
  const slug = new URL(request.url).searchParams.get("org");
  const O = await organizaciones(env);
  if (slug && !O[slug]) return error("Ficha no encontrada", 404);
  const nombreDe = (u) => u.nombre || u.usuario || "—";
  const consulta = env.DB.prepare(
    `SELECT r.id, r.ts, r.org, r.accion, r.detalle, u.usuario, u.nombre
       FROM registro r LEFT JOIN usuarios u ON u.id = r.usuario_id
      ${slug ? "WHERE r.org = ?" : ""} ORDER BY r.ts DESC, r.id DESC LIMIT 200`,
  );
  const reg = await (slug ? consulta.bind(slug) : consulta).all();
  const salida = {
    registro: reg.results.map((r) => ({
      id: r.id, ts: r.ts, org: r.org, nombreOrg: r.org ? O[r.org]?.nombre || r.org : null,
      accion: r.accion, detalle: r.detalle, quien: nombreDe(r),
    })),
  };
  if (slug) {
    const v = await env.DB.prepare(
      `SELECT c.id, c.creado, c.revisado, c.comentario, a.usuario, a.nombre, r.usuario r_usuario, r.nombre r_nombre
         FROM cambios c JOIN usuarios a ON a.id = c.usuario_id LEFT JOIN usuarios r ON r.id = c.revisor_id
        WHERE c.org = ? AND c.estado = 'aprobado' ORDER BY c.id DESC LIMIT 50`,
    ).bind(slug).all();
    const actual = await env.DB.prepare("SELECT cambio_id FROM publicadas WHERE org = ?").bind(slug).first();
    salida.ficha = { slug, nombre: O[slug].nombre, url: `/PCC/${slug}/`, oculta: O[slug].oculta };
    salida.actual = actual ? actual.cambio_id : null;
    salida.versiones = v.results.map((c) => ({
      id: c.id,
      publicado: c.revisado || c.creado,
      autor: nombreDe(c),
      revisor: c.r_usuario ? nombreDe({ usuario: c.r_usuario, nombre: c.r_nombre }) : null,
      nota: c.comentario,
    }));
  }
  return json(salida);
}

async function restaurar(env, yo, id) {
  const c = await env.DB.prepare("SELECT org, datos FROM cambios WHERE id = ? AND estado = 'aprobado'").bind(id).first();
  if (!c) return error("Esa versión no existe", 404);
  const t = ahora();
  const r = await env.DB.prepare(
    "INSERT INTO cambios (org, usuario_id, datos, estado, comentario, creado, revisado, revisor_id) VALUES (?, ?, ?, 'aprobado', ?, ?, ?, ?) RETURNING id",
  ).bind(c.org, yo.id, c.datos, `Restaurada desde la versión #${id}`, t, t, yo.id).first();
  await env.DB.batch([
    publicar(env, c.org, c.datos, r.id),
    anotar(env, yo, c.org, "restauro", `Volvió a la versión #${id}`),
  ]);
  return json({ ok: true });
}
