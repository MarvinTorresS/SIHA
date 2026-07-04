# extractors/malla_scraper.py
#
# Extractor de mallas curriculares desde botsrb.info
#
# FUENTE: /public/app_react/static/js/main.033a5029.js
#
# Bloques mesh en el bundle:
#   Bloque 1: TDC → itecad (Ciencia de Datos)
#   Bloque 2: EIF → isi    (Ingeniería en Sistemas Informáticos)
#   Bloque 3: TGF → topo   (Topografía)

import re
import time
import json
import logging
from pathlib import Path
from dataclasses import dataclass, field, asdict

import requests

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    MALLA_BASE_URL,
    CARRERAS_CAMPUS_COTO,
    DEFAULT_HEADERS,
    REQUEST_TIMEOUT_SECONDS,
    MAX_RETRY_ATTEMPTS,
    RETRY_BACKOFF_FACTOR,
    OUTPUT_RAW_DIR,
    OUTPUT_NORMALIZED_DIR,
    LOGS_DIR,
)

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOGS_DIR / "malla_scraper.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Constantes ────────────────────────────────────────────────────────────────

MESH_JS_PATH = "/public/app_react/static/js/main.033a5029.js"

CICLO_NOMBRES: dict[str, str] = {
    "0 0": "Áreas Disciplinares",
    "1 1": "Primer Año - I Ciclo",
    "1 2": "Primer Año - II Ciclo",
    "2 1": "Segundo Año - I Ciclo",
    "2 2": "Segundo Año - II Ciclo",
    "3 1": "Tercer Año - I Ciclo",
    "3 2": "Tercer Año - II Ciclo",
    "4 1": "Cuarto Año - I Ciclo",
    "4 2": "Cuarto Año - II Ciclo",
}

CICLOS_IGNORAR = {"0 0"}

# Código distintivo del primer curso en "1 1" para cada carrera
CODIGOS_CARRERA = {
    "itecad": ["TDC400"],
    "isi":    ["EIF200"],
    "topo":   ["TGF400"],
}

# ── Modelos ───────────────────────────────────────────────────────────────────

@dataclass
class CursoMalla:
    codigo: str
    nombre: str
    creditos: int
    ciclo_id: str
    ciclo_nombre: str
    carrera_sigla: str
    carrera_nombre: str
    prerequisitos: list[str] = field(default_factory=list)
    es_optativo: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    def __post_init__(self):
        self.codigo = self.codigo.strip().upper()
        self.nombre = self.nombre.strip()
        self.es_optativo = (
            self.codigo.startswith("OPT") or
            self.codigo.endswith("O")
        )


def guardar_json(datos: list, ruta: Path) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(
            [d.to_dict() if hasattr(d, "to_dict") else d for d in datos],
            f, ensure_ascii=False, indent=2
        )
    log.info(f"  ✓ Guardado: {ruta} ({len(datos)} registros)")


# ── HTTP ──────────────────────────────────────────────────────────────────────

def _get_con_reintentos(url: str) -> requests.Response:
    for intento in range(1, MAX_RETRY_ATTEMPTS + 1):
        try:
            response = requests.get(
                url, headers=DEFAULT_HEADERS,
                timeout=REQUEST_TIMEOUT_SECONDS
            )
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            if intento == MAX_RETRY_ATTEMPTS:
                raise
            espera = RETRY_BACKOFF_FACTOR ** intento
            log.warning(f"  ⚠ Reintento {intento} en {espera}s... ({e})")
            time.sleep(espera)


# ── Parser JS → JSON ──────────────────────────────────────────────────────────

def _decodificar_unicode(texto: str) -> str:
    """\\xNN → carácter real."""
    def reemplazar(m):
        try:
            return chr(int(m.group(1), 16))
        except (ValueError, OverflowError):
            return m.group(0)
    return re.sub(r'\\x([0-9a-fA-F]{2})', reemplazar, texto)


def _js_a_json(texto_js: str) -> str:
    """Objeto JS → JSON válido."""
    texto = _decodificar_unicode(texto_js)
    # Agregar comillas a claves:  EIF200: → "EIF200":
    texto = re.sub(
        r'([{,])\s*([A-Za-z_#][A-Za-z0-9_#]*)\s*:',
        r'\1"\2":',
        texto
    )
    return texto


def _parsear_bloque(bloque_js: str) -> dict:
    try:
        return json.loads(_js_a_json(bloque_js))
    except json.JSONDecodeError as e:
        texto_json = _js_a_json(bloque_js)
        log.error(f"  ✗ Error parseando: {e}")
        inicio = max(0, e.pos - 80)
        fin = min(len(texto_json), e.pos + 80)
        log.error(f"    Contexto: {repr(texto_json[inicio:fin])}")
        
        debug_path = OUTPUT_RAW_DIR / "parseo_fallido.json"
        with open(debug_path, "w", encoding="utf-8") as f:
            f.write(texto_json)
        log.error(f"    Guardado en: {debug_path}")
        return {}


# ── Extracción de bloques ─────────────────────────────────────────────────────

