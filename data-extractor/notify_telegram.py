# notify_telegram.py
"""
Aviso del ETL por Telegram, a partir de output/run_summary.json.

Corre en un paso APARTE del workflow (if: always()), después del ETL. Solo
usa la biblioteca estándar: tiene que poder avisar aunque haya fallado el
pip install. Nunca importa nada del ETL ni toca la BD.

Reglas de envío (decide):
  - sin resumen (el ETL murió antes de generarlo) -> mensaje de fallo
  - status failed / partial_failure               -> mensaje de fallo + link
  - hubo cambios                                  -> resumen de cambios
  - corrida manual sin cambios                    -> "sin cambios"
  - lunes sin cambios (hora Costa Rica)           -> latido semanal
  - otro día sin cambios                          -> no se envía nada

Secrets: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID. Si faltan: WARNING y exit 0
(salvo --test, que existe justamente para probar el canal). Si el envío
falla: exit 1, en este paso; el del ETL ya terminó y queda en verde.

El token nunca se loguea: las excepciones de urllib llevan la URL
.../bot<TOKEN>/sendMessage, así que se atrapan y solo se informa el tipo
de error y el código HTTP; además todo el log pasa por un filtro que
reemplaza el token.

Uso:
  python notify_telegram.py --run-url URL     aviso según el resumen
  python notify_telegram.py --test            mensaje de prueba, sin ETL
"""

import argparse
import html
import json
import logging
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SUMMARY_PATH = Path(__file__).resolve().parent / "output" / "run_summary.json"

# Costa Rica no tiene horario de verano: UTC-6 fijo, sin depender de tzdata.
CR_TZ = timezone(timedelta(hours=-6))

API_URL = "https://api.telegram.org/bot{token}/sendMessage"
SEND_TIMEOUT_SECONDS = 15

# Tope de renglones de curso del mensaje (los títulos de período no
# cuentan); después, "… y N más". El detalle completo queda en
# run_summary.json y en el resumen de la corrida de GitHub.
MAX_LINES = 15
# Si una categoría (ej. 'agotada') toca más cursos que esto en un período,
# va en un solo renglón con el total en vez de un renglón por curso.
COLLAPSE_COURSES = 5

TEST_MESSAGE = "SIHA ETL: notificaciones OK"
HEARTBEAT_MESSAGE = "SIHA ETL OK (latido semanal): sin cambios en la corrida de hoy"
MANUAL_NO_CHANGES_MESSAGE = "SIHA ETL OK: sin cambios (corrida manual)"
NO_SEND_NOTE = "SIHA ETL OK: sin cambios en la corrida de hoy"

KIND_CHANGES = "changes"
KIND_FAILURE = "failure"
KIND_HEARTBEAT = "heartbeat"
KIND_NO_CHANGES = "no_changes"

FATAL_REASONS = {
    "db_unavailable": "no se pudo conectar a la BD",
    "syllabus": "no se pudo generar la malla",
    "unexpected": "error inesperado",
}

MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

log = logging.getLogger("notify_telegram")


class TelegramSendError(RuntimeError):
    """El envío falló. El mensaje ya viene sin token."""


# ──────────────────────────────────────────────────────────────────────────────
# Reglas de envío
# ──────────────────────────────────────────────────────────────────────────────

def cr_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(CR_TZ).date()


def decide(summary: dict | None, today: date, event: str | None) -> str | None:
    """Qué mensaje mandar, o None si no se manda nada."""
    if summary is None:
        return KIND_FAILURE
    if summary.get("status") != "ok":
        return KIND_FAILURE
    if summary.get("has_changes"):
        return KIND_CHANGES
    if event == "workflow_dispatch":
        return KIND_NO_CHANGES
    if today.weekday() == 0:  # lunes
        return KIND_HEARTBEAT
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Formato
# ──────────────────────────────────────────────────────────────────────────────

def _when(summary: dict) -> str:
    try:
        dt = datetime.fromisoformat(summary["started_at"]).astimezone(CR_TZ)
    except (KeyError, TypeError, ValueError):
        return ""
    return f"{dt.day:02d}/{MONTHS[dt.month - 1]} {dt:%H:%M}"


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _counts_line(summary: dict) -> str | None:
    parts = []
    if summary.get("warnings"):
        parts.append(_plural(summary["warnings"], "advertencia", "advertencias"))
    if summary.get("errors"):
        parts.append(_plural(summary["errors"], "error", "errores"))
    return "⚠ " + " · ".join(parts) if parts else None


def course_display_name(ref: dict) -> str:
    """Nombre del curso para el mensaje: los títulos de Banner traen entidades HTML."""
    return html.unescape(ref.get("course_name") or ref.get("course_code") or "").strip()


