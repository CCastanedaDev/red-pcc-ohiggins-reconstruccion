import {
  FICHAS, SESION_DIAS, ahora, aleatorio, baseDeFicha, claveTemporal, cookieSesion, error, fichaVigente,
  hashClave, igualSeguro, json, sha256, usuarioActual, validarFicha,
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

    if (ruta === "yo") return json({ usuario: publico(yo), organizacion: yo.org ? FICHAS[yo.org]?.nombre : null });
    if (ruta === "clave" && metodo === "POST") return await cambiarClave(request, env, yo);
    if (yo.debe_cambiar) return error("Primero tienes que cambiar tu contraseña", 403);

    if (ruta === "ficha" && metodo === "GET") return await verFicha(request, env, yo);
    if (ruta === "ficha" && metodo === "POST") return await guardarFicha(request, env, yo);
    if (ruta === "fotos" && metodo === "POST") return await subirFoto(request, env, yo);

    if (yo.rol !== "admin") return error("No tienes permiso para esto", 403);
    if (ruta === "organizaciones") return json(Object.values(FICHAS).map((f) => ({ slug: f.slug, nombre: f.nombre })));
    if (ruta === "cambios" && metodo === "GET") return await listarCambios(env);
    let m;
    if ((m = ruta.match(/^cambios\/(\d+)\/(aprobar|rechazar)$/)) && metodo === "POST")
      return await revisar(request, env, yo, Number(m[1]), m[2]);
    if (ruta === "usuarios" && metodo === "GET") return await listarUsuarios(env);
    if (ruta === "usuarios" && metodo === "POST") return await crearUsuario(request, env);
    if ((m = ruta.match(/^usuarios\/(\d+)\/(clave|activo)$/)) && metodo === "POST")
      return await editarUsuario(request, env, yo, Number(m[1]), m[2]);

    return error("No encontrado", 404);
  } catch (e) {
    console.error(e);
    return error("Algo falló en el servidor. Intenta de nuevo.", 500);
  }
}

const publico = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, org: u.org, debe_cambiar: !!u.debe_cambiar });

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
  const f = FICHAS[slug];
  if (!f) return error("Ficha no encontrada", 404);
  const pendiente = await env.DB.prepare("SELECT id, datos, creado FROM cambios WHERE org = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1").bind(slug).first();
  const ultimo = await env.DB.prepare("SELECT estado, comentario, revisado FROM cambios WHERE org = ? AND estado IN ('aprobado','rechazado') ORDER BY id DESC LIMIT 1").bind(slug).first();
  return json({
    ficha: { slug, nombre: f.nombre, comuna: f.comuna, url: `/PCC/${slug}/` },
    vigente: await fichaVigente(env, slug),
    pendiente: pendiente ? { id: pendiente.id, datos: JSON.parse(pendiente.datos), creado: pendiente.creado } : null,
    ultimo,
  });
}

async function guardarFicha(request, env, yo) {
  const slug = orgPedida(request, yo);
  if (!FICHAS[slug]) return error("Ficha no encontrada", 404);
  const { datos } = await leerJson(request);
  const v = await validarFicha(env, slug, datos);
  if (v.error) return error(v.error);
  const t = ahora();
  const texto = JSON.stringify(v.datos);

  if (yo.rol === "admin") {
    // La red publica directo
    const r = await env.DB.prepare("INSERT INTO cambios (org, usuario_id, datos, estado, creado, revisado, revisor_id) VALUES (?, ?, ?, 'aprobado', ?, ?, ?) RETURNING id")
      .bind(slug, yo.id, texto, t, t, yo.id).first();
    await env.DB.batch([
      env.DB.prepare("UPDATE cambios SET estado = 'reemplazado' WHERE org = ? AND estado = 'pendiente'").bind(slug),
      publicar(env, slug, texto, r.id),
    ]);
    return json({ ok: true, publicado: true });
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE cambios SET estado = 'reemplazado' WHERE org = ? AND estado = 'pendiente'").bind(slug),
    env.DB.prepare("INSERT INTO cambios (org, usuario_id, datos, creado) VALUES (?, ?, ?, ?)").bind(slug, yo.id, texto, t),
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
  if (!FICHAS[slug]) return error("Ficha no encontrada", 404);
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
  const salida = [];
  for (const c of results) {
    salida.push({
      id: c.id,
      org: c.org,
      nombre: FICHAS[c.org]?.nombre || c.org,
      autor: c.nombre || c.usuario,
      creado: c.creado,
      propuesto: JSON.parse(c.datos),
      vigente: await fichaVigente(env, c.org),
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
  await env.DB.batch(pasos);
  return json({ ok: true, estado });
}

/* ---------- Usuarios (red) ---------- */

async function listarUsuarios(env) {
  const { results } = await env.DB.prepare("SELECT id, usuario, nombre, rol, org, activo, debe_cambiar, creado FROM usuarios ORDER BY rol, usuario").all();
  return json(results.map((u) => ({ ...u, organizacion: u.org ? FICHAS[u.org]?.nombre : null })));
}

async function crearUsuario(request, env) {
  const d = await leerJson(request);
  const usuario = String(d.usuario || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return error("El usuario solo puede tener letras sin tilde, números, punto o guion (3 a 40)");
  const rol = d.rol === "admin" ? "admin" : "org";
  const org = rol === "org" ? String(d.org || "") : null;
  if (rol === "org" && !FICHAS[org]) return error("Elige la organización");
  const existe = await env.DB.prepare("SELECT 1 FROM usuarios WHERE usuario = ?").bind(usuario).first();
  if (existe) return error("Ese usuario ya existe");
  const clave = claveTemporal();
  const h = await hashClave(clave);
  await env.DB.prepare("INSERT INTO usuarios (usuario, nombre, rol, org, hash, sal, creado) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(usuario, String(d.nombre || "").trim().slice(0, 80), rol, org, h.hash, h.sal, ahora())
    .run();
  return json({ ok: true, usuario, clave });
}

async function editarUsuario(request, env, yo, id, accion) {
  const u = await env.DB.prepare("SELECT id FROM usuarios WHERE id = ?").bind(id).first();
  if (!u) return error("Usuario no encontrado", 404);
  if (accion === "clave") {
    const clave = claveTemporal();
    const h = await hashClave(clave);
    await env.DB.batch([
      env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ?, debe_cambiar = 1 WHERE id = ?").bind(h.hash, h.sal, id),
      env.DB.prepare("DELETE FROM sesiones WHERE usuario_id = ?").bind(id),
    ]);
    return json({ ok: true, clave });
  }
  if (id === yo.id) return error("No puedes desactivarte a ti misma/o");
  const { activo } = await leerJson(request);
  const pasos = [env.DB.prepare("UPDATE usuarios SET activo = ? WHERE id = ?").bind(activo ? 1 : 0, id)];
  if (!activo) pasos.push(env.DB.prepare("DELETE FROM sesiones WHERE usuario_id = ?").bind(id));
  await env.DB.batch(pasos);
  return json({ ok: true });
}
