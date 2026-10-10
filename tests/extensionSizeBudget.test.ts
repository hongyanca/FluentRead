import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {checkExtensionSize} from '../scripts/testing/extension-size-budget';
describe('extension package size gate', () => {
    it('measures nested build assets and fails immediately when the real package exceeds its budget', async () => {
        const root=await mkdtemp(join(tmpdir(),'fluentread-size-gate-'));
        try {
            await mkdir(join(root,'assets'));
            await writeFile(join(root,'manifest.json'),'{}');
            await writeFile(join(root,'assets/model.wasm'),new Uint8Array(10));
            await expect(checkExtensionSize(root,12)).resolves.toBe(12);
            await expect(checkExtensionSize(root,11)).rejects.toThrow('超出预算');
        } finally {await rm(root,{recursive:true,force:true});}
    });
});