# Por categoría: texto por curso (n secciones) y texto agregado (n secciones, k cursos).
_PER_COURSE = {
    "new": lambda n: _plural(n, "sección nueva", "secciones nuevas"),
    "reappeared": lambda n: "1 sección reapareció" if n == 1 else f"{n} secciones reaparecieron",
    "schedule_published": lambda n: "horario publicado" if n == 1 else f"horario publicado ({n} secciones)",
    "exhausted": lambda n: _plural(n, "sección agotada", "secciones agotadas"),
}
_AGGREGATE = {
    "new": lambda n, k: f"{_plural(n, 'sección nueva', 'secciones nuevas')} ({k} cursos)",
    "reappeared": lambda n, k: f"{n} secciones reaparecieron ({k} cursos)",
    "schedule_published": lambda n, k: f"horario publicado en {n} secciones ({k} cursos)",
    "exhausted": lambda n, k: f"{n} secciones pasaron a agotada ({k} cursos)",
}
_CATEGORIES = ["new", "reappeared", "schedule_published", "exhausted"]


def _term_lines(term: dict) -> list[str]:
    """Renglones (sin viñeta) de un período cargado, agrupados por curso."""
    if term.get("first_load"):
        if not term.get("sections_total"):
            return []
        return [
            f"primera carga: {_plural(term['sections_total'], 'sección', 'secciones')} "
            f"({term.get('sections_with_schedule', 0)} con horario)"
        ]

    aggregates: list[str] = []
    by_course: dict[str, dict] = defaultdict(lambda: {"name": "", "counts": {}})
    for category in _CATEGORIES:
        refs = term.get(category) or []
        if not refs:
            continue
        courses = {r.get("course_code") for r in refs}
        if len(courses) > COLLAPSE_COURSES:
            aggregates.append(_AGGREGATE[category](len(refs), len(courses)))
            continue
        for r in refs:
            entry = by_course[r.get("course_code")]
            entry["name"] = entry["name"] or course_display_name(r)
            entry["counts"][category] = entry["counts"].get(category, 0) + 1

    course_lines = [
        f"{entry['name']}: " + ", ".join(_PER_COURSE[c](entry["counts"][c]) for c in _CATEGORIES if c in entry["counts"])
        for entry in sorted(by_course.values(), key=lambda e: e["name"].lower())
    ]
    return aggregates + course_lines


def _change_blocks(summary: dict) -> list[tuple[str, list[str]]]:
    """[(título del período, renglones)], en orden de código de período."""
    blocks: dict[str, tuple[str, list[str]]] = {}
    for term in summary.get("terms") or []:
        blocks[term["code"]] = (term.get("name") or term["code"], _term_lines(term))
    for change in summary.get("active_changes") or []:
        name, lines = blocks.setdefault(change["code"], (change.get("name") or change["code"], []))
        lines.insert(0, "ahora seleccionable (activo)" if change["active"] else "ya no seleccionable (inactivo)")
    return [blocks[code] for code in sorted(blocks) if blocks[code][1]]


def _render_blocks(blocks: list[tuple[str, list[str]]], max_lines: int | None) -> list[str]:
    out: list[str] = []
    shown = 0
    total = sum(len(lines) for _, lines in blocks)
    for title, lines in blocks:
        if max_lines is not None and shown >= max_lines:
            break
        out.append(title)
        for line in lines:
            if max_lines is not None and shown >= max_lines:
                break
            out.append(f"• {line}")
            shown += 1
    if shown < total:
        out.append(f"… y {total - shown} más")
    return out


def _failure_header(summary: dict | None) -> str:
    if summary is None:
        return "❌ SIHA · ETL: la corrida murió antes de generar el resumen (o no se pudo leer)"
    when = _when(summary)
    failed = summary.get("failed_terms") or []
    failed_names = ", ".join(f"{t.get('name') or t['code']} ({t['code']})" for t in failed)
    if summary.get("status") == "partial_failure":
        return f"⚠️ SIHA · ETL {when}: fallo parcial. Falló {failed_names}; el resto se cargó"
    if summary.get("fatal_reason"):
        reason = FATAL_REASONS.get(summary["fatal_reason"], summary["fatal_reason"])
    elif failed:
        reason = f"fallaron todos los períodos: {failed_names}"
    else:
        reason = "error"
    return f"❌ SIHA · ETL {when}: falló ({reason})"


