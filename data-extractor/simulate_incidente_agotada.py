# simulate_incidente_agotada.py
#
# Reproduce el incidente documentado en V2__agregar_estado_oferta_seccion.sql
# (Banner deja de devolver secciones llenas/cerradas una vez abre matrícula,
# y el pipeline viejo las borraba sin recuperación) usando datos REALES:
# las 28 secciones de ISI, II-Ciclo-2026, tomadas del PDF oficial de SIPROCU
# (PROGRAMACIÓN_INGENIERÍA_EN_SISTEMAS_DE_INFORMACIÓN_II-Ciclo-2026.pdf).
#
# OJO: capacidad/inscritos/disponibles NO vienen en ese PDF (es solo la guía
# de horarios del Registro, no tiene cupos) -- están fabricados acá solo
# para poder ejercitar el flujo. Todo lo demás (NRC, código, curso, créditos,
# horario, aula, profesor) es real.
#
# Corre EXCLUSIVAMENTE contra la base LOCAL de Docker (usa las mismas
# variables DATABASE_* que ya tenés en data-extractor/.env). No toca
# Railway/producción.
#
# Uso: desde data-extractor/, con el venv activado:
#   python simulate_incidente_agotada.py
#
# Qué hace, en orden:
#   1. Asegura que exista el período 202620 (II-Ciclo-2026) en la BD.
#   2. Escribe output/raw/banner_isi_202620.json con las 28 secciones
#      completas y corre _insert_sections_from_banner -- deben quedar
#      las 28 en estado_oferta='activa'.
#   3. Reescribe el mismo archivo SIN 3 NRCs (50907, 50918, 50922) --
#      simula que Banner dejó de devolverlas -- y vuelve a correr la
#      misma función. Verifica que esas 3 queden 'agotada' (no borradas)
#      y que capacidad/inscritos/disponibles no cambien.
#   4. Restaura las 28 y corre una vez más -- verifica que las 3
#      "recuperadas" vuelvan a 'activa' (autocuración documentada en el
#      comentario de populate_db.py línea ~525).
#
# Al final imprime un resumen PASA/FALLA de cada verificación.

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg2

from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, OUTPUT_RAW_DIR
from extractors.populate_db import _insert_sections_from_banner

TERM_CODE = "202620"
FIXTURE_PATH = OUTPUT_RAW_DIR / f"banner_isi_{TERM_CODE}.json"

# NRCs que "desaparecen" en el paso 3 (simulan secciones que Banner dejó de
# listar por estar llenas/cerradas). Uno de cada nivel (II, III, IV) para
# probar que el comportamiento es consistente en todo el rango.
NRCS_QUE_DESAPARECEN = {"50907", "50918", "50922"}

# Todos los NRC de ISI que controla este script -- se llena más abajo, una
# vez definido _RAW, para no repetir la lista a mano.
ISI_NRCS: set[str] = set()


def _schedule(day: str, start: str, end: str, classroom: str) -> dict:
    return {"day": day, "start": start, "end": end, "classroom": classroom}


