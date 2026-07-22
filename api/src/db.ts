import { PrismaClient } from "@prisma/client";

// Instancia única compartida por toda la aplicación.
// Evita abrir una conexión nueva a PostgreSQL por cada archivo que
// necesite hacer una query.
//
// DEUDA TÉCNICA (detectada en despliegue a Railway, sin resolver aún):
// estudiante.service.ts y auth.service.ts instancian su propio
// `new PrismaClient()` en vez de importar `prisma` desde acá, así que
// hoy hay 3 pools de conexión abiertos en paralelo en vez de 1.
export const prisma = new PrismaClient();