import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { DUMMY_PASSWORD_HASH, PasswordHasher } from '../registration/password-hasher.js';
import { parseRegistrationInput } from '../registration/registration-input.js';
import { RegistrationLimiter } from '../registration/registration-limiter.js';
import { authUnavailable, invalidCredentials, LoginRateLimitException } from './auth-errors.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthService {
  private readonly accounts = new RegistrationLimiter({ perAddressLimit: 5 });

  constructor(private readonly database: PrismaService, private readonly passwords: PasswordHasher,
    private readonly sessions: SessionService) {}

  async login(value: unknown, previousToken?: string) {
    let input: ReturnType<typeof parseRegistrationInput>;
    try {
      input = parseRegistrationInput(value);
    } catch (error) {
      if (error instanceof BadRequestException) throw invalidCredentials();
      throw error;
    }
    const normalizedUsername = input.username.toLowerCase();
    const retry = this.accounts.consume(normalizedUsername);
    if (retry !== undefined) throw new LoginRateLimitException(retry);
    let user;
    try {
      user = await this.database.user.findUnique({
        where: { normalizedUsername }, select: { id: true, username: true, role: true, passwordHash: true },
      });
    } catch {
      throw authUnavailable();
    }
    const matches = await this.passwords.verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);
    if (!user || !matches) throw invalidCredentials();
    return this.sessions.create({ id: user.id, username: user.username, role: user.role }, previousToken);
  }
}
