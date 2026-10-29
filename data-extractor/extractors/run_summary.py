# extractors/run_summary.py
"""
Resumen de una corrida del ETL -> output/run_summary.json.

El ETL no sabe nada de Telegram: solo deja este archivo, que después leen
notify_telegram.py (aviso) y el workflow ($GITHUB_STEP_SUMMARY).

Los cambios se detectan por DIFERENCIA DE CONJUNTOS entre una foto de las
secciones del período tomada antes de cargarlo y otra tomada después,
dentro de la misma transacción y justo antes del commit. Nunca por
actualizado_en: el upsert lo toca en cada corrida aunque nada cambie.

Contenido: solo NRC, códigos y nombres de curso, códigos de período y
conteos. Nunca datos de estudiantes.
"""

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from config import BASE_DIR

SUMMARY_PATH = BASE_DIR / "output" / "run_summary.json"
SUMMARY_VERSION = 1

STATUS_OK = "ok"
STATUS_PARTIAL_FAILURE = "partial_failure"
STATUS_FAILED = "failed"

# Motivos de una salida temprana (el ETL no llegó a cargar los períodos o
# se cortó a la mitad). Son códigos fijos, no el texto de la excepción:
# así el resumen nunca arrastra hosts, rutas ni credenciales.
FATAL_DB_UNAVAILABLE = "db_unavailable"
FATAL_SYLLABUS = "syllabus"
FATAL_UNEXPECTED = "unexpected"

ESTADO_AGOTADA = "agotada"


# ──────────────────────────────────────────────────────────────────────────────
# Foto de las secciones de un período
# ──────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SectionState:
    course_code: str
    # curso.nombre (malla); si el curso no está en la malla, seccion.titulo
    # (Banner, puede traer entidades HTML); como último recurso, el código.
    course_name: str
    estado: str
    blocks: int


Snapshot = dict[str, SectionState]  # {nrc: estado de la sección}


def find_period_id(cur, code: str) -> int | None:
    cur.execute("SELECT id_periodo FROM periodo WHERE codigo = %s", (code,))
    row = cur.fetchone()
    return row[0] if row else None


def snapshot_term(cur, period_id: int) -> Snapshot:
    """Foto {nrc: SectionState} de todas las secciones de un período."""
    cur.execute(
        """
        SELECT s.nrc,
               s.codigo_curso_banner,
               COALESCE(NULLIF(c.nombre, ''), NULLIF(s.titulo, ''), s.codigo_curso_banner),
               s.estado_oferta,
               count(hb.id_horario_bloque)
        FROM seccion s
        LEFT JOIN curso c ON c.id_curso = s.id_curso
        LEFT JOIN horario_bloque hb ON hb.id_seccion = s.id_seccion
        WHERE s.id_periodo = %s
        GROUP BY s.id_seccion, s.nrc, s.codigo_curso_banner, c.nombre, s.titulo, s.estado_oferta
        """,
        (period_id,),
    )
    return {
        nrc: SectionState(code, name, estado, blocks)
        for nrc, code, name, estado, blocks in cur.fetchall()
    }


def snapshot_term_by_code(conn, code: str) -> Snapshot:
    """Foto del período por código; vacía si el período todavía no existe."""
    with conn.cursor() as cur:
        period_id = find_period_id(cur, code)
        return snapshot_term(cur, period_id) if period_id is not None else {}


def snapshot_periods(cur) -> dict[str, bool]:
    """{codigo: activo} de todos los períodos."""
    cur.execute("SELECT codigo, activo FROM periodo")
    return {code: active for code, active in cur.fetchall()}


# ──────────────────────────────────────────────────────────────────────────────
# Diferencia de conjuntos
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class TermDiff:
    # El período no tenía ninguna sección antes de esta corrida.
    first_load: bool
    sections_total: int
    sections_with_schedule: int
    new: list[dict] = field(default_factory=list)
    exhausted: list[dict] = field(default_factory=list)
    reappeared: list[dict] = field(default_factory=list)
    schedule_published: list[dict] = field(default_factory=list)

    @property
    def has_changes(self) -> bool:
        return bool(self.new or self.exhausted or self.reappeared or self.schedule_published)


def _refs(nrcs: set[str], snap: Snapshot) -> list[dict]:
    refs = [
        {"nrc": nrc, "course_code": snap[nrc].course_code, "course_name": snap[nrc].course_name}
        for nrc in nrcs
    ]
    return sorted(refs, key=lambda r: (r["course_code"], r["nrc"]))


