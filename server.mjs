import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {createLocalServer} from './desktop/static-server.cjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 4317);
createLocalServer(root).listen(port,'127.0.0.1',()=>console.log(`ORBIT DJ ready at http://127.0.0.1:${port}`));
