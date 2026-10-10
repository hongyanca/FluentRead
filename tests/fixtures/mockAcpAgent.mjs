import readline from 'node:readline';

const lines = readline.createInterface({input: process.stdin});
let count = 0;
let selectedModel = 'default';
let pendingPermission = null;
function send(message) { process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`); }

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === 999 && pendingPermission) {
    const permitted = message.result?.outcome?.outcome !== 'cancelled';
    send({method: 'session/update', params: {
      sessionId: pendingPermission.sessionId,
      update: {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: permitted ? '权限错误' : '权限已拒绝'}},
    }});
    send({id: pendingPermission.promptId, result: {stopReason: 'end_turn'}});
    pendingPermission = null;
    continue;
  }
  if (message.method === 'initialize') {
    send({id: message.id, result: {protocolVersion: 1, agentCapabilities: {sessionCapabilities: {close: {}, delete: {}}}}});
  } else if (message.method === 'session/new') {
    selectedModel = 'default';
    send({id: message.id, result: {
      sessionId: `fixture-${++count}`,
      configOptions: [{id: 'model', category: 'model', currentValue: 'default',
        options: [{value: 'default'}, {value: 'fixture-model'}]}],
    }});
  } else if (message.method === 'session/set_config_option') {
    selectedModel = message.params.value;
    send({id: message.id, result: {configOptions: []}});
  } else if (message.method === 'session/prompt') {
    const prompt = message.params.prompt[0].text;
    if (prompt.includes('request-permission')) {
      pendingPermission = {sessionId: message.params.sessionId, promptId: message.id};
      send({id: 999, method: 'session/request_permission', params: {
        sessionId: pendingPermission.sessionId, toolCall: {title: 'Read file'}, options: [],
      }});
      // The real prompt response ID is returned only after the client's answer.
      continue;
    }
    if (prompt.includes('tool-call')) {
      send({method: 'session/update', params: {
        sessionId: message.params.sessionId,
        update: {sessionUpdate: 'tool_call', toolCallId: '1', title: 'Forbidden'},
      }});
      continue;
    }
    send({method: 'session/update', params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: `译文(${selectedModel})`}},
    }});
    send({id: message.id, result: {stopReason: 'end_turn'}});
  } else if (message.method === 'session/close' || message.method === 'session/delete') {
    send({id: message.id, result: {}});
  }
}