def format_message(summary: dict | None, kind: str, run_url: str | None = None,
                   max_lines: int | None = MAX_LINES) -> str:
    """Texto del mensaje. max_lines=None: sin truncar (resumen de GitHub)."""
    if kind == KIND_FAILURE:
        lines = [_failure_header(summary)]
        if summary is not None:
            lines += _render_blocks(_change_blocks(summary), max_lines)
    elif kind == KIND_CHANGES:
        lines = [f"📚 SIHA · ETL {_when(summary)}"] + _render_blocks(_change_blocks(summary), max_lines)
    elif kind == KIND_HEARTBEAT:
        lines = [HEARTBEAT_MESSAGE]
    elif kind == KIND_NO_CHANGES:
        lines = [MANUAL_NO_CHANGES_MESSAGE]
    else:
        lines = [NO_SEND_NOTE]

    if summary is not None:
        counts = _counts_line(summary)
        if counts:
            lines.append(counts)
    if kind == KIND_FAILURE and run_url:
        lines.append(f"Ver corrida: {run_url}")
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────────
# Envío
# ──────────────────────────────────────────────────────────────────────────────

def redact(text: str, token: str | None) -> str:
    return text.replace(token, "***") if token else text


class RedactTokenFilter(logging.Filter):
    """Última línea de defensa: ningún registro de log sale con el token."""

    def __init__(self, token: str | None):
        super().__init__()
        self.token = token

    def filter(self, record: logging.LogRecord) -> bool:
        if self.token:
            record.msg = redact(record.getMessage(), self.token)
            record.args = None
        return True


def _telegram_description(err: urllib.error.HTTPError) -> str:
    try:
        return json.loads(err.read().decode("utf-8")).get("description", "")
    except Exception:
        return ""


def send(token: str, chat_id: str, text: str) -> None:
    """POST sendMessage. Lanza TelegramSendError (sin token) si falla."""
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": "true",
    }).encode("utf-8")
    request = urllib.request.Request(API_URL.format(token=token), data=data, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        description = _telegram_description(e)
        raise TelegramSendError(redact(f"HTTP {e.code}" + (f": {description}" if description else ""), token)) from None
    except (OSError, ValueError) as e:  # URLError, timeout, JSON inválido
        # Sin str(e): algunas excepciones de urllib incluyen la URL con el token.
        raise TelegramSendError(type(e).__name__) from None
    if not body.get("ok"):
        raise TelegramSendError(redact(f"Telegram respondió ok=false: {body.get('description', '')}", token))


# ──────────────────────────────────────────────────────────────────────────────
# Entrada
# ──────────────────────────────────────────────────────────────────────────────

def load_summary(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        log.warning(f"No existe {path}: el ETL murió antes de generar el resumen")
    except (OSError, ValueError):
        log.warning(f"No se pudo leer {path}")
    return None


def write_step_summary(text: str, note: str) -> None:
    """Mismo resumen (sin truncar) en el resumen de la corrida de GitHub."""
    target = os.getenv("GITHUB_STEP_SUMMARY")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as f:
        f.write("### SIHA · ETL\n\n" + "  \n".join(text.splitlines()) + f"\n\n_Telegram: {note}_\n")


def main(argv: list[str] | None = None, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aviso del ETL de SIHA por Telegram")
    parser.add_argument("--test", action="store_true", help=f'manda "{TEST_MESSAGE}" y termina')
    parser.add_argument("--run-url", default=None, help="link a la corrida de GitHub Actions")
    parser.add_argument("--summary", type=Path, default=SUMMARY_PATH)
    args = parser.parse_args(argv)

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    redactor = RedactTokenFilter(token)
    log.addFilter(redactor)
    try:
        return _run(args, token, chat_id, now)
    finally:
        log.removeFilter(redactor)


def _run(args, token: str, chat_id: str, now: datetime | None) -> int:
    if args.test:
        if not (token and chat_id):
            log.error("--test: faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID")
            return 1
        try:
            send(token, chat_id, TEST_MESSAGE)
        except TelegramSendError as e:
            log.error(f"--test: no se pudo enviar el mensaje de prueba ({e})")
            return 1
        log.info("Mensaje de prueba enviado")
        return 0

    summary = load_summary(args.summary)
    kind = decide(summary, cr_today(now), os.getenv("GITHUB_EVENT_NAME"))
    text = format_message(summary, kind, args.run_url, max_lines=None)

    if kind is None:
        write_step_summary(text, "no se envía (sin cambios y no es lunes)")
        log.info("Sin cambios y no es lunes: no se envía nada")
        return 0
    if not (token and chat_id):
        write_step_summary(text, "no enviado (faltan los secrets)")
        log.warning("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID: no se envía el aviso")
        return 0

    try:
        send(token, chat_id, format_message(summary, kind, args.run_url))
    except TelegramSendError as e:
        write_step_summary(text, f"falló el envío ({e})")
        if summary is not None and summary.get("status") == "ok":
            log.error(f"El ETL terminó bien; solo falló el aviso a Telegram ({e})")
        else:
            log.error(f"No se pudo enviar el aviso a Telegram ({e}); además el ETL falló, revisá la corrida")
        return 1
    write_step_summary(text, "enviado")
    log.info(f"Aviso enviado ({kind})")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    sys.exit(main())
