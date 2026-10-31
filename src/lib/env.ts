import { z } from 'zod';

const serverEnvSchema = z.object({
  DATABASE_URL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z
      .string()
      .url('DATABASE_URL must be a valid PostgreSQL connection URL')
      .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
        message: 'DATABASE_URL must use the postgres:// or postgresql:// protocol',
      })
      .optional(),
  ),
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).default('Winback AI'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().regex(/^[a-z0-9][a-z0-9.-]{1,60}$/, 'GEMINI_MODEL must be a model id such as gemini-3.5-flash-lite').optional(),
  ),
  SARVAM_API_KEY: z.string().optional(),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
  DEMO_SEED: z.string().trim().min(1).default('winback-demo-v1'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parse environment values explicitly so validation can be tested without mutating process.env. */
export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}

/** Read validated server-only configuration. Never call this from a Client Component. */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
