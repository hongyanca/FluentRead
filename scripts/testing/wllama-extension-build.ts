/** Package wllama's generated worker as a static MV3 asset. No runtime code evaluation. */
import ts from 'typescript';
import type {Plugin} from 'vite';

export function prepareWllamaExtensionModule(code: string) {
    const ast = ts.createSourceFile('wllama.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const literals = new Map<string, string>();
    let workerCall: ts.CallExpression | undefined;
    function visit(node: ts.Node): void {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
            && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
            literals.set(node.name.text, node.initializer.text);
        }
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createWorker'
            && node.arguments[0]?.getText(ast) === 'completeCode') workerCall = node;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    const glue = literals.get('WLLAMA_EMSCRIPTEN_CODE');
    const worker = literals.get('LLAMA_CPP_WORKER_CODE');
    const stub = literals.get('JSPI_STUB');
    if (!workerCall || !glue || !worker || !stub || !glue.startsWith('var Module=')) {
        throw new Error('Unsupported wllama build: review static worker packaging before upgrading.');
    }
    const source = `// Generated from @wllama/wllama 3.6.1 (MIT). See third-party notices.
self.addEventListener('message', function bootstrap(event) {
    const RUN_OPTIONS = event.data;
    if (RUN_OPTIONS.nbThread > 1 || RUN_OPTIONS.compat) throw new Error('Unsupported extension worker mode');
    if (RUN_OPTIONS.noWebGPU) Object.defineProperty(WorkerNavigator.prototype, 'gpu', {get: () => ({requestAdapter: async () => null})});
    function wModuleInit() { ${stub + glue.replace('var Module', 'var ___Module')}; return Module; }
    ${worker}
}, {once: true});
`;
    const replacement = `(() => {
        const worker = new Worker(new URL('fluent-read-ai/wllama.worker.js', self.location.href), {type: 'module'});
        worker.postMessage({...runOptions, noWebGPU: this.resources.noWebGPU});
        return worker;
    })()`;
    return {source, code: code.slice(0, workerCall.getStart(ast)) + replacement + code.slice(workerCall.end)};
}

export function wllamaExtensionWorker(): Plugin {
    return {
        name: 'wllama-static-extension-worker',
        enforce: 'pre',
        transform(code, id) {
            if (!id.replaceAll('\\', '/').endsWith('/@wllama/wllama/esm/index.js')) return;
            const result = prepareWllamaExtensionModule(code);
            this.emitFile({type: 'asset', fileName: 'fluent-read-ai/wllama.worker.js', source: result.source});
            return {code: result.code, map: null};
        },
    };
}
