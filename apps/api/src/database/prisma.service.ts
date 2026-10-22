import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { RuntimeConfiguration } from '../config/environment.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configuration: RuntimeConfiguration) {
    super({
      adapter: new PrismaPg({
        connectionString: configuration.databaseUrl,
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
        query_timeout: 5000,
      }),
      log: [],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      await this.checkConnection();
    } catch {
      await this.$disconnect();
      throw new Error('Database connection failed. Check DATABASE_URL and start PostgreSQL.');
    }
  }

  async checkConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
