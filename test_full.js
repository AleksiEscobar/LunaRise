const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');

const SERVER_CMD = 'node';
const SERVER_ARGS = ['index.js'];
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const WAIT_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;

const waitForServer = async () => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await axios.get(`${BASE_URL}/status`, { timeout: 2000 });
      if (res.status === 200 && res.data && res.data.status === 'running') {
        return;
      }
    } catch (error) {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Servidor no respondió en ${WAIT_TIMEOUT_MS}ms`);
};

const runTests = () => {
  return new Promise((resolve, reject) => {
    const testProcess = spawn(process.execPath, [path.resolve(__dirname, 'test_api.js')], {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env,
    });

    testProcess.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`test_api.js finalizó con código ${code}`));
      }
    });

    testProcess.on('error', (error) => {
      reject(error);
    });
  });
};

const main = async () => {
  console.log('Arrancando servidor local...');
  const serverProcess = spawn(SERVER_CMD, SERVER_ARGS, {
    cwd: __dirname,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });

  const cleanup = () => {
    if (!serverProcess.killed) {
      serverProcess.kill();
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  try {
    await waitForServer();
    console.log('Servidor disponible, ejecutando pruebas...');
    await runTests();
    console.log('Pruebas completadas con éxito.');
  } catch (error) {
    console.error('Error durante la prueba completa:', error.message || error);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
};

main().catch((error) => {
  console.error('Error en test_full:', error.message || error);
  process.exit(1);
});