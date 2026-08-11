import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { WsPhotopeaBridge } from '../dist/src/photopea/bridge-server.js';

test('real WebSocket bridge correlates commands and results', async () => {
  const bridge = new WsPhotopeaBridge(500);
  await bridge.start();
  const client = new WebSocket(bridge.url.replace(/^http:/, 'ws:'));

  try {
    await new Promise((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'status', status: 'ready' }));
    await bridge.waitForReady();

    client.once('message', (raw) => {
      const command = JSON.parse(raw.toString());
      assert.equal(command.type, 'execute');
      assert.equal(command.script, "app.echoToOE('ok');");
      client.send(JSON.stringify({
        type: 'result',
        id: command.id,
        success: true,
        data: 'ok',
        error: null,
      }));
    });

    const result = await bridge.executeScript("app.echoToOE('ok');");
    assert.deepEqual(result, { success: true, data: 'ok', error: null });
  } finally {
    client.terminate();
    await Promise.race([
      bridge.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Bridge close timed out after 500ms')), 500)),
    ]);
  }
});