# ── Las 28 secciones reales del PDF (NIVEL, NRC, GRUPO, CÓDIGO, CURSO, CR, horario, aula, profesor) ──
_RAW = [
    # (nrc, grupo, codigo, curso, creditos, [(dia, inicio, fin, aula), ...], profesor, es_general)
    ("50872", "96", "MAT002", "CÁLCULO I", 4,
     [("Miércoles", "09:00", "12:00", "A010"), ("Jueves", "07:00", "09:00", "A011")],
     "Corrales Ureña Elizabeth", False),
    ("50380", "96", "EGS118", "DEBATE CONTEMPORÁNEO REALIDAD NACIONAL E INTERNACIONAL", 3,
     [("Jueves", "13:00", "16:00", "A010")],
     "Luis Guillermo Fernández Álvarez", True),
    ("50384", "96", "EGA121", "ARTE Y PENSAMIENTO COSTARRICENSE", 3,
     [("Jueves", "09:00", "12:00", "A011")],
     "Salazar Arias Karlyn", True),
    ("50875", "96", "LIX411", "INGLÉS INTEGRADO PARA OTRAS CARRERAS II", 4,
     [("Lunes", "09:00", "12:00", "A010"), ("Miércoles", "13:00", "17:00", "A011")],
     "Laura Quirós Pastrana", False),
    ("50851", "96", "EIF201", "PROGRAMACIÓN I", 4,
     [("Sábado", "08:00", "12:00", "A004")],
     "Villalobos Madrigal Jorge Arturo", False),
    ("50883", "97", "LIX411", "INGLÉS INTEGRADO PARA OTRAS CARRERAS II", 4,
     [("Miércoles", "09:00", "12:00", "A011"), ("Viernes", "08:00", "12:00", "A011")],
     "Laura Quirós Pastrana", False),
    ("50389", "97", "EGA121", "ARTE Y PENSAMIENTO COSTARRICENSE", 3,
     [("Jueves", "13:00", "16:00", "A011")],
     "Salazar Arias Karlyn", True),
    ("50386", "97", "EGS101", "CULTURA Y GLOBALIZACIÓN", 3,
     [("Jueves", "09:00", "12:00", "A010")],
     "Luis Guillermo Fernández Álvarez", True),
    ("50884", "91", "EIF200", "FUNDAMENTOS DE INFORMÁTICA", 3,
     [("Viernes", "13:00", "17:00", "A004")],
     "Jeremy Elizondo Castro", False),
    ("50888", "91", "MAT030", "MATEMÁTICA PARA INFORMÁTICA", 4,
     [("Martes", "13:00", "16:00", "A010"), ("Miércoles", "07:00", "09:00", "A010")],
     "Argenis Méndez Villalobos", False),
    ("50886", "92", "EIF200", "FUNDAMENTOS DE INFORMÁTICA", 3,
     [("Lunes", "13:00", "17:00", "A004")],
     "Gamboa Abarca Juan Francisco", False),
    ("53683", "92", "MAT030", "MATEMÁTICA PARA INFORMÁTICA", 4,
     [("Miércoles", "13:00", "16:00", "A010"), ("Jueves", "16:00", "18:00", "A009")],
     "Corrales Ureña Elizabeth", False),
    ("50891", "95", "EIF206", "PROGRAMACIÓN III", 4,
     [("Viernes", "13:00", "17:00", "A006")],
     "Gamboa Abarca Juan Francisco", False),
    ("50895", "95", "EIF207", "ESTRUCTURAS DE DATOS", 4,
     [("Viernes", "08:00", "12:00", "A005")],
     "Gerson Lenin Chacón Bermúdez", False),
    ("50903", "95", "MAT006", "PROBABILIDAD Y ESTADÍSTICA", 3,
     [("Martes", "13:00", "15:00", "A004"), ("Miércoles", "13:00", "16:00", "A006")],
     "Adriana Calvo Alfaro", False),
    ("50897", "95", "EIF205", "ARQUITECTURA DE COMPUTADORES", 3,
     [("Martes", "08:00", "12:00", "A006")],
     "Núñez Morales Juan Gabriel", False),
    ("50898", "95", "EIF404", "LA ORGANIZACIÓN Y SU ENTORNO", 3,
     [("Lunes", "13:00", "17:00", "A003")],
     "José Pablo Noguera Espinoza", False),
    ("50907", "90", "EIF205", "ARQUITECTURA DE COMPUTADORES", 3,
     [("Miércoles", "08:00", "12:00", "A003")],
     "Núñez Morales Juan Gabriel", False),
    ("50889", "92", "EIF204", "PROGRAMACIÓN II", 4,
     [("Viernes", "08:00", "12:00", "A006")],
     "Gamboa Abarca Juan Francisco", False),
    ("50912", "94", "EIF400", "PARADIGMAS DE PROGRAMACIÓN", 4,
     [("Viernes", "13:00", "17:00", "A003")],
     "José Pablo Noguera Espinoza", False),
    ("50914", "94", "EIF401", "INGENIERÍA DE SISTEMAS II", 4,
     [("Jueves", "08:00", "12:00", "A006")],
     "Nury Vanessa Leitón Baltodano", False),
    ("50918", "94", "EIF407", "LIDERAZGO Y ORGANIZACIÓN", 3,
     [("Viernes", "07:00", "11:00", "A004")],
     "Oldemar Villatoro Moya", False),
    ("50916", "94", "EIF402", "ADMINISTRACIÓN DE BASES DE DATOS", 4,
     [("Martes", "13:00", "17:00", "A006")],
     "Jeremy Elizondo Castro", False),
    ("50917", "94", "EIF412", "INVESTIGACIÓN DE OPERACIONES Y SUS APLICACIONES", 3,
     [("Martes", "08:00", "12:00", "A003")],
     "Barrantes Garbanzo Daniel", False),
    ("50921", "93", "EIF425O", "DISEÑO DE AMBIENTES MULTIMEDIALES", 3,
     [("Jueves", "13:00", "17:00", "A006")],
     "Nury Vanessa Leitón Baltodano", False),
    ("50925", "93", "EIF410", "INFORMÁTICA Y SOCIEDAD", 2,
     [("Lunes", "08:00", "12:00", "A002")],
     "Oldemar Villatoro Moya", False),
    ("50922", "93", "EIF440O", "SEGURIDAD INFORMÁTICA", 3,
     [("Viernes", "13:00", "17:00", "A002")],
     "Gerson Lenin Chacón Bermúdez", False),
    ("50919", "93", "EIF409", "APLICACIONES INFORMÁTICAS GLOBALES", 4,
     [("Viernes", "08:00", "12:00", "A003")],
     "José Pablo Noguera Espinoza", False),
]

