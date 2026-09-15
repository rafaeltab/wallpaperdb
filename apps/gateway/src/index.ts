import { config as loadEnv } from 'dotenv';
import { loadConfig } from './config.js';
import { initializeOtel } from './otel-init.js';

loadEnv();
const config = loadConfig();
const sdk = initializeOtel(config);
const { startGateway } = await import('./server.js');
await startGateway(config, sdk);
