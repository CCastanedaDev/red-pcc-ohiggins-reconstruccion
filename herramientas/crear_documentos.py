"""Pestaña «Documentos»: publicaciones de la Red y presentaciones de los Puntos de Cultura para descargar.

Fuentes (Drive de la Red, copia local en ../drive-material, que no se publica):
- insumos-pcc/gobernanza-primera-edicion.pdf  (ya publicado como documentos/gobernanza-territorial-primera-edicion.pdf)
- insumos-pcc/gobernanza-ultima-edicion.pdf   -> segunda edición, noviembre de 2025 (22,6 MB, se aliviana con Ghostscript /ebook)
- insumos-pcc/guia-genero.pdf                 -> guía metodológica cocreada, agosto de 2025 (se aliviana)
- generales/presentacion-td.pdf               -> presentación de Territorio Digital, IberCultura Viva 2024 (se aliviana)
- revision-fotos/documentos/1oRVqejvt78pQrnDKfSwxMb0g9eyY-o4O.pdf -> presentación de Centro Cultural La Puerta (tal cual)

Revisados y NO publicados: REX 397 (nombres de representantes, postulaciones no validadas y correos),
resolución 412, base y catastro (datos personales), dossiers de artistas de AMP (teléfonos y correos personales),
borradores en Word y PowerPoint.

Los originales quedan en drive-material sin tocar. Uso: python herramientas/crear_documentos.py (desde vista-local).
"""
import html
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

SITIO = Path(__file__).resolve().parent.parent
DRIVE = SITIO.parent / "drive-material"
DESTINO = SITIO / "documentos"
PORTADAS = DESTINO / "portadas"
GS = shutil.which("gswin64c") or shutil.which("gs")

DOCUMENTOS = [
    {
        "grupo": "red",
        "archivo": "gobernanza-territorial-segunda-edicion.pdf",
        "fuente": "insumos-pcc/gobernanza-ultima-edicion.pdf",
        "alivianar": True,
        "tipo": "Publicación",
        "titulo": "Gobernanza Territorial de Base Comunitaria",
        "subtitulo": "Segunda edición · noviembre de 2025",
        "texto": "La publicación de la Red de Puntos de Cultura Comunitaria de O’Higgins sobre su modelo de gobernanza. "
        "Coordinación, redacción y edición del Centro de Estudios e Investigación La Grieta, en coautoría con la Red. "
        "Financiada por la Seremi de las Culturas, las Artes y el Patrimonio de O’Higgins.",
        "destacado": True,
    },
    {
        "grupo": "red",
        "archivo": "guia-metodologica-genero-inclusion-interculturalidad.pdf",
        "fuente": "insumos-pcc/guia-genero.pdf",
        "alivianar": True,
        "tipo": "Guía",
        "titulo": "Enfoque de género, inclusión, no adultocentrismo e interculturalidad",
        "subtitulo": "Guía metodológica cocreada · agosto de 2025",
        "texto": "Guía hecha junto a los Puntos de Cultura Comunitaria de la región, con el Ministerio de las Culturas, "
        "las Artes y el Patrimonio y la Universidad de O’Higgins.",
    },
    {
        "grupo": "red",
        "archivo": "gobernanza-territorial-primera-edicion.pdf",
        "fuente": "insumos-pcc/gobernanza-primera-edicion.pdf",
        "alivianar": False,
        "tipo": "Publicación",
        "titulo": "Gobernanza Territorial de Base Comunitaria",
        "subtitulo": "Primera edición · enero de 2025",
        "texto": "La primera versión de la publicación, financiada por el Plan de Articulación 2024 del programa Puntos de Cultura Comunitaria.",
    },
    {
        "grupo": "red",
        "archivo": "territorio-digital-ibercultura-viva-2024.pdf",
        "fuente": "generales/presentacion-td.pdf",
        "alivianar": True,
        "tipo": "Presentación",
        "titulo": "Territorio Digital",
        "subtitulo": "Convocatoria IberCultura Viva 2024",
        "texto": "Presentación del proyecto que dio origen a esta plataforma de la Red.",
    },
    {
        "grupo": "pcc",
        "archivo": "centro-cultural-la-puerta.pdf",
        "fuente": "revision-fotos/documentos/1oRVqejvt78pQrnDKfSwxMb0g9eyY-o4O.pdf",
        "alivianar": False,
        "tipo": "Presentación",
        "titulo": "Centro Cultural La Puerta",
        "subtitulo": "Presentación del Punto de Cultura",
        "texto": "Sus líneas de trabajo y las actividades que ha realizado en su comuna.",
        "ficha": "centro-cultural-la-puerta",
    },
]

