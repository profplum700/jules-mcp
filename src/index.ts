import { createWorker } from './platform/worker.ts';
import { serveMcp } from './mcp/server.ts';
export default createWorker(serveMcp);
