import { PrismaClient } from "@prisma/client";

// Instancia única compartida por toda la aplicación.
// Evita abrir una conexión nueva a PostgreSQL por cada archivo que
// necesite hacer una query.
export const prisma = new PrismaClient();