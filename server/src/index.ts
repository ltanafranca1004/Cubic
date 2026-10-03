import { createApp } from './app';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const app = createApp({
  origins: (process.env.CLIENT_ORIGIN ?? '').split(','),
  allowLocalhost: process.env.NODE_ENV !== 'production',
});

const port = await app.listen(Number(process.env.PORT) || 3001);
console.log(`cubic server listening on :${port}`);
