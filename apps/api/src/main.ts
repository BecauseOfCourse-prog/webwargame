import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfiguration } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const configuration = loadConfiguration();
  const app = await NestFactory.create(AppModule.register(configuration), { abortOnError: false });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  try {
    await app.listen(configuration.apiPort, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Failed to start the API.');
  process.exitCode = 1;
});
