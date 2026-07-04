# diagnostics/diagnostico_bundle.py
"""
Diagnóstico detallado del bundle JS de botsrb.info

Uso:
    python -m diagnostics.diagnostico_bundle

Analiza el archivo main.033a5029.js para:
- Encontrar todos los bloques mesh
- Identificar códigos de curso por carrera
- Mostrar estructura de ciclos
- Ayudar a mapear códigos distintivos por carrera
"""

import re
import sys
import json
import logging
from pathlib import Path
from collections import defaultdict

import requests

# Añadir el directorio raíz al path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    MALLA_BASE_URL,
    CARRERAS_CAMPUS_COTO,
    DEFAULT_HEADERS,
    REQUEST_TIMEOUT_SECONDS,
    MAX_RETRY_ATTEMPTS,
    RETRY_BACKOFF_FACTOR,
    OUTPUT_RAW_DIR,
    LOGS_DIR,
)

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOGS_DIR / "diagnostico_bundle.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Constantes ────────────────────────────────────────────────────────────────

MESH_JS_PATH = "/public/app_react/static/js/main.033a5029.js"

# Códigos que YA conocemos (para referencia)
CODIGOS_CONOCIDOS = {
    "isi":     ["EIF200", "EIF201", "EIF202", "EIF203", "EIF204", "EIF205", "EIF206", "EIF207", "EIF208", "EIF209", "EIF210", "EIF211", "EIF212"],
    "icco":    ["ICC"],
    "ictp":    ["TCP"],
    "topo":    ["TGF400", "TGF401"],
    "iciagro": ["AGR"],
    "itecad":  ["CAD400", "TEC"],
}

# ── Utilidades ────────────────────────────────────────────────────────────────

def _descargar_bundle() -> str:
    """Descarga el bundle JS."""
    url = MALLA_BASE_URL + MESH_JS_PATH
    log.info(f"Descargando: {url}")
    
    for intento in range(1, MAX_RETRY_ATTEMPTS + 1):
        try:
            response = requests.get(
                url, 
                headers=DEFAULT_HEADERS,
                timeout=REQUEST_TIMEOUT_SECONDS
            )
            response.raise_for_status()
            log.info(f"  Bundle: {len(response.text):,} chars\n")
            return response.text
        except requests.RequestException as e:
            if intento == MAX_RETRY_ATTEMPTS:
                log.error(f"✗ Error: {e}")
                raise
            import time
            time.sleep(RETRY_BACKOFF_FACTOR ** intento)


def _decodificar_unicode(texto: str) -> str:
    """Convierte escapes \\xNN a caracteres Unicode."""
    def reemplazar(m):
        try:
            return chr(int(m.group(1), 16))
        except (ValueError, OverflowError):
            return m.group(0)
    return re.sub(r'\\x([0-9a-fA-F]{2})', reemplazar, texto)


def _extraer_bloques_mesh(js_content: str) -> list[dict]:
    """
    Extrae todos los bloques mesh:{...} del bundle.
    Retorna lista con info de cada bloque.
    """
    bloques = []
    
    # Buscar mesh:{
    patron_mesh = re.compile(r'mesh:\s*(\{)')
    
    for m in patron_mesh.finditer(js_content):
        inicio = m.start(1)
        
        # Contar llaves para encontrar el cierre
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
                    bloque = js_content[inicio:i+1]
                    bloques.append({
                        'texto': bloque,
                        'inicio': inicio,
                        'fin': i + 1,
                        'longitud': len(bloque),
                    })
                    break
            
            i += 1
    
    return bloques


# ── Diagnóstico principal ─────────────────────────────────────────────────────

