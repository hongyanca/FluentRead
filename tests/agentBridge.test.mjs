import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {generateText} from 'ai';
import {agentProfile, createBridge, parseChatRequest} from '../scripts/agent-bridge/bridge.mjs';

const fixture = fileURLToPath(new URL('./fixtures/mockAcpAgent.mjs', import.meta.url));
const token = 'fixture-agent-token-with-more-than-32-chars';
let bridge;
let url;
let launchedArgs;

before(async () => {
  bridge = await createBridge({agent: 'copilot', port: 0, token,
    spawnProcess: (_command, args, options) => {
      launchedArgs = args;
      return spawn(process.execPath, [fixture], options);
    }});
  url = `http://127.0.0.1:${bridge.port}/v1/chat/completions`;
});
after(async () => { await bridge?.close(); });

function post(body, headers = {}) {
  return fetch(url, {method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers,
  }, body: JSON.stringify(body)});
}

test('ACP bridge returns OpenAI-compatible text, isolates sessions, and selects requested model', async () => {
  const first = await post({model: 'default', messages: [
    {role: 'system', content: 'Translate to Chinese.'},
    {role: 'user', content: 'Hello'},
  ]});
  assert.equal(first.status, 200);
  assert.equal((await first.json()).choices[0].message.content, '译文(default)');
  assert.ok(launchedArgs.includes('--available-tools='));
  assert.ok(launchedArgs.some((value) => value.startsWith('--deny-tool=')));
  const second = await post({model: 'fixture-model', messages: [{role: 'user', content: 'Hello again'}]});
  assert.equal(second.status, 200);
  assert.equal((await second.json()).choices[0].message.content, '译文(fixture-model)');
});

test('OpenCode profile overrides tool permissions in a dedicated translation agent', () => {
  const profile = agentProfile('opencode', {OPENCODE_CONFIG_CONTENT: JSON.stringify({
    permission: {'*': 'allow'}, default_agent: 'build',
  })});
  const config = JSON.parse(profile.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.default_agent, 'fluentread_translate');
  assert.equal(config.permission['*'], 'deny');
  assert.equal(config.agent.fluentread_translate.permission['*'], 'deny');
  assert.equal(config.agents.fluentread_translate.permissions[0].effect, 'deny');
});

test('the existing OpenAI-compatible SDK can consume the bridge response', async () => {
  const provider = createOpenAICompatible({
    name: 'fluentread-agent-test', baseURL: `http://127.0.0.1:${bridge.port}/v1`, apiKey: token,
  });
  const result = await generateText({model: provider('default'), prompt: 'Hello', maxRetries: 0});
  assert.equal(result.text, '译文(default)');
});

test('ACP bridge denies requested permissions', async () => {
  const response = await post({model: 'default', messages: [{role: 'user', content: 'request-permission'}]});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, '权限已拒绝');
});

test('ACP bridge rejects unauthorized origins and calls', async () => {
  const body = {model: 'default', messages: [{role: 'user', content: 'Hello'}]};
  const badToken = await post(body, {authorization: 'Bearer wrong'});
  assert.equal(badToken.status, 401);
  const website = await post(body, {origin: 'https://example.com'});
  assert.equal(website.status, 403);
  const extension = await post(body, {origin: 'chrome-extension://test-extension'});
  assert.equal(extension.status, 200);
  assert.equal(extension.headers.get('access-control-allow-origin'), 'chrome-extension://test-extension');
});

test('ACP bridge rejects unsupported content and unavailable models before using another model', async () => {
  assert.throws(() => parseChatRequest({model: 'default', messages: [
    {role: 'user', content: [{type: 'image_url', image_url: {url: 'data:image/png;base64,a'}}]},
  ]}), /文本/);
  const response = await post({model: 'missing-model', messages: [{role: 'user', content: 'Hello'}]});
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'model_unavailable');
});

test('ACP bridge stops if an agent attempts a tool call', async () => {
  const response = await post({model: 'default', messages: [{role: 'user', content: 'tool-call'}]});
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'tool_call_blocked');
  const afterBlocked = await post({model: 'default', messages: [{role: 'user', content: 'Hello'}]});
  assert.equal(afterBlocked.status, 200);
});
