import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

// Falla rápido al arrancar si falta la variable en vez de firmar tokens
// con "undefined" -- ver .env (JWT_SECRET agregado junto con esta feature).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET no está definido en las variables de entorno");
}

const SALT_ROUNDS = 10;
const TOKEN_EXPIRES_IN = "7d";

/** Payload firmado en el JWT -- carreraSigla evita un JOIN extra en cada request protegido. */
export interface JwtPayload {
  carnet: string;
  carreraSigla: string;
}

export interface EstudianteAutenticado {
  carnet: string;
  nombre: string;
  correo: string;
  cicloActualId: string;
  carrera: {
    idCarrera: number;
    sigla: string;
    nombre: string;
  };
}

export interface SesionIniciada {
  token: string;
  estudiante: EstudianteAutenticado;
}

export class CarnetOCorreoDuplicadoError extends Error {}
export class CarreraNoEncontradaError extends Error {}
export class CredencialesInvalidasError extends Error {}
export class EstudianteNoEncontradoError extends Error {}

function firmarToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: TOKEN_EXPIRES_IN });
}

function aEstudianteAutenticado(estudiante: {
  carnet: string;
  nombre: string;
  correo: string;
  ciclo_actual_id: string;
  carrera: { id_carrera: number; sigla: string; nombre: string };
}): EstudianteAutenticado {
  return {
    carnet: estudiante.carnet,
    nombre: estudiante.nombre,
    correo: estudiante.correo,
    cicloActualId: estudiante.ciclo_actual_id,
    carrera: {
      idCarrera: estudiante.carrera.id_carrera,
      sigla: estudiante.carrera.sigla,
      nombre: estudiante.carrera.nombre,
    },
  };
}

/**
 * Registra un estudiante nuevo. Lanza CarreraNoEncontradaError si la sigla
 * no corresponde a ninguna carrera real, o CarnetOCorreoDuplicadoError si
 * ya existe un estudiante con ese carnet o correo (constraint UNIQUE de
 * la tabla, capturado como P2002 en vez de hacer un SELECT previo --
 * evita una condición de carrera entre el chequeo y el INSERT).
 */
export async function registrar(datos: {
  carnet: string;
  nombre: string;
  correo: string;
  password: string;
  carreraSigla: string;
}): Promise<SesionIniciada> {
  const carrera = await prisma.carrera.findUnique({
    where: { sigla: datos.carreraSigla },
  });
  if (!carrera) {
    throw new CarreraNoEncontradaError(
      `No existe una carrera con sigla "${datos.carreraSigla}"`
    );
  }

  const passwordHash = await bcrypt.hash(datos.password, SALT_ROUNDS);

  let creado;
  try {
    creado = await prisma.estudiante.create({
      data: {
        carnet: datos.carnet,
        nombre: datos.nombre,
        correo: datos.correo,
        password_hash: passwordHash,
        id_carrera: carrera.id_carrera,
      },
      include: { carrera: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CarnetOCorreoDuplicadoError(
        "Ya existe un estudiante registrado con ese carnet o correo"
      );
    }
    throw err;
  }

  const token = firmarToken({ carnet: creado.carnet, carreraSigla: carrera.sigla });
  return { token, estudiante: aEstudianteAutenticado(creado) };
}

/**
 * Verifica carnet + contraseña. Mensaje de error idéntico para "no existe"
 * y "contraseña incorrecta" a propósito -- no darle a un atacante pistas
 * sobre qué carnets están registrados.
 */
export async function login(datos: {
  carnet: string;
  password: string;
}): Promise<SesionIniciada> {
  const estudiante = await prisma.estudiante.findUnique({
    where: { carnet: datos.carnet },
    include: { carrera: true },
  });
  if (!estudiante) {
    throw new CredencialesInvalidasError("Carnet o contraseña incorrectos");
  }

  const passwordValida = await bcrypt.compare(datos.password, estudiante.password_hash);
  if (!passwordValida) {
    throw new CredencialesInvalidasError("Carnet o contraseña incorrectos");
  }

  const token = firmarToken({ carnet: estudiante.carnet, carreraSigla: estudiante.carrera.sigla });
  return { token, estudiante: aEstudianteAutenticado(estudiante) };
}

/** Decodifica y valida la firma/expiración del JWT. Lanza si es inválido. */
export function verificarToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET!) as JwtPayload;
}

/** Usado por GET /api/auth/me para hidratar la sesión desde el token guardado. */
export async function obtenerPorCarnet(carnet: string): Promise<EstudianteAutenticado> {
  const estudiante = await prisma.estudiante.findUnique({
    where: { carnet },
    include: { carrera: true },
  });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }
  return aEstudianteAutenticado(estudiante);
}