ISI_NRCS.update(row[0] for row in _RAW)
assert len(ISI_NRCS) == 28, f"Se esperaban 28 NRC únicos, hay {len(ISI_NRCS)}"


def build_sections(excluir: set[str] = frozenset()) -> list[dict]:
    """Arma la lista de secciones en el formato de banner_*.json, excluyendo
    los NRC en `excluir` (para simular que Banner dejó de devolverlos)."""
    out = []
    for nrc, grupo, codigo, curso, creditos, bloques, profesor, es_general in _RAW:
        if nrc in excluir:
            continue
        out.append({
            "crn": nrc,
            "course": codigo,
            "title": curso,
            "credits": creditos,
            "campus": "SRB: Campus Coto",
            "type": "Teoría",
            "section": grupo,
            "capacity": 25,
            "enrolled": 18,
            "available": 7,
            "instructor": profesor,
            "instructor_email": None,
            "schedules": [_schedule(d, s, e, a) for d, s, e, a in bloques],
            "start_date": "",
            "end_date": "",
            "is_general": es_general,
            "metadata": {"banner_program": "isi"},
        })
    return out


def _connect():
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)


def _get_or_create_periodo(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO periodo (codigo, nombre, anio, ciclo, activo)
            VALUES (%s, %s, %s, %s, true)
            ON CONFLICT (codigo) DO UPDATE SET activo = true
            RETURNING id_periodo
            """,
            (TERM_CODE, "II Ciclo 2026", 2026, 2),
        )
        return cur.fetchone()[0]


def _estado_de(conn, period_id: int, nrcs: set[str]) -> dict[str, tuple[str, int, int, int]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT nrc, estado_oferta, capacidad, inscritos, disponibles
            FROM seccion WHERE id_periodo = %s AND nrc = ANY(%s)
            """,
            (period_id, list(nrcs)),
        )
        return {row[0]: row[1:] for row in cur.fetchall()}


def _contar_por_estado(conn, period_id: int, nrcs: set[str]) -> dict[str, int]:
    """
    Cuenta por estado_oferta, restringido al set de NRCs de ISI que este
    script controla. Importante: output/raw/ puede tener otros
    banner_*_202620.json reales de otras carreras (itecad/topo/ingles/adm)
    -- _insert_sections_from_banner los junta TODOS en la misma corrida (no
    discrimina por carrera), así que contar sobre id_periodo completo
    mezclaría secciones ajenas y rompería las aserciones. Filtrar por NRC
    evita eso sin tocar ni un archivo ni una fila que no sea de este test.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT estado_oferta, count(*) FROM seccion
            WHERE id_periodo = %s AND nrc = ANY(%s)
            GROUP BY estado_oferta
            """,
            (period_id, list(nrcs)),
        )
        return dict(cur.fetchall())


