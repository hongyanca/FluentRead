import {describe, expect, it} from 'vitest';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';

describe('credential storage context', () => {
    it.each([
        'chrome-extension:',
        'moz-extension:',
        'safari-web-extension:',
    ])('信任扩展自身协议 %s', (protocol) => {
        expect(isTrustedCredentialStorageContext(protocol)).toBe(true);
    });

    it.each([undefined, '', 'https:', 'http:', 'file:'])('拒绝网页或未知协议 %s', (protocol) => {
        expect(isTrustedCredentialStorageContext(protocol)).toBe(false);
    });
});
