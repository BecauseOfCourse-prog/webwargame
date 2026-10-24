import { BadRequestException } from '@nestjs/common';
import type { RegistrationValidationError } from '@webwargame/contracts';
import { z } from 'zod';

const schema = z.strictObject({
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,32}$/, {
    error: 'Use 3–32 Latin letters, digits, periods, hyphens or underscores.',
  }),
  password: z.string().refine((value) => {
    const length = [...value].length;
    return length >= 15 && length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(value);
  }, 'Use 15–128 characters without control characters; spaces are allowed.'),
});

export function parseRegistrationInput(value: unknown): z.infer<typeof schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fields: RegistrationValidationError['fields'] = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] === 'username' || issue.path[0] === 'password'
      ? issue.path[0] : 'body';
    // Do not echo values, unknown keys or Zod's raw diagnostics to the caller.
    const message = field === 'body' ? 'Provide only username and password.'
      : field === 'username' ? 'Use 3–32 Latin letters, digits, periods, hyphens or underscores.'
        : 'Use 15–128 characters without control characters; spaces are allowed.';
    (fields[field] ??= []).push(message);
  }
  throw new BadRequestException({
    code: 'INVALID_REGISTRATION', message: 'Check the registration fields.', fields,
  } satisfies RegistrationValidationError);
}
