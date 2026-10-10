import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        service: 'claude',
        to: 'zh-Hans',
        token: {claude: 'claude-secret'} as Record<string, string>,
        model: {claude: 'claude-haiku-4-5'} as Record<string, string>,
        customModel: {} as Record<string, string>,
        modelThinking: {claude: {'claude-haiku-4-5': true}} as Record<string, Record<string, boolean>>,
        customBody: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        system_role: {claude: 'You are a translator.'} as Record<string, string>,
        user_role: {claude: 'Translate to {{to}}: {{origin}}'} as Record<string, string>,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import claude from '@/src/providers/translation/claude';

const fetchMock = vi.fn<typeof fetch>();

function response(content: unknown): Response {
    return new Response(JSON.stringify({
        model: 'claude-haiku-4-5',
        content,
        usage: {input_tokens: 2, output_tokens: 3},
    }), {status: 200, headers: {'content-type': 'application/json'}});
}

describe('Claude Thinking 响应', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        mockConfig.modelThinking = {claude: {'claude-haiku-4-5': true}};
        mockConfig.customBody = {};
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('忽略思考块并拼接所有最终文本块', async () => {
        fetchMock.mockResolvedValue(response([
            {type: 'thinking', thinking: 'private reasoning'},
            {type: 'text', text: '译文'},
            {text: '结束'},
        ]));

        await expect(claude({origin: 'hello'})).resolves.toBe('译文结束');
        const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(request.thinking).toEqual({type: 'enabled', budget_tokens: 1024});
    });

    it('没有最终文本块时返回明确错误', async () => {
        fetchMock.mockResolvedValue(response([{type: 'thinking', thinking: 'private reasoning'}]));

        await expect(claude({origin: 'hello'})).rejects.toThrow('Claude 返回数据格式异常：缺少文本内容');
    });
});
