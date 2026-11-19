/* Utilidades compartidas del panel de la Red PCC */
const Panel = (() => {
  async function api(ruta, { metodo = "GET", datos, cuerpo, cabeceras = {} } = {}) {
    const op = { method: metodo, credentials: "same-origin", headers: { ...cabeceras } };
    if (datos !== undefined) {
      op.headers["content-type"] = "application/json";
      op.body = JSON.stringify(datos);
    } else if (cuerpo !== undefined) {
      op.body = cuerpo;
    }
    let r;
    try {
      r = await fetch("/api/" + ruta, op);
    } catch {
      throw new Error("No hay conexión. Revisa tu internet e intenta de nuevo.");
    }
    const j = await r.json().catch(() => ({}));
    const enEntrada = location.pathname === "/panel/" || location.pathname === "/panel/index.html";
    if (r.status === 401 && ruta !== "entrar" && ruta !== "clave" && !enEntrada) {
      location.href = "/panel/";
      throw new Error("Sesión cerrada");
    }
    if (!r.ok) throw new Error(j.error || "Algo falló. Intenta de nuevo.");
    return j;
  }

  /** Comprueba la sesión y arma la barra superior. */
  async function iniciar({ soloAdmin = false, actual = "" } = {}) {
    let yo;
    try {
      yo = (await api("yo")).usuario;
    } catch {
      return null;
    }
    if (yo.debe_cambiar && !location.pathname.endsWith("/clave.html")) {
      location.href = "/panel/clave.html";
      return null;
    }
    if (soloAdmin && yo.rol !== "admin") {
      location.href = "/panel/ficha.html";
      return null;
    }
    const links =
      yo.rol === "admin"
        ? [["revision.html", "Revisar cambios"], ["organizaciones.html", "Fichas"], ["usuarios.html", "Usuarios"]]
        : [["ficha.html", "Mi ficha"]];
    const nav = document.querySelector(".barra nav");
    if (nav) {
      nav.innerHTML =
        links.map(([h, t]) => `<a href="/panel/${h}"${h === actual ? ' aria-current="page"' : ""}>${t}</a>`).join("") +
        `<a href="/panel/clave.html"${actual === "clave.html" ? ' aria-current="page"' : ""}>Contraseña</a><button type="button" id="salir">Salir</button>`;
      nav.querySelector("#salir").onclick = async () => {
        await api("salir", { metodo: "POST" }).catch(() => {});
        location.href = "/panel/";
      };
    }
    return yo;
  }

  function mensaje(el, texto, tipo = "info") {
    if (!texto) {
      el.className = "msg oculto";
      return;
    }
    el.className = "msg " + tipo;
    el.textContent = texto;
  }

  function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function fecha(seg) {
    return new Date(seg * 1000).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
  }

  /** Achica la foto en el navegador antes de subirla (máx. 1920 px, ~1,4 MB). */
  async function prepararFoto(archivo) {
    let img;
    try {
      img = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    } catch {
      img = await new Promise((ok, mal) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => mal(new Error("No se pudo leer la foto " + archivo.name + ". Prueba con otra (JPG o PNG)."));
        i.src = URL.createObjectURL(archivo);
      });
    }
    let lado = 1920;
    for (let intento = 0; intento < 5; intento++) {
      const escala = Math.min(1, lado / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let blob = await new Promise((ok) => c.toBlob(ok, "image/webp", 0.82));
      if (!blob || blob.type !== "image/webp") blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
      if (blob && blob.size <= 1_400_000) return { blob, w, h };
      lado = Math.round(lado * 0.8);
    }
    throw new Error("La foto " + archivo.name + " es demasiado grande.");
  }

  async function subirFoto(archivo, org) {
    const { blob, w, h } = await prepararFoto(archivo);
    const q = org ? "?org=" + encodeURIComponent(org) : "";
    const r = await api("fotos" + q, { metodo: "POST", cuerpo: blob, cabeceras: { "content-type": blob.type, "x-ancho": w, "x-alto": h } });
    return r.src;
  }

  return { api, iniciar, mensaje, esc, fecha, subirFoto };
})();