def main() -> int:
    fallos = []
    conn = _connect()
    try:
        period_id = _get_or_create_periodo(conn)
        print(f"✓ Período {TERM_CODE} listo (id_periodo={period_id})\n")

        # ── Paso 2: baseline con las 28 secciones completas ──────────────
        print("▶ Paso 1/3: cargando las 28 secciones reales (todas 'activa')")
        FIXTURE_PATH.write_text(json.dumps(build_sections(), ensure_ascii=False, indent=2), encoding="utf-8")
        _insert_sections_from_banner(conn, period_id, {})
        conn.commit()

        conteo = _contar_por_estado(conn, period_id)
        print(f"  Estado tras carga completa: {conteo}")
        if conteo.get("activa", 0) != 28 or conteo.get("agotada", 0):
            fallos.append(f"Baseline esperaba 28 activa / 0 agotada, obtuvo {conteo}")
        print()

        # ── Paso 3: simular que Banner deja de devolver 3 NRCs ───────────
        print(f"▶ Paso 2/3: simulando que Banner deja de listar {sorted(NRCS_QUE_DESAPARECEN)}")
        FIXTURE_PATH.write_text(
            json.dumps(build_sections(excluir=NRCS_QUE_DESAPARECEN), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        _insert_sections_from_banner(conn, period_id, {})
        conn.commit()

        estado = _estado_de(conn, period_id, NRCS_QUE_DESAPARECEN)
        conteo = _contar_por_estado(conn, period_id)
        print(f"  Estado tras la 'desaparición': {conteo}")
        for nrc in sorted(NRCS_QUE_DESAPARECEN):
            fila = estado.get(nrc)
            print(f"    NRC {nrc}: {fila}")
            if fila is None:
                fallos.append(f"NRC {nrc} desapareció de la tabla seccion (se borró) -- esto es el bug viejo")
            elif fila[0] != "agotada":
                fallos.append(f"NRC {nrc} quedó en estado '{fila[0]}', esperaba 'agotada'")
            elif fila[1:] != (25, 18, 7):
                fallos.append(f"NRC {nrc} perdió sus datos de cupos: {fila[1:]} (esperaba 25/18/7)")
        if conteo.get("activa", 0) != 25 or conteo.get("agotada", 0) != 3:
            fallos.append(f"Esperaba 25 activa / 3 agotada, obtuvo {conteo}")
        print()

        # ── Paso 4: Banner vuelve a listar todo -- ¿se autocura? ─────────
        print("▶ Paso 3/3: restaurando las 28 -- verificando que las 3 vuelvan a 'activa'")
        FIXTURE_PATH.write_text(json.dumps(build_sections(), ensure_ascii=False, indent=2), encoding="utf-8")
        _insert_sections_from_banner(conn, period_id, {})
        conn.commit()

        estado = _estado_de(conn, period_id, NRCS_QUE_DESAPARECEN)
        conteo = _contar_por_estado(conn, period_id)
        print(f"  Estado tras la 'recuperación': {conteo}")
        for nrc in sorted(NRCS_QUE_DESAPARECEN):
            fila = estado.get(nrc)
            if fila is None or fila[0] != "activa":
                fallos.append(f"NRC {nrc} no se recuperó a 'activa' tras reaparecer en Banner: {fila}")
        if conteo.get("activa", 0) != 28 or conteo.get("agotada", 0):
            fallos.append(f"Esperaba 28 activa / 0 agotada tras la recuperación, obtuvo {conteo}")

    finally:
        conn.close()

    print("\n" + "=" * 60)
    if fallos:
        print(f"✗ {len(fallos)} verificación(es) FALLARON:")
        for f in fallos:
            print(f"  - {f}")
        return 1

    print("✓ TODAS las verificaciones PASARON -- el fix de Sprint 8 protege")
    print("  correctamente las secciones reales de ISI ante el escenario del")
    print("  incidente original (Banner deja de listarlas y luego reaparecen).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
