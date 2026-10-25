import './env.js';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.info(`API Halloween 42sp disponível na porta ${port}.`);
});
