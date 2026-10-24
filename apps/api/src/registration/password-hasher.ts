import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { argon2id, hash } from 'argon2';

@Injectable()
export class PasswordHasher {
  private active = 0;

  async hash(password: string): Promise<string> {
    // Bound work rather than retaining an unbounded queue of plaintext passwords.
    if (this.active >= 2) throw this.unavailable();
    this.active += 1;
    try {
      return await hash(password, {
        type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32,
      });
    } catch {
      throw this.unavailable();
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
