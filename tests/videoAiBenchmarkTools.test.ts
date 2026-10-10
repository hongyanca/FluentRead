/**
 * @file tests/videoAiBenchmarkTools.test.ts
 * 文件职责：验证真实字幕质量驱动的测试工具边界，不需要浏览器或公开模型下载。
 * 主要内容：重放自产夹具的流式 HTTP、长度/SHA、扩展 Origin/token、取消清理以及显式/自动计分隔离。
 * 模块边界：只调用 scripts/testing 工具的公开导出，在本任务临时目录创建小夹具，不把工具验证称为真实 ASR 验收。
 */
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const {runBenchmarkSmoke} = require('../scripts/testing/video-ai-benchmark-smoke.cjs') as {
    runBenchmarkSmoke: () => Promise<{success: boolean; checks: string[]; maxEvaluateArgumentBytes: number; transferredBytes: number}>;
};
const {knownModelFile, modelFileMaxBytes, modelSourceIdentity, loadVerifiedModelCache, exportModelCache} = require('../scripts/testing/model-cache-transfer.cjs') as {
    knownModelFile: (url: string) => {model: string; name: string} | null;
    modelFileMaxBytes: (url: string) => number;
    modelSourceIdentity: (entry: Record<string, unknown>) => {model: string; name: string};
    loadVerifiedModelCache: (directory: string) => Promise<unknown>;
    exportModelCache: (control: unknown, options: Record<string, unknown>) => Promise<unknown>;
};

const {modelResultMetadata} = require('../scripts/testing/video-ai-corpus.cjs') as {
    modelResultMetadata: (model: string, result?: Record<string, unknown>) => Record<string, unknown>;
};
const smallScope = 'https://modelscope.cn/models/onnx-community/whisper-small/resolve/master/';
const canonicalSmall = (name: string) => ({
    url: smallScope + name, file: 'small/' + name,
    sourceModelId: 'onnx-community/whisper-small', actualModelId: 'onnx-community/whisper-small',
    sourceUrl: smallScope + name, sourceRevision: 'master',
});

