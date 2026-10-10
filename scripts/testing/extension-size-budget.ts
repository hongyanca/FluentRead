import {readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';

/** 按实际磁盘产物执行体积门禁；源码映射调试模式显式使用单独预算。 */
export async function checkExtensionSize(directory: string, maxBytes: number): Promise<number> {
    let bytes = 0;
    async function walk(current: string): Promise<void> {
        for (const entry of await readdir(current, {withFileTypes: true})) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile()) bytes += (await stat(path)).size;
        }
    }
    await walk(directory);
    if (bytes > maxBytes) throw new Error(`扩展体积超出预算：${(bytes / 1_000_000).toFixed(2)} MB > ${(maxBytes / 1_000_000).toFixed(2)} MB；请运行 pnpm analyze:bundle ${directory} 定位新增大资源。`);
    return bytes;
}
