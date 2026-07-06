import { prisma } from "./src/db";

async function main() {
  const rows: any[] = await prisma.$queryRaw`
    SELECT s.nrc, s.codigo_curso_banner, hb.dia, 
           hb.hora_inicio::text as inicio, hb.hora_fin::text as fin
    FROM seccion s
    JOIN horario_bloque hb ON hb.id_seccion = s.id_seccion
    WHERE s.id_periodo = 3 AND s.metadata->>'banner_program' = 'isi'
    ORDER BY hb.dia, hb.hora_inicio
  `;
  rows.forEach((r: any) => console.log(`${r.nrc} ${r.codigo_curso_banner} ${r.dia} ${r.inicio}-${r.fin}`));
}

main().then(() => prisma.$disconnect());