describe('video AI benchmark tools', () => {
    it('streams local registered bytes, cleans canceled transfers and separates language cases', async () => {
        const report = await runBenchmarkSmoke();
        expect(report.success).toBe(true);
        expect(report.checks).toHaveLength(17);
        expect(report.maxEvaluateArgumentBytes).toBeLessThan(2000);
        expect(report.transferredBytes).toBeGreaterThan(8 * 1024 * 1024);
    }, 30000);

    it('allows only registered public model revisions and files', () => {
        expect(knownModelFile('https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/onnx/encoder_model_q4.onnx'))
            .toEqual({model: 'base', name: 'onnx/encoder_model_q4.onnx'});
        expect(knownModelFile('https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/onnx/encoder_model.onnx'))
            .toEqual({model: 'base', name: 'onnx/encoder_model.onnx'});
        expect(knownModelFile(smallScope + 'onnx/encoder_model.onnx'))
            .toEqual({model: 'small', name: 'onnx/encoder_model.onnx'});
        for (const url of [
            'https://evil.invalid/models/onnx-community/whisper-base/resolve/master/config.json',
            'https://modelscope.cn/models/onnx-community/whisper-base/resolve/other/config.json',
            'https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/../../secret',
            'https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/config.json?token=private',
            'https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/onnx/arbitrary.onnx',
        ]) expect(knownModelFile(url)).toBeNull();
    });

    it('bounds only canonical Small FP32 encoder at 384MiB and rejects alias/source drift', () => {
        expect(modelFileMaxBytes(smallScope + 'onnx/encoder_model.onnx')).toBe(384 * 1024 * 1024);
        expect(modelFileMaxBytes(smallScope + 'onnx/decoder_model_merged_q4.onnx')).toBe(256 * 1024 * 1024);
        expect(modelFileMaxBytes(smallScope + 'onnx/encoder_model_q4.onnx')).toBe(256 * 1024 * 1024);
        expect(modelFileMaxBytes('https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/onnx/encoder_model.onnx')).toBe(256 * 1024 * 1024);
        expect(modelFileMaxBytes(smallScope + 'onnx/arbitrary.onnx')).toBe(0);
        expect(modelSourceIdentity(canonicalSmall('onnx/encoder_model.onnx')).model).toBe('small');
        expect(modelSourceIdentity({...canonicalSmall('config.json'), sourceUrl: 'https://huggingface.co/onnx-community/whisper-small/resolve/' + 'a'.repeat(40) + '/config.json', sourceRevision: 'a'.repeat(40)}).model).toBe('small');
        for (const change of [
            {actualModelId: 'onnx-community/whisper-base'},
            {controllerModelAlias: 'base'},
            {sourceModelId: 'onnx-community/whisper-base'},
            {sourceUrl: 'https://huggingface.co/onnx-community/whisper-base/resolve/master/config.json'},
            {sourceUrl: smallScope + 'generation_config.json'},
            {sourceRevision: 'b'.repeat(40)},
            {sourceUrl: undefined},
        ]) expect(() => modelSourceIdentity({...canonicalSmall('config.json'), ...change})).toThrow();
    });

    it('rejects oversized registered files and actual Base config under a Small scope', async () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-small-tool-bound-'));
        try {
            const manifest = path.join(temporary, 'manifest.json');
            fs.writeFileSync(manifest, JSON.stringify({entries: [{...canonicalSmall('onnx/encoder_model.onnx'), bytes: 384 * 1024 * 1024 + 1, sha256: 'a'.repeat(64)}]}));
            await expect(loadVerifiedModelCache(temporary)).rejects.toThrow('Invalid model byte length');
            const body = Buffer.from(JSON.stringify({model_type: 'whisper', d_model: 512, encoder_layers: 6, decoder_layers: 6}));
            fs.mkdirSync(path.join(temporary, 'small'));
            fs.writeFileSync(path.join(temporary, 'small/config.json'), body);
            fs.writeFileSync(manifest, JSON.stringify({entries: [{...canonicalSmall('config.json'), bytes: body.length, sha256: createHash('sha256').update(body).digest('hex')}]}));
            await expect(loadVerifiedModelCache(temporary)).rejects.toThrow('actual Small config');
        } finally {fs.rmSync(temporary, {recursive: true, force: true});}
    });

    it('reports actual module precision without inferring fp32 from the old q4 field', () => {
        expect(modelResultMetadata('small', {model: 'small', dtype: 'q4'})).toMatchObject({
            actualModelId: 'onnx-community/whisper-small', encoderDtype: null, decoderDtype: null, precisionReportedComplete: false,
        });
        expect(modelResultMetadata('small', {model: 'small', dtype: 'q4', encoderDtype: 'fp32', decoderDtype: 'q4'})).toMatchObject({
            actualModelId: 'onnx-community/whisper-small', encoderDtype: 'fp32', decoderDtype: 'q4', precisionReportedComplete: true,
        });
        expect(modelResultMetadata('small', {model: 'base', dtype: 'q4'}).actualModelId).toBeNull();
        expect(modelResultMetadata('base', {model: 'base', dtype: 'q8', encoderDtype: 'q8', decoderDtype: 'q8'})).toMatchObject({encoderDtype: 'q8', decoderDtype: 'q8'});
    });

    it('cancels cached export reads on oversized headers and during a pending body read', async () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-small-export-read-'));
        const origin = 'chrome-extension://' + 'a'.repeat(32), url = smallScope + 'onnx/encoder_model.onnx';
        try {
            for (const mode of ['oversized-header', 'pending-read']) {
                let cancelled = 0, networkRequests = 0;
                const response = new Response(new ReadableStream({
                    pull() {return new Promise<void>(() => {});},
                    cancel() {cancelled++;},
                }), {headers: mode === 'oversized-header' ? {'Content-Length': String(384 * 1024 * 1024 + 1)} : {}});
                const control = {
                    url: () => origin + '/popup.html',
                    evaluate: (fn: (...args: unknown[]) => unknown, input: unknown) => vm.runInNewContext('(' + fn.toString() + ')(input)', {
                        input, Response, ReadableStream, AbortController, setTimeout, clearTimeout,
                        fetch: (...args: Parameters<typeof fetch>) => {networkRequests++; return fetch(...args);},
                        caches: {open: async () => ({keys: async () => [{url}], match: async () => response})},
                    }),
                };
                const start = Date.now();
                await expect(exportModelCache(control, {directory: temporary, models: ['small'], fileTimeoutMs: 20}))
                    .rejects.toThrow(mode === 'oversized-header' ? 'registered byte bound' : 'export timed out');
                expect(cancelled).toBe(1);
                expect(networkRequests).toBe(0);
                expect(Date.now() - start).toBeLessThan(2000);
                expect(fs.readdirSync(temporary)).toEqual([]);
            }
        } finally {fs.rmSync(temporary, {recursive: true, force: true});}
    });

    it('keeps CLI defaults at Tiny/Base and plans explicit Small without a browser', () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-small-cli-plan-'));
        try {
            const pcm = Buffer.alloc(32000), audio = path.join(temporary, 'speech.pcm16le');
            fs.writeFileSync(audio, pcm);
            const manifest = path.join(temporary, 'corpus.json');
            fs.writeFileSync(manifest, JSON.stringify({samples: [{id: 'unit-english', file: 'speech.pcm16le', format: 'pcm16le', reference: 'hello', language: 'en', durationMs: 1000, sha256: createHash('sha256').update(pcm).digest('hex'), source: {kind: 'hermetic-test', license: 'self-created'}}]}));
            for (const models of [undefined, 'small']) {
                const output = path.join(temporary, models || 'default');
                const script = path.resolve(__dirname, '../scripts/run-video-ai-recognition-benchmark.cjs');
                const args = [script, '--validate-only', '--corpus-manifest', manifest, '--artifacts-dir', output, ...(models ? ['--models', models] : [])];
                const result = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 10000});
                expect(result.status, result.stderr).toBe(0);
                const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
                expect(report.browserLaunched).toBe(false);
                expect(report.allCasesSucceeded).toBeNull();
                expect(report.scope).toContain('no browser or ASR executed');
                expect(report.models).toEqual(models ? ['small'] : ['tiny', 'base']);
                expect(report.casePlan).toHaveLength(models ? 2 : 4);
                expect(new Set(report.casePlan.map((entry: {model: string}) => entry.model))).toEqual(new Set(models ? ['small'] : ['tiny', 'base']));
            }
        } finally {fs.rmSync(temporary, {recursive: true, force: true});}
    });
});
