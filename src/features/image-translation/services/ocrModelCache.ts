/**
 * @file src/features/image-translation/services/ocrModelCache.ts
 * 文件职责：读写 Tesseract.js 浏览器缓存中指定的 OCR 语言包，供带进度的预下载和语言包清除共用。
 * 主要内容：按当前引擎 idb-keyval 的数据库、对象仓库和 cachePath 精确查询、写入或删除 traineddata，等待事务提交后返回；缓存仓库不存在时查询为空、写入与删除不做任何事。
 * 模块边界：只操作明确指定的模型键，不清空数据库、不修改下载记录、不联网；Worker 释放与配置记录由调用层协调。
 */
const DATABASE_NAME = 'keyval-store';
const STORE_NAME = 'keyval';

function modelKey(language: string): string {
    return `fluent-read-image-ocr/${language}.traineddata`;
}

function withModelStore(mode: IDBTransactionMode, failure: string, operate: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) { database.close(); resolve(); return; }
            const transaction = database.transaction(STORE_NAME, mode);
            transaction.oncomplete = () => { database.close(); resolve(); };
            transaction.onabort = () => { database.close(); reject(transaction.error || new Error(failure)); };
            operate(transaction.objectStore(STORE_NAME));
        };
    });
}

export function removeOcrModelFiles(languages: readonly string[]): Promise<void> {
    return withModelStore('readwrite', '语言包清除失败', (store) => {
        for (const language of languages) store.delete(modelKey(language));
    });
}

/** 只统计键是否存在，不把几 MB 的模型数据读进内存。 */
export async function listCachedOcrModelFiles(languages: readonly string[]): Promise<string[]> {
    const cached: string[] = [];
    await withModelStore('readonly', '语言包读取失败', (store) => {
        for (const language of languages) {
            const count = store.count(modelKey(language));
            count.onsuccess = () => { if (count.result > 0) cached.push(language); };
        }
    });
    return cached;
}

/** 写入已解压的 traineddata，与 Tesseract.js 自己下载后缓存的内容一致。 */
export function writeOcrModelFile(language: string, data: Uint8Array): Promise<void> {
    return withModelStore('readwrite', '语言包写入失败', (store) => { store.put(data, modelKey(language)); });
}