def _extraer_bloques_mesh(js_content: str) -> list[str]:
    """Extrae todos los bloques mesh:{...} del bundle."""
    bloques = []
    
    for m in re.finditer(r'mesh:\s*\{', js_content):
        inicio = m.end() - 1
        
        profundidad = 0
        i = inicio
        en_string = False
        string_char = None
        
        while i < len(js_content):
            char = js_content[i]
            
            if en_string:
                if char == '\\':
                    i += 2
                    continue
                if char == string_char:
                    en_string = False
                i += 1
                continue
            
            if char in '"\'':
                en_string = True
                string_char = char
                i += 1
                continue
            
            if char == '{':
                profundidad += 1
            elif char == '}':
                profundidad -= 1
                if profundidad == 0:
                    bloques.append(js_content[inicio:i+1])
                    break
            i += 1
    
    return bloques


def _identificar_bloque(bloques: list[str], sigla: str) -> str | None:
    """Identifica el bloque mesh de una carrera por su código distintivo."""
    codigos = CODIGOS_CARRERA.get(sigla, [])
    
    for i, bloque in enumerate(bloques):
        for codigo in codigos:
            if codigo in bloque:
                log.info(f"  ✓ Bloque #{i+1} → {sigla}")
                return bloque
    
    log.error(f"  ✗ No se encontró bloque para '{sigla}'")
    return None


# ── Extracción principal ──────────────────────────────────────────────────────

def extraer_malla_carrera(sigla: str, nombre: str, js_content: str) -> list[CursoMalla]:
    log.info(f"▶ {nombre} [{sigla}]")
    
    bloques = _extraer_bloques_mesh(js_content)
    if not bloques:
        log.error("  ✗ No se encontraron bloques mesh")
        return []
    
    bloque_js = _identificar_bloque(bloques, sigla)
    if not bloque_js:
        return []
    
    datos = _parsear_bloque(bloque_js)
    if not datos:
        return []
    
    cursos: list[CursoMalla] = []
    
    for ciclo_id, cursos_ciclo in datos.items():
        if ciclo_id in CICLOS_IGNORAR:
            continue
        
        ciclo_nombre = CICLO_NOMBRES.get(ciclo_id, f"Ciclo {ciclo_id}")
        
        if not isinstance(cursos_ciclo, dict):
            continue
        
        for codigo, datos_curso in cursos_ciclo.items():
            if codigo.startswith('#'):
                continue
            
            if not isinstance(datos_curso, list) or len(datos_curso) < 3:
                continue
            
            nombre_curso = str(datos_curso[0]).strip()
            prereqs_raw = datos_curso[1] if isinstance(datos_curso[1], list) else []
            prereqs = [str(p).strip().upper() for p in prereqs_raw if p]
            
            try:
                creditos = int(datos_curso[2])
            except (ValueError, TypeError):
                creditos = 0
            
            cursos.append(CursoMalla(
                codigo=codigo,
                nombre=nombre_curso,
                creditos=creditos,
                ciclo_id=ciclo_id,
                ciclo_nombre=ciclo_nombre,
                carrera_sigla=sigla,
                carrera_nombre=nombre,
                prerequisitos=prereqs,
            ))
        
        n_cursos = sum(1 for c in cursos_ciclo if not c.startswith('#'))
        log.info(f"  {ciclo_nombre}: {n_cursos} cursos")
    
    log.info(f"  ✓ Total: {len(cursos)} cursos")
    return cursos


def extraer_todas_carreras(carreras: dict[str, str] | None = None) -> dict[str, list[CursoMalla]]:
    if carreras is None:
        carreras = CARRERAS_CAMPUS_COTO
    
    url = MALLA_BASE_URL + MESH_JS_PATH
    log.info(f"Descargando bundle: {url}")
    
    try:
        response = _get_con_reintentos(url)
    except requests.RequestException as e:
        log.error(f"✗ Error: {e}")
        return {}
    
    js_content = response.text
    log.info(f"  Descargado: {len(js_content):,} chars\n")
    
    resultados: dict[str, list[CursoMalla]] = {}
    for sigla, nombre in carreras.items():
        resultados[sigla] = extraer_malla_carrera(sigla, nombre, js_content)
        log.info("")
    
    return resultados


# ── Pipeline ──────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("ETL Sprint 1 — Extracción de Mallas")
    log.info("=" * 60)
    log.info("")
    
    resultados = extraer_todas_carreras()
    todos: list[CursoMalla] = []
    
    for sigla, cursos in resultados.items():
        if not cursos:
            log.warning(f"⚠ '{sigla}' sin cursos\n")
            continue
        guardar_json(cursos, OUTPUT_RAW_DIR / f"malla_{sigla}.json")
        todos.extend(cursos)
    
    if todos:
        guardar_json(todos, OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json")
        
        carreras_ok = set(c.carrera_sigla for c in todos)
        con_prereq = sum(1 for c in todos if c.prerequisitos)
        sin_cred = sum(1 for c in todos if c.creditos == 0)
        optativos = sum(1 for c in todos if c.es_optativo)
        
        log.info(f"{'='*60}")
        log.info(f"✓ COMPLETADO")
        log.info(f"  Carreras:  {len(carreras_ok)}/3")
        log.info(f"  Cursos:    {len(todos)}")
        log.info(f"  Con prerequisitos: {con_prereq}")
        log.info(f"  Sin créditos:      {sin_cred}")
        log.info(f"  Optativos:         {optativos}")
        log.info(f"{'='*60}")
    else:
        log.error("✗ No se extrajo ningún curso")
    
    return todos


if __name__ == "__main__":
    run()