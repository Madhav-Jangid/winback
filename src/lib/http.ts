import { NextResponse, type NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';

/** Largest JSON body accepted by mutating routes (PRD: limit request body sizes). */
export const MAX_JSON_BYTES = 32 * 1024;

export function errorJson(code: string, message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** Parse a JSON body with a size limit. Throws AppError on oversized or malformed input. */
export async function readJson(req: NextRequest): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_JSON_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
}

/** Like readJson, but an empty body is treated as `{}` (for actions with optional options). */
export async function readOptionalJson(req: NextRequest): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_JSON_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
  const text = await req.text();
  if (!text.trim()) return {};
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
}

/**
 * Expected failures keep their code and status; anything else is logged without details and
 * reported as a recoverable database/service error. Never returns stack traces or raw errors.
 */
export function errorResponse(error: unknown, context: string) {
  if (error instanceof AppError) return errorJson(error.code, error.message, error.status, error.details);
  console.error(`[${context}]`, error instanceof Error ? error.message : error);
  return errorJson('DATABASE_ERROR', 'The request could not be completed. Check the database connection and try again.', 503);
}
