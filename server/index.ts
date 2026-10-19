import { openDatabase } from './db.js';
import { buildApp, registerShutdownRoute } from './app.js';
import { createBackup } from './backup.js';
import { networkInterfaces } from 'node:os';

const db = openDatabase();
const app = await buildApp(db);
let shuttingDown = false;
async function stop(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  db.close();
  process.exit(0);
}
registerShutdownRoute(app, db, stop);
const lan = process.env.LEMBRE_LAN === '1';
function homeNetworkHost(): string {
  if (process.env.LEMBRE_HOST) return process.env.LEMBRE_HOST;
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => ({ name, address: entry.address })));
  const physical = addresses.filter(({ name }) => !/vpn|virtual|vEthernet|loopback|tunnel/i.test(name));
  const preferred = physical.find(({ address }) => address.startsWith('192.168.'))
    ?? physical.find(({ address }) => /^10\./.test(address))
    ?? physical.find(({ address }) => /^172\.(1[6-9]|2[0-9]|3[01])\./.test(address));
  if (!preferred) throw new Error('Rede local não encontrada. Defina LEMBRE_HOST com o IPv4 do PC.');
  return preferred.address;
}
const host = lan ? homeNetworkHost() : '127.0.0.1';
const port = Number(process.env.LEMBRE_PORT ?? 4173);

try {
  await app.listen({ host, port });
  app.log.info(lan ? 'Lembre disponível na rede local em ' + host : 'Lembre disponível apenas neste PC.');
  await createBackup(db, 'auto');
  setInterval(() => createBackup(db, 'auto').catch((error) => app.log.error(error)), 60 * 60 * 1000).unref();
} catch (error) {
  app.log.error(error);
  db.close();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stop();
  });
}

