"""Extrae los datos de cada ficha de organización (PCC/<slug>/index.html) a functions/_lib/fichas.json.

Ese archivo es la "versión base" que el panel muestra a cada agrupación antes de su primer cambio.
Se vuelve a ejecutar cada vez que se editen a mano las fichas estáticas.
"""
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup

SITIO = Path(__file__).resolve().parent.parent
SALIDA = SITIO / "functions" / "_lib" / "fichas.json"

REDES = [
    ("instagram", "instagram.com"),
    ("facebook", "facebook.com"),
    ("youtube", "youtube.com"),
    ("youtube", "youtu.be"),
    ("tiktok", "tiktok.com"),
    ("spotify", "spotify.com"),
]


def limpio(t):
    return re.sub(r"\s+", " ", t).strip()


def ruta_absoluta(src):
    if src.startswith(("http://", "https://")):
        return src
    return "/" + re.sub(r"^(\.\./)+", "", src).lstrip("/")


def secciones_de_listas(main):
    """Encabezados h2 de Proyectos/Noticias con sus enlaces internos."""
    proyectos, noticias, ocupados = [], [], set()
    for h2 in main.find_all("h2"):
        t = limpio(h2.get_text(" "))
        if not re.search(r"proyectos|noticias", t, re.I):
            continue
        grupo = h2.find_parent("div", class_="alignfull")
        ul = grupo.find("ul") if grupo else h2.find_next_sibling("ul")
        if grupo:
            ocupados.add(id(grupo))
        if not ul:
            continue
        ocupados.add(id(ul))
        destino = noticias if re.fullmatch(r"noticias", t, re.I) else proyectos
        for a in ul.find_all("a", href=True):
            if a["href"].startswith("http"):
                continue
            item = {"titulo": limpio(a.get_text(" ")), "url": ruta_absoluta(a["href"]).replace("/index.html", "/")}
            if item not in destino:
                destino.append(item)
    return proyectos, noticias, ocupados


def extraer(ruta):
    s = BeautifulSoup(ruta.read_text(encoding="utf-8"), "html.parser")
    main = s.find("main")
    slug = ruta.parent.name
    nombre = limpio(main.find("h1").get_text(" "))

    logo_img = main.select_one("figure.organizacion-logo img")
    portada_img = main.select_one("figure.imagen-destacada img")
    galeria = []
    for img in main.find_all("img"):
        if img is logo_img or img is portada_img or not img.get("src"):
            continue
        fig = img.find_parent("figure")
        cap = fig.find("figcaption") if fig else None
        galeria.append({"src": ruta_absoluta(img["src"]), "texto": limpio(cap.get_text(" ")) if cap else limpio(img.get("alt", ""))})

    redes = {}
    for a in main.find_all("a", href=True):
        h = a["href"].strip()
        if not h.startswith("http"):
            continue
        host = urlparse(h).netloc.lower()
        clave = next((k for k, dom in REDES if dom in host), "web")
        redes.setdefault(clave, h)

    proyectos, noticias, ocupados = secciones_de_listas(main)

    # Plan de fortalecimiento (fichas creadas desde la presentación de convenios 2026)
    plan = None
    excluidos = set()
    for h2 in main.find_all("h2"):
        if "plan de fortalecimiento" in h2.get_text().lower():
            h3 = h2.find_next_sibling("h3")
            textos = []
            for sib in h2.find_next_siblings():
                if sib.name == "h2":
                    break
                if sib.name == "p":
                    textos.append(limpio(sib.get_text(" ")))
                    excluidos.add(id(sib))
            plan = {"titulo": limpio(h2.get_text(" ")), "subtitulo": limpio(h3.get_text(" ")) if h3 else "", "texto": "\n\n".join(textos)}

    comuna = ""
    for p in main.find_all("p"):
        t = limpio(p.get_text(" "))
        if t.startswith("Punto de Cultura Comunitaria") and "·" in t:
            comuna = t.split("·", 1)[1].strip()
            excluidos.add(id(p))
            break
    if not comuna:
        p = main.select_one("p.has-large-font-size")
        if p:
            comuna = limpio(p.get_text(" "))
            excluidos.add(id(p))

    resena = []
    for p in main.find_all("p"):
        if id(p) in excluidos or p.find("small") or p.find_parent(["li", "figure", "ul"]):
            continue
        if any(id(par) in ocupados for par in p.parents):
            continue
        if p.find_previous_sibling("h6") or p.find_parent("div", class_="is-vertical") and p.find_parent("div", class_="is-vertical").find("h6"):
            continue
        t = limpio(p.get_text(" "))
        if len(t) < 30 or t == nombre or t in resena:
            continue
        resena.append(t)

    return {
        "slug": slug,
        "nombre": nombre,
        "comuna": comuna,
        "resena": "\n\n".join(resena),
        "redes": redes,
        "logo": ruta_absoluta(logo_img["src"]) if logo_img else "",
        "portada": ruta_absoluta(portada_img["src"]) if portada_img else "",
        "galeria": galeria,
        "plan": plan,
        "proyectos": proyectos,
        "noticias": noticias,
    }


fichas = {}
for ruta in sorted((SITIO / "PCC").glob("*/index.html")):
    f = extraer(ruta)
    fichas[f["slug"]] = f
SALIDA.parent.mkdir(parents=True, exist_ok=True)
SALIDA.write_text(json.dumps(fichas, ensure_ascii=False, indent=1), encoding="utf-8")
for f in fichas.values():
    print(f"{f['slug'][:30]:30} | {f['comuna'][:22]:22} | reseña {len(f['resena']):4} | gal {len(f['galeria']):2} | redes {','.join(f['redes'])} | P{len(f['proyectos'])} N{len(f['noticias'])} | plan {'sí' if f['plan'] else '-'}")
print(len(fichas), "fichas ->", SALIDA)
