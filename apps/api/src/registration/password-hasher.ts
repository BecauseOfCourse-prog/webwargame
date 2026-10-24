import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { authUnavailable } from '../auth/auth-errors.js';

// Valid, non-account hash with the same parameters as new registrations. Unknown
// users still perform a real verification; a matching dummy password cannot log in.
export const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$Of535KsuaCGmUcTePlnRlw$GSh8T1XMwzTYHU8+pGuQeImX0bcfd8xssdJDZHklYkA';

@Injectable()
export class PasswordHasher {
  private active = 0;

  async hash(password: string): Promise<string> {
    return this.run(() => hash(password, {
      type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32,
    }), () => this.unavailable());
  }

  async verify(encodedHash: string, password: string): Promise<boolean> {
    return this.run(() => verify(encodedHash, password), authUnavailable);
  }

  private async run<T>(operation: () => Promise<T>, unavailable: () => ServiceUnavailableException): Promise<T> {
    // Bound work rather than retaining an unbounded queue of plaintext passwords.
    if (this.active >= 2) throw unavailable();
    this.active += 1;
    try {
      return await operation();
    } catch {
      throw unavailable();
    } finally {
      this.active -= 1;
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'REGISTRATION_UNAVAILABLE', message: 'Registration is temporarily unavailable. Try again shortly.',
    });
  }
}