def diagnosticar():
    """Ejecuta diagnóstico completo del bundle."""
    log.info("=" * 70)
    log.info("DIAGNÓSTICO DE BUNDLE JS - botsrb.info")
    log.info("=" * 70)
    
    # 1. Descargar bundle
    js = _descargar_bundle()
    
    # 2. Extraer bloques mesh
    bloques = _extraer_bloques_mesh(js)
    log.info(f"📦 Bloques mesh encontrados: {len(bloques)}\n")
    
    # 3. Analizar cada bloque
    for i, bloque in enumerate(bloques):
        log.info("=" * 70)
        log.info(f"📋 BLOQUE #{i+1}")
        log.info("=" * 70)
        log.info(f"  Posición: {bloque['inicio']} - {bloque['fin']}")
        log.info(f"  Tamaño: {bloque['longitud']} chars")
        
        texto = bloque['texto']
        texto_dec = _decodificar_unicode(texto)
        
        # --- 3a. Primeros 300 caracteres ---
        log.info(f"\n  🔍 INICIO (primeros 300 chars decodificados):")
        log.info(f"  {texto_dec[:300]}")
        
        # --- 3b. Ciclos encontrados ---
        ciclos = re.findall(r'"(\d+ \d+|Opt|[A-Za-z]+)"\s*:', texto)
        if ciclos:
            log.info(f"\n  📅 CICLOS: {ciclos}")
        
        # --- 3c. Primeros cursos de cada ciclo ---
        log.info(f"\n  📚 PRIMEROS CURSOS POR CICLO:")
        for ciclo_id in ["0 0", "1 1", "1 2", "2 1", "2 2", "3 1", "3 2", "4 1", "4 2", "Opt"]:
            # Buscar el ciclo y extraer primeros 3 códigos
            patron = rf'"{re.escape(ciclo_id)}"\s*:\s*\{{(.*?)\}}'
            match = re.search(patron, texto, re.DOTALL)
            if match:
                contenido = match.group(1)
                # Extraer códigos de curso (palabras antes de :)
                codigos = re.findall(r'([A-Za-z0-9_#]+)\s*:', contenido)
                primeros = codigos[:5]  # Primeros 5
                log.info(f"    {ciclo_id}: {primeros}")
        
        # --- 3d. Buscar códigos de carreras conocidas ---
        log.info(f"\n  🎯 CÓDIGOS DE CARRERA ENCONTRADOS:")
        for sigla, codigos in CODIGOS_CONOCIDOS.items():
            encontrados = [c for c in codigos if c in texto]
            if encontrados:
                log.info(f"    {sigla}: {encontrados}")
        
        # --- 3e. Todos los códigos únicos (primeros 30) ---
        todos_codigos = re.findall(r'"([A-Z][A-Z0-9]{1,6})"\s*:', texto)
        codigos_unicos = list(dict.fromkeys(todos_codigos))  # Mantener orden, eliminar dups
        log.info(f"\n  📝 TODOS LOS CÓDIGOS DE CURSO ({len(codigos_unicos)} únicos):")
        
        # Mostrar solo cursos reales (no áreas con #)
        cursos_reales = [c for c in codigos_unicos if not c.startswith('#')]
        log.info(f"    Cursos reales: {cursos_reales[:40]}")
        
        # Áreas disciplinares
        areas = [c for c in codigos_unicos if c.startswith('#')]
        if areas:
            log.info(f"    Áreas: {areas}")
        
        # --- 3f. Estadísticas ---
        total_cursos = len(cursos_reales)
        total_areas = len(areas)
        log.info(f"\n  📊 ESTADÍSTICAS:")
        log.info(f"    Total cursos: {total_cursos}")
        log.info(f"    Total áreas disciplinares: {total_areas}")
        log.info(f"    Códigos de 4 letras: {sum(1 for c in cursos_reales if len(c) == 4)}")
        log.info(f"    Códigos de 5 letras: {sum(1 for c in cursos_reales if len(c) == 5)}")
        log.info(f"    Códigos de 6 letras: {sum(1 for c in cursos_reales if len(c) == 6)}")
        log.info("")
    
    # 4. Mapeo sugerido de códigos por carrera
    log.info("=" * 70)
    log.info("💡 MAPEO SUGERIDO DE CÓDIGOS POR CARRERA")
    log.info("=" * 70)
    
    carreras_config = list(CARRERAS_CAMPUS_COTO.keys())
    log.info(f"Carreras configuradas ({len(carreras_config)}): {carreras_config}")
    log.info(f"Bloques mesh encontrados: {len(bloques)}")
    
    for i, (sigla, nombre) in enumerate(CARRERAS_CAMPUS_COTO.items()):
        if i < len(bloques):
            texto = bloques[i]['texto']
            # Extraer primeros códigos del bloque
            codigos_bloque = re.findall(r'"([A-Z][A-Z0-9]{1,6})"\s*:', texto)
            primeros_5 = list(dict.fromkeys(codigos_bloque))[:5]
            log.info(f"\n  {sigla} ({nombre}):")
            log.info(f"    Bloque #{i+1}")
            log.info(f"    Primeros códigos: {primeros_5}")
            log.info(f"    Sugerencia: '{sigla}': {primeros_5[:3]},")
        else:
            log.info(f"\n  {sigla} ({nombre}):")
            log.info(f"    ⚠ No hay bloque correspondiente (índice {i} >= {len(bloques)})")
    
    # 5. Guardar reporte
    log.info(f"\n{'=' * 70}")
    log.info("✅ Diagnóstico completado")
    log.info(f"{'=' * 70}")


if __name__ == "__main__":
    diagnosticar()