import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(3000, '127.0.0.1');
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start the API.', error);
  process.exitCode = 1;
});