GRUPOS = [
    ("red", "Publicaciones de la Red", "Lo que la Red ha creado y publicado en conjunto."),
    ("pcc", "Presentaciones de los Puntos de Cultura", "Documentos que las organizaciones compartieron para dar a conocer su trabajo."),
]

ICONO_DESCARGA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>'


def correr_gs(*args):
    env = dict(os.environ, MSYS2_ARG_CONV_EXCL="*")
    subprocess.run([GS, "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", *args], check=True, env=env)


def preparar(d):
    origen = DRIVE / d["fuente"]
    destino = DESTINO / d["archivo"]
    if not destino.exists():
        if d["alivianar"]:
            correr_gs("-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6", "-dPDFSETTINGS=/ebook",
                      "-dDetectDuplicateImages=true", f"-sOutputFile={destino}", str(origen))
            if destino.stat().st_size >= origen.stat().st_size:
                shutil.copyfile(origen, destino)
        else:
            shutil.copyfile(origen, destino)
    portada = PORTADAS / (destino.stem + ".webp")
    if not portada.exists():
        tmp = PORTADAS / (destino.stem + ".png")
        correr_gs("-sDEVICE=png16m", "-r110", "-dFirstPage=1", "-dLastPage=1", "-dTextAlphaBits=4",
                  "-dGraphicsAlphaBits=4", f"-sOutputFile={tmp}", str(destino))
        with Image.open(tmp) as im:
            im = im.convert("RGB")
            im.thumbnail((640, 640))
            im.save(portada, "WEBP", quality=82, method=6)
        tmp.unlink()
    with Image.open(portada) as im:
        d["ancho"], d["alto"] = im.size
    d["paginas"] = len(PdfReader(destino).pages)
    d["peso"] = destino.stat().st_size


def mb(n):
    return f"{n / 1_000_000:.1f}".replace(".", ",") + " MB"


def tarjeta(d):
    e = html.escape
    clase = "doc" + (" doc-destacado" if d.get("destacado") else "") + (" doc-horizontal" if d["ancho"] > d["alto"] else "")
    ficha = (f' <a class="doc-ficha" href="../PCC/{d["ficha"]}/index.html">Ver ficha de la organización</a>'
             if d.get("ficha") else "")
    return f"""<article class="{clase}">
<a class="doc-portada" href="{d['archivo']}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="portadas/{Path(d['archivo']).stem}.webp" alt="" width="{d['ancho']}" height="{d['alto']}" loading="lazy"></a>
<div class="doc-info">
<p class="doc-tipo">{e(d['tipo'])}</p>
<h3>{e(d['titulo'])}</h3>
<p class="doc-sub">{e(d['subtitulo'])}</p>
<p class="doc-texto">{e(d['texto'])}</p>
<p class="doc-meta">PDF · {d['paginas']} páginas · {mb(d['peso'])}</p>
<div class="doc-acciones"><a class="doc-boton" href="{d['archivo']}" download>{ICONO_DESCARGA}Descargar</a><a class="doc-ver" href="{d['archivo']}" target="_blank" rel="noopener">Ver en línea</a>{ficha}</div>
</div>
</article>"""


