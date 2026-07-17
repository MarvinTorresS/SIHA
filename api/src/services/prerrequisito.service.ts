import { prisma } from "../db";

/**
 * Nodo del árbol de prerrequisitos. Cada curso requerido puede a su vez
 * tener sus propios prerrequisitos (recursión), ya que se asume AND
 * simple: para llevar un curso hay que haber aprobado TODOS los cursos
 * en `requires` (validado contra la malla real de ISI/ITECAD/TOPO --
 * no existen prerrequisitos alternativos tipo OR).
 */
export interface CorequisiteRef {
  code: string;
  name: string;
  credits: number;
}

export interface PrerequisiteNode {
  code: string;
  name: string;
  credits: number;
  requires: PrerequisiteNode[];
  /**
   * true solo cuando este nodo SÍ tiene prerrequisitos reales
   * (course.requisitosDe.length > 0) pero no se expandieron porque se
   * alcanzó el límite de profundidad (?profundidad=directo). false en
   * cualquier otro caso, incluida la recursión completa por defecto (sin
   * corte de profundidad) -- ahí `requires` ya trae todo, no hace falta
   * la señal.
   */
  hasMoreRequirements: boolean;
  /**
   * Correquisitos directos (tipo='correquisito' en la misma tabla
   * prerrequisito) -- cursos que deben llevarse EN SIMULTÁNEO, no antes.
   * Solo se completa en el nodo raíz (el curso consultado): el frontend
   * únicamente resalta corequisitos de la tarjeta activa, nunca de sus
   * prerrequisitos, así que no vale la pena la query extra en cada nivel
   * de la recursión. []  en cualquier nodo que no sea la raíz.
   */
  corequisitos: CorequisiteRef[];
}

/**
 * Construye recursivamente el árbol de prerrequisitos de un curso.
 *
 * @param courseCode   código del curso raíz (ej. "EIF207")
 * @param visited      códigos ya visitados en la rama actual, para
 *                     cortar la recursión si se detecta un ciclo. Sprint 3
 *                     ya validó que la malla real no tiene ciclos, pero
 *                     esta protección se mantiene por seguridad ante
 *                     datos futuros o corridas del ETL con errores.
 * @param maxDepth     profundidad máxima a expandir (1 = solo
 *                     prerrequisitos directos). undefined = sin límite,
 *                     el comportamiento de siempre.
 * @param currentDepth profundidad del nodo actual, para comparar contra
 *                     maxDepth. La raíz es profundidad 0.
 * @returns el árbol de prerrequisitos, o null si el curso no existe.
 */
async function buildPrerequisiteTree(
  courseCode: string,
  visited: Set<string> = new Set(),
  maxDepth?: number,
  currentDepth = 0
): Promise<PrerequisiteNode | null> {
  const course = await prisma.curso.findUnique({
    where: { codigo: courseCode },
    include: {
      requisitosDe: {
        where: { tipo: "prerequisito" },
        include: {
          cursoRequerido: true,
        },
      },
    },
  });

  if (!course) {
    return null;
  }

  // Ciclo detectado: este curso ya aparece en la rama actual.
  // Se corta aquí devolviendo el nodo sin sus propios requisitos,
  // en vez de lanzar un error, para que el resto del árbol siga
  // siendo utilizable.
  if (visited.has(course.codigo)) {
    return {
      code: course.codigo,
      name: course.nombre,
      credits: Number(course.creditos),
      requires: [],
      hasMoreRequirements: false,
      corequisitos: [],
    };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(course.codigo);

  // Corte por profundidad (?profundidad=directo -> maxDepth=1): no se
  // expanden los hijos de este nodo, pero si el curso SÍ tenía
  // prerrequisitos reales, hasMoreRequirements lo señala explícitamente
  // en vez de dejar `requires: []` ambiguo con "no tiene prerrequisitos".
  const alcanzoLimite = maxDepth !== undefined && currentDepth >= maxDepth;

  const requiredNodes: PrerequisiteNode[] = [];
  if (!alcanzoLimite) {
    for (const link of course.requisitosDe) {
      const childNode = await buildPrerequisiteTree(
        link.cursoRequerido.codigo,
        nextVisited,
        maxDepth,
        currentDepth + 1
      );
      if (childNode) {
        requiredNodes.push(childNode);
      }
    }
  }

  return {
    code: course.codigo,
    name: course.nombre,
    credits: Number(course.creditos),
    requires: requiredNodes,
    hasMoreRequirements: alcanzoLimite && course.requisitosDe.length > 0,
    corequisitos: [],
  };
}

/**
 * Correquisitos directos de un curso, buscando en ambas columnas
 * (id_curso = X OR id_curso_requerido = X) -- en los datos reales varios
 * pares están guardados en una sola fila (ej. DEC401 -> LLH409, sin la
 * fila inversa), así que consultar solo por id_curso perdería la
 * relación al pedirla desde LLH409. No se symmetriza (no se inventan
 * filas que no existen): si LLH409 nunca aparece como id_curso NI como
 * id_curso_requerido, simplemente no tiene correquisitos.
 *
 * Deduplicado por código del OTRO curso: un par bidireccional (ej.
 * FIY423 <-> FIY423L) tiene dos filas que matchean el OR (una por cada
 * columna), y ambas resuelven al mismo curso del otro lado -- sin el
 * dedupe, el frontend dibujaría la misma línea dos veces.
 */
async function getDirectCorequisites(courseId: number): Promise<CorequisiteRef[]> {
  const rows = await prisma.prerrequisito.findMany({
    where: {
      tipo: "correquisito",
      OR: [{ id_curso: courseId }, { id_curso_requerido: courseId }],
    },
    include: { curso: true, cursoRequerido: true },
  });

  const porCodigo = new Map<string, CorequisiteRef>();
  for (const row of rows) {
    const otro = row.id_curso === courseId ? row.cursoRequerido : row.curso;
    porCodigo.set(otro.codigo, {
      code: otro.codigo,
      name: otro.nombre,
      credits: Number(otro.creditos),
    });
  }
  return Array.from(porCodigo.values());
}

/**
 * Devuelve el árbol de prerrequisitos de un curso por su código, con los
 * correquisitos directos del curso raíz agregados en `corequisitos`.
 * Corresponde a GET /api/prerrequisitos/{curso}.
 * Devuelve null si el curso no existe -- la ruta decide el status HTTP.
 *
 * @param maxDepth  ver buildPrerequisiteTree. undefined = árbol completo
 *                  (comportamiento por defecto, sin cambios).
 */
export async function getPrerequisiteTree(courseCode: string, maxDepth?: number) {
  const tree = await buildPrerequisiteTree(courseCode, undefined, maxDepth);
  if (!tree) {
    return null;
  }

  const rootCourse = await prisma.curso.findUnique({
    where: { codigo: tree.code },
    select: { id_curso: true },
  });
  if (rootCourse) {
    tree.corequisitos = await getDirectCorequisites(rootCourse.id_curso);
  }

  return tree;
}