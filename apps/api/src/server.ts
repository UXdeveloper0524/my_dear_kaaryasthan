import app from './app.js';
import { readEnv } from './config/env.js';

const { PORT } = readEnv();
app.listen(PORT, () => {
  process.stdout.write(`API listening on port ${PORT}\n`);
});