def pagina():
    plantilla = (SITIO / "somos" / "index.html").read_text(encoding="utf-8")
    cabeza, resto = plantilla.split('<main class="interior container">', 1)
    pie = resto.split("</main>", 1)[1]
    desc = "Publicaciones de la Red de Puntos de Cultura Comunitaria de O’Higgins y presentaciones de sus organizaciones, para descargar en PDF."
    cabeza = cabeza.replace("<title>Somos | Red PCC O’Higgins</title>", "<title>Documentos | Red PCC O’Higgins</title>")
    cabeza = cabeza.replace("Somos | Red PCC O’Higgins", "Documentos | Red PCC O’Higgins")
    cabeza = re.sub(r'content="El programa Puntos deCultura[^"]*"', f'content="{desc}"', cabeza)
    cabeza = re.sub(r'content="([^"]*)/somos/" data-meta-red="" property="og:url"',
                    r'content="\1/documentos/" data-meta-red="" property="og:url"', cabeza)
    cabeza = cabeza.replace('<a href="../documentos/index.html">Documentos</a>',
                            '<a aria-current="page" href="index.html">Documentos</a>')
    cabeza = cabeza.replace("reconstruccion.css?v=20261117", "reconstruccion.css?v=20261127")
    secciones = []
    for clave, titulo, bajada in GRUPOS:
        docs = [d for d in DOCUMENTOS if d["grupo"] == clave]
        if docs:
            secciones.append(f'<section class="docs-grupo"><h2>{titulo}</h2><p>{bajada}</p><div class="docs-lista">'
                             + "\n".join(tarjeta(d) for d in docs) + "</div></section>")
    cuerpo = ('<main class="interior container documentos"><h1>Documentos</h1>'
              '<p class="docs-intro">Publicaciones de la Red de Puntos de Cultura Comunitaria de O’Higgins y presentaciones '
              'de sus organizaciones. Puedes verlas en línea o descargarlas en PDF.</p>' + "".join(secciones) + "</main>")
    (DESTINO / "index.html").write_text(cabeza + cuerpo + pie, encoding="utf-8")
    return desc


def menu():
    """Agrega «Documentos» al menú principal de todas las páginas públicas."""
    n = 0
    for p in SITIO.rglob("*.html"):
        if any(x in p.parts for x in ("panel", "wp-content", "wp-includes", "node_modules", ".wrangler")):
            continue
        s = p.read_text(encoding="utf-8")
        if 'aria-label="Menú principal"' not in s or ">Documentos</a>" in s:
            continue
        # El prefijo sale del enlace a «Somos», que en todas las páginas apunta a la raíz del sitio
        nuevo = re.sub(r'(<nav aria-label="Menú principal"><a href="([./]*)somos/index\.html">Somos</a>.*?)(</nav>)',
                       lambda m: f'{m.group(1)}<a href="{m.group(2)}documentos/index.html">Documentos</a>{m.group(3)}', s, count=1)
        if nuevo != s:
            p.write_text(nuevo, encoding="utf-8")
            n += 1
    return n


def buscador(desc):
    ruta = SITIO / "busqueda-datos.js"
    s = ruta.read_text(encoding="utf-8")
    prefijo = "window.PCC_SEARCH_INDEX = "
    indice = json.loads(s[len(prefijo):].strip().rstrip(";"))
    indice = [x for x in indice if x.get("url") != "documentos/index.html"]
    texto = " ".join(f"{d['titulo']} {d['subtitulo']} {d['texto']}" for d in DOCUMENTOS)
    indice.append({"title": "Documentos", "url": "documentos/index.html", "text": f"{desc} {texto}", "excerpt": desc[:180]})
    ruta.write_text(prefijo + json.dumps(indice, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    PORTADAS.mkdir(parents=True, exist_ok=True)
    for d in DOCUMENTOS:
        preparar(d)
        print(f"{d['archivo']}: {d['paginas']} págs., {mb(d['peso'])}")
    desc = pagina()
    print("Menú actualizado en", menu(), "páginas")
    buscador(desc)
