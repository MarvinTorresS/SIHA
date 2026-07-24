/**
 * Backfill one-shot de historial_curso.id_slot_malla (V9).
 *
 * Cubre DOS casos de datos legado, cada uno espejado para GEN{n} y OPT{n}:
 *
 * 1) "Curso real sin slot": el estudiante tiene un curso REAL (un general
 *    tipo EGA121, o una electiva real del catálogo "Optativos", ver
 *    esOptativaCatalogo en estudiante.service.ts) marcado aprobado/
 *    cursando en su historial, sin ningún slot GEN{n}/OPT{n} vinculado
 *    todavía -- se infiere el emparejamiento por orden estable (misma
 *    heurística que ya corría en cada lectura, ver
 *    resolverCursoGeneralParaSlot), y se persiste en id_slot_malla DEL
 *    HISTORIAL DEL CURSO REAL (no del slot).
 *
 * 2) "Placeholder legacy directo": el propio placeholder GEN{n}_sigla /
 *    OPT{n}_sigla quedó marcado aprobado/cursando DIRECTO en el
 *    historial (de antes de que existiera el Sheet "¿cuál curso
 *    aprobaste?" -- ver AsignarCursoRealSheet) -- no hay curso real
 *    distinguido del cual inferir nada. Se llena id_slot_malla con el
 *    propio id_curso (self-reference: la fila ya representa, ella misma,
 *    el slot ocupado) -- sin esto, contarSlotsUsados (que cuenta por
 *    join slot_malla.codigo LIKE 'GEN%'/'OPT%') no ve estas filas y
 *    subcuenta cuántos generales/optativas ya tiene el estudiante, tanto
 *    en la Malla como en el tope de Mis Cursos.
 *
 * Los dos casos son mutuamente excluyentes por fila (una fila de
 * historial o es un curso real, o es el placeholder mismo -- nunca
 * ambos), así que el orden de ejecución entre ellos no importa para la
 * corrección. El Caso 1 SÍ necesita excluir de su pool de slots
 * disponibles cualquier slot que ya tenga su PROPIA fila de historial
 * (Caso 2 de ESE slot) -- si no, podría reasignar por error un slot que
 * el legacy ya marcó resuelto directamente a un curso real distinto.
 *
 * Aditivo y reversible: SOLO llena id_slot_malla (columna nueva,
 * nullable) -- nunca toca id_curso ni estado. Revertir = poner
 * id_slot_malla en NULL de nuevo (ver comando al final de este archivo).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ESTADOS_CUENTAN = ["aprobado", "cursando"] as const;

/**
 * Caso 1: empareja cada curso REAL (aprobado/cursando, sin slot) con un
 * slot GEN{n}/OPT{n} de la carrera del estudiante que todavía no tenga
 * ninguna fila propia en el historial (esos ya están resueltos vía Caso 2
 * y no deben reusarse). `tipo` decide tanto qué cuenta como "curso real"
 * como qué slots se ofrecen.
 */
