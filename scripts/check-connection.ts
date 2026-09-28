import { config as dotenv } from 'dotenv';
import { loadConfig } from '../src/config.js';
import { HiggsfieldClient } from '../src/higgsfield/client.js';
import { IMAGE_MODEL } from '../src/higgsfield/models.js';
import { safeError } from '../src/higgsfield/errors.js';
dotenv({ quiet: true });
try {
  const config = loadConfig();
  const client = new HiggsfieldClient({ credentials: config.HF_CREDENTIALS });
  const estimate = await client.estimateCost(IMAGE_MODEL, { prompt: 'An editorial portrait in soft daylight' });
  console.log(JSON.stringify({ connected: true, model: IMAGE_MODEL, estimate, generation_submitted: false }, null, 2));
} catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
