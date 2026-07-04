# models/schemas.py
# Modelos intermedios de datos. Son los contratos entre los extractores
# y el pipeline de carga a PostgreSQL. Usar dataclasses garantiza tipado
# explícito y serialización sencilla a JSON.

from dataclasses import dataclass, field, asdict
from typing import Optional
import json


# ── Malla curricular ──────────────────────────────────────────────────────────

@dataclass
class Prerequisito:
    """
    Representa una relación de dependencia entre cursos.
    tipo: 'AND' si todos deben aprobarse, 'OR' si basta con uno.
    """
    codigos: list[str]
    tipo: str = "AND"  # "AND" | "OR"


@dataclass
class CursoMalla:
    """
    Un curso extraído de la malla curricular (botsrb.info).
    Esta es la fuente de verdad para datos académicos permanentes.
    """
    codigo: str                          # Ej: "EIF201"
    nombre: str                          # Ej: "Programación I"
    creditos: int                        # Ej: 4
    nivel: str                           # Ej: "Nivel I", "Nivel II"
    carrera_sigla: str                   # Ej: "isi"
    carrera_nombre: str                  # Ej: "Ingeniería en Sistemas"
    prerequisitos: list[Prerequisito] = field(default_factory=list)
    correquisitos: list[str] = field(default_factory=list)  # Códigos simples

    def to_dict(self) -> dict:
        """Serialización segura para guardar en JSON."""
        d = asdict(self)
        return d

    def __post_init__(self):
        # Normalización defensiva al construir el objeto
        self.codigo  = self.codigo.strip().upper()
        self.nombre  = self.nombre.strip()
        self.creditos = int(self.creditos) if self.creditos else 0


# ── Oferta académica (Banner) ─────────────────────────────────────────────────

@dataclass
class BloqueHorario:
    """
    Un bloque de tiempo dentro de una sección.
    Una sección puede tener múltiples bloques (ej. Lab + Teoría).
    """
    dia: str          # "Lunes", "Martes", etc.
    hora_inicio: str  # "07:00"
    hora_fin: str     # "09:00"
    aula: str = ""


@dataclass
class SeccionBanner:
    """
    Una sección de curso extraída del catálogo Banner del Campus Coto.
    """
    crn: str                    # courseReferenceNumber — identificador único
    codigo_curso: str           # Ej: "EIF201" — llave para el join con CursoMalla
    nombre_curso: str
    numero_seccion: str         # Ej: "01", "02"
    profesor: str
    modalidad: str              # "Presencial", "Virtual", "Híbrida"
    cupo_total: int
    cupo_disponible: int
    ciclo: str                  # Ej: "202620"
    campus: str = "Campus Coto"
    bloques_horario: list[BloqueHorario] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def __post_init__(self):
        self.crn          = str(self.crn).strip()
        self.codigo_curso = self.codigo_curso.strip().upper()


# ── Helpers de serialización ──────────────────────────────────────────────────

def guardar_json(datos: list, ruta_archivo) -> None:
    """
    Guarda una lista de dataclasses como JSON con indentación legible.
    Uso: guardar_json(cursos, OUTPUT_RAW_DIR / "malla_isi.json")
    """
    with open(ruta_archivo, "w", encoding="utf-8") as f:
        json.dump(
            [d.to_dict() if hasattr(d, "to_dict") else d for d in datos],
            f,
            ensure_ascii=False,
            indent=2
        )
    print(f"  ✓ Guardado: {ruta_archivo} ({len(datos)} registros)")


def cargar_json(ruta_archivo) -> list[dict]:
    """Carga un JSON y devuelve la lista de dicts."""
    with open(ruta_archivo, "r", encoding="utf-8") as f:
        return json.load(f)