// Crea un usuario del panel directamente en la base D1 (sirve para el primer usuario de la red).
//
//   node herramientas/crear-usuario.mjs <usuario> admin [--remote] [--guardar archivo.txt]
//   node herramientas/crear-usuario.mjs <usuario> org <slug-de-la-ficha> [--remote] [--guardar archivo.txt]
//
// Genera una contraseña temporal; la persona la cambia la primera vez que entra.
// Sin --remote trabaja sobre la base local de pruebas (wrangler pages dev).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

const args = process.argv.slice(2);
const remoto = args.includes("--remote");
const iGuardar = args.indexOf("--guardar");
const guardar = iGuardar >= 0 ? args[iGuardar + 1] : null;
const [usuario, rol, org] = args.filter((a, i) => !a.startsWith("--") && i !== iGuardar + 1);

if (!usuario || !["admin", "org"].includes(rol) || (rol === "org" && !org)) {
  console.error("Uso: node herramientas/crear-usuario.mjs <usuario> admin|org [slug] [--remote] [--guardar archivo]");
  process.exit(1);
}

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sal = crypto.getRandomValues(new Uint8Array(16));
const n = crypto.getRandomValues(new Uint32Array(4));
const P = ["maqui", "boldo", "quillay", "peumo", "litre", "copihue", "canelo", "loica", "chincol", "zorzal", "charango", "cueca", "telar", "greda", "cerro", "estero"];
const clave = `${P[n[0] % P.length]}-${P[n[1] % P.length]}-${P[n[2] % P.length]}-${10 + (n[3] % 90)}`;

const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: 100000 }, llave, 256);

const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sql = `INSERT INTO usuarios (usuario, nombre, rol, org, hash, sal, creado) VALUES (${q(usuario.toLowerCase())}, '', ${q(rol)}, ${q(rol === "org" ? org : null)}, ${q(hex(bits))}, ${q(hex(sal))}, ${Math.floor(Date.now() / 1000)});`;
const dir = mkdtempSync(join(tmpdir(), "pcc-"));
const archivo = join(dir, "usuario.sql");
writeFileSync(archivo, sql);

execFileSync("npx", ["wrangler", "d1", "execute", "red-pcc-panel", remoto ? "--remote" : "--local", "--file", archivo, "-y"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (guardar) {
  appendFileSync(guardar, `${remoto ? "PRODUCCIÓN" : "LOCAL"} · usuario: ${usuario.toLowerCase()} · contraseña temporal: ${clave}\n`);
  console.log(`\nUsuario creado. La contraseña temporal quedó en ${guardar}`);
} else {
  console.log(`\nUsuario creado: ${usuario.toLowerCase()}\nContraseña temporal: ${clave}\n(se cambia la primera vez que entre)`);
}