def diff_term(before: Snapshot, after: Snapshot) -> TermDiff:
    """
    Compara dos fotos del mismo período. Función pura.

    - nuevas: NRC que no estaban antes.
    - agotadas: pasaron de cualquier otro estado a 'agotada'.
    - reaparecidas: estaban 'agotada' y ya no.
    - horario publicado: la sección ya existía con 0 bloques y ahora tiene
      alguno. Una sección nueva cuenta SOLO como nueva.

    Las secciones nunca se borran (ver V2), así que un NRC que está antes y
    no después no puede pasar; si pasara, se ignora.
    """
    common = before.keys() & after.keys()
    return TermDiff(
        first_load=not before,
        sections_total=len(after),
        sections_with_schedule=sum(1 for s in after.values() if s.blocks > 0),
        new=_refs(after.keys() - before.keys(), after),
        exhausted=_refs(
            {n for n in common if before[n].estado != ESTADO_AGOTADA and after[n].estado == ESTADO_AGOTADA},
            after,
        ),
        reappeared=_refs(
            {n for n in common if before[n].estado == ESTADO_AGOTADA and after[n].estado != ESTADO_AGOTADA},
            after,
        ),
        schedule_published=_refs(
            {n for n in common if before[n].blocks == 0 and after[n].blocks > 0},
            after,
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Conteo de WARNING / ERROR
# ──────────────────────────────────────────────────────────────────────────────

class LogCounter(logging.Handler):
    """Cuenta los WARNING y los ERROR (o más graves) que se loguean."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.warnings = 0
        self.errors = 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno >= logging.ERROR:
            self.errors += 1
        else:
            self.warnings += 1


# ──────────────────────────────────────────────────────────────────────────────
# Resumen de la corrida
# ──────────────────────────────────────────────────────────────────────────────

def compute_status(fatal_reason: str | None, loaded: int, failed: int) -> str:
    """
    - failed: salida temprana o excepción global (fatal_reason), o se
      intentó cargar períodos y fallaron todos.
    - partial_failure: falló al menos un período y otro se cargó bien.
    - ok: ningún período falló (también si no había ninguno para cargar).
    """
    if fatal_reason or (failed and not loaded):
        return STATUS_FAILED
    if failed:
        return STATUS_PARTIAL_FAILURE
    return STATUS_OK


@dataclass
class RunSummary:
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    terms: list[dict] = field(default_factory=list)
    failed_terms: list[dict] = field(default_factory=list)
    active_changes: list[dict] = field(default_factory=list)
    fatal_reason: str | None = None

    def record_term(self, code: str, name: str, diff: TermDiff, is_new: bool) -> None:
        self.terms.append({
            "code": code,
            "name": name,
            "is_new": is_new,
            "first_load": diff.first_load,
            "sections_total": diff.sections_total,
            "sections_with_schedule": diff.sections_with_schedule,
            "new": diff.new,
            "exhausted": diff.exhausted,
            "reappeared": diff.reappeared,
            "schedule_published": diff.schedule_published,
            "has_changes": diff.has_changes,
        })

    def record_failed_term(self, code: str, name: str) -> None:
        self.failed_terms.append({"code": code, "name": name})

    def record_active_changes(self, before: dict[str, bool], after: dict[str, bool], names: dict[str, str]) -> None:
        """Diferencia de {codigo: activo} antes y después de la regla de activo."""
        for code in sorted(after):
            if before.get(code, False) != after[code]:
                self.active_changes.append({"code": code, "name": names.get(code, code), "active": after[code]})

    def mark_fatal(self, reason: str) -> None:
        # Se conserva el primer motivo: es la causa, el resto son consecuencias.
        self.fatal_reason = self.fatal_reason or reason

    def to_dict(self, exit_code: int | None, counter: LogCounter | None, finished_at: datetime | None = None) -> dict:
        new_terms = [t["code"] for t in self.terms if t["is_new"]]
        has_changes = bool(
            any(t["has_changes"] for t in self.terms) or self.active_changes or new_terms
        )
        return {
            "version": SUMMARY_VERSION,
            "started_at": self.started_at.isoformat(timespec="seconds"),
            "finished_at": (finished_at or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
            "exit_code": exit_code,
            "status": compute_status(self.fatal_reason, len(self.terms), len(self.failed_terms)),
            "fatal_reason": self.fatal_reason,
            "has_changes": has_changes,
            "warnings": counter.warnings if counter else 0,
            "errors": counter.errors if counter else 0,
            "new_terms": new_terms,
            "failed_terms": self.failed_terms,
            "active_changes": self.active_changes,
            "terms": sorted(self.terms, key=lambda t: t["code"]),
        }


def remove_summary(path: Path = SUMMARY_PATH) -> None:
    """Al arrancar: que nunca quede el resumen de una corrida anterior."""
    path.unlink(missing_ok=True)


def write_summary(data: dict, path: Path = SUMMARY_PATH) -> None:
    """Escritura atómica: un lector nunca ve un JSON a medias."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
