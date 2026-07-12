import { prisma } from "../db";

/**
 * Nodo del árbol de prerrequisitos. Cada curso requerido puede a su vez
 * tener sus propios prerrequisitos (recursión), ya que se asume AND
 * simple: para llevar un curso hay que haber aprobado TODOS los cursos
 * en `requires` (validado contra la malla real de ISI/ITECAD/TOPO --
 * no existen prerrequisitos alternativos tipo OR).
 */
export interface PrerequisiteNode {
  code: string;
  name: string;
  credits: number;
  requires: PrerequisiteNode[];
}

/**
 * Construye recursivamente el árbol de prerrequisitos de un curso.
 *
 * @param courseCode  código del curso raíz (ej. "EIF207")
 * @param visited     códigos ya visitados en la rama actual, para
 *                    cortar la recursión si se detecta un ciclo. Sprint 3
 *                    ya validó que la malla real no tiene ciclos, pero
 *                    esta protección se mantiene por seguridad ante
 *                    datos futuros o corridas del ETL con errores.
 * @returns el árbol de prerrequisitos, o null si el curso no existe.
 */
async function buildPrerequisiteTree(
  courseCode: string,
  visited: Set<string> = new Set()
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
    };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(course.codigo);

  const requiredNodes: PrerequisiteNode[] = [];
  for (const link of course.requisitosDe) {
    const childNode = await buildPrerequisiteTree(
      link.cursoRequerido.codigo,
      nextVisited
    );
    if (childNode) {
      requiredNodes.push(childNode);
    }
  }

  return {
    code: course.codigo,
    name: course.nombre,
    credits: Number(course.creditos),
    requires: requiredNodes,
  };
}

/**
 * Devuelve el árbol de prerrequisitos de un curso por su código.
 * Corresponde a GET /api/prerrequisitos/{curso}.
 * Devuelve null si el curso no existe -- la ruta decide el status HTTP.
 */
export async function getPrerequisiteTree(courseCode: string) {
  return buildPrerequisiteTree(courseCode);
}