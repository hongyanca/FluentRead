import process from 'node:process';

import {
    acquireLock,
    createResourceOptions,
    hasInheritedLock,
    releaseLock,
} from './run-resource-safe.mjs';

export default async function setup() {
    if (await hasInheritedLock()) return undefined;

    await acquireLock(createResourceOptions('vitest', process.argv.slice(1)));
    return async () => {
        await releaseLock();
    };
}
