import { z } from 'zod';

export const matrixEnvSchema = z.object({
  MATRIX_HOMESERVER_URL: z.string().min(1).url(),
  MATRIX_ACCESS_TOKEN: z.string().min(1),
  MATRIX_USER_ID: z.string().min(1).regex(/^@.+:.+$/),
  MATRIX_ROOM_IDS: z.string().optional(),
  MATRIX_ENCRYPTION_ENABLED: z.boolean().optional().default(false),
});

export type MatrixEnvironment = z.infer<typeof matrixEnvSchema>;

export function validateMatrixConfig(env: Record<string, unknown>): MatrixEnvironment {
  try {
    return matrixEnvSchema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ');
      throw new Error(`Matrix configuration validation failed: ${issues}`);
    }
    throw error;
  }
}