async function backfillCursoRealSinSlot(tipo: "GEN" | "OPT"): Promise<number> {
  const filtroCursoReal =
    tipo === "GEN"
      ? { es_general: true }
      : { ciclo_id: "Opt", es_optativo: false, es_general: false };

  const filas = await prisma.historial_curso.findMany({
    where: { curso: filtroCursoReal, estado: { in: [...ESTADOS_CUENTAN] }, id_slot_malla: null },
    orderBy: { id_historial: "asc" },
  });

  const porEstudiante = new Map<number, typeof filas>();
  for (const fila of filas) {
    const lista = porEstudiante.get(fila.id_estudiante) ?? [];
    lista.push(fila);
    porEstudiante.set(fila.id_estudiante, lista);
  }

  let actualizadas = 0;
  for (const [idEstudiante, historiales] of porEstudiante) {
    const estudiante = await prisma.estudiante.findUniqueOrThrow({
      where: { id_estudiante: idEstudiante },
    });

    const idsCursosUsados = new Set(
      (
        await prisma.historial_curso.findMany({
          where: { id_estudiante: idEstudiante },
          select: { id_curso: true },
        })
      ).map((h) => h.id_curso)
    );

    const slots = (
      await prisma.curso_carrera.findMany({
        where: { id_carrera: estudiante.id_carrera, curso: { codigo: { startsWith: tipo } } },
        include: { curso: true },
      })
    )
      // Slot que ya tiene su propia fila de historial = ya resuelto por
      // el Caso 2 (o por una corrida previa de este mismo script) -- no
      // reasignarlo a otro curso real.
      .filter((cc) => !idsCursosUsados.has(cc.curso.id_curso))
      .sort((a, b) => a.curso.codigo.localeCompare(b.curso.codigo, undefined, { numeric: true }));

    const n = Math.min(slots.length, historiales.length);
    for (let i = 0; i < n; i++) {
      await prisma.historial_curso.update({
        where: { id_historial: historiales[i].id_historial },
        data: { id_slot_malla: slots[i].curso.id_curso },
      });
      actualizadas++;
      console.log(
        `  [${tipo}] curso real: estudiante ${estudiante.carnet}, historial #${historiales[i].id_historial} -> slot ${slots[i].curso.codigo}`
      );
    }
  }
  return actualizadas;
}

/**
 * Caso 2: el placeholder GEN{n}_sigla/OPT{n}_sigla quedó marcado
 * aprobado/cursando DIRECTO en el historial (id_curso = el propio
 * placeholder) -- self-reference, no hay curso real que inferir.
 */
async function backfillPlaceholderLegacyDirecto(tipo: "GEN" | "OPT"): Promise<number> {
  const patron = new RegExp(`^${tipo}\\d+_`);

  const filas = await prisma.historial_curso.findMany({
    where: {
      curso: { codigo: { startsWith: tipo } },
      estado: { in: [...ESTADOS_CUENTAN] },
      id_slot_malla: null,
    },
    include: { curso: true, estudiante: true },
  });

  let actualizadas = 0;
  for (const fila of filas) {
    // startsWith ya casi lo garantiza; el regex es la red de seguridad
    // real contra un código que empiece igual por coincidencia.
    if (!patron.test(fila.curso.codigo)) continue;

    await prisma.historial_curso.update({
      where: { id_historial: fila.id_historial },
      data: { id_slot_malla: fila.id_curso },
    });
    actualizadas++;
    console.log(
      `  [${tipo}] placeholder legacy directo: estudiante ${fila.estudiante.carnet}, historial #${fila.id_historial} (${fila.curso.codigo}) -> self-reference`
    );
  }
  return actualizadas;
}

async function main() {
  console.log("Caso 1 -- curso real sin slot (GEN):");
  const realGen = await backfillCursoRealSinSlot("GEN");
  console.log(`  Total filas actualizadas: ${realGen}`);

  console.log("\nCaso 1 -- curso real sin slot (OPT):");
  const realOpt = await backfillCursoRealSinSlot("OPT");
  console.log(`  Total filas actualizadas: ${realOpt}`);

  console.log("\nCaso 2 -- placeholder legacy directo (GEN):");
  const legacyGen = await backfillPlaceholderLegacyDirecto("GEN");
  console.log(`  Total filas actualizadas: ${legacyGen}`);

  console.log("\nCaso 2 -- placeholder legacy directo (OPT):");
  const legacyOpt = await backfillPlaceholderLegacyDirecto("OPT");
  console.log(`  Total filas actualizadas: ${legacyOpt}`);

  console.log(
    `\nTotal general: ${realGen + realOpt + legacyGen + legacyOpt} filas de historial_curso actualizadas.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Reversión manual si algo sale mal:
//   UPDATE historial_curso SET id_slot_malla = NULL WHERE id_slot_malla IS NOT NULL;
