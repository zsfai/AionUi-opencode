/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  OfflineRequestError,
  assertOfflineRequestAllowed,
  guardFetch,
  isAirgapMode,
  isOfflineAllowedUrl,
} from '@/common/utils/networkPolicy';

describe('offline network policy', () => {
  it('allows loopback, private LAN, and non-network URLs', () => {
    expect(isOfflineAllowedUrl('http://127.0.0.1:25808/api/health')).toBe(true);
    expect(isOfflineAllowedUrl('http://localhost/watch')).toBe(true);
    expect(isOfflineAllowedUrl('https://192.168.1.8/v1')).toBe(true);
    expect(isOfflineAllowedUrl('http://10.0.0.4/v1')).toBe(true);
    expect(isOfflineAllowedUrl('file:///C:/docs/report.docx')).toBe(true);
    expect(isOfflineAllowedUrl('/api/local')).toBe(true);
  });

  it('blocks public hosts and protocol-relative URLs', () => {
    expect(isOfflineAllowedUrl('https://api.openai.com/v1/models')).toBe(false);
    expect(isOfflineAllowedUrl('https://evil.com/127.0.0.1')).toBe(false);
    expect(isOfflineAllowedUrl('https://127.0.0.1.evil.com/v1')).toBe(false);
    expect(isOfflineAllowedUrl('//github.com/repo')).toBe(false);
    expect(isAirgapMode({})).toBe(true);
    expect(isAirgapMode({ AIONUI_ALLOW_NETWORK: '1' })).toBe(false);
  });

  it('rejects a public fetch before the underlying client is called', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const guarded = guardFetch(fetchImpl, {});
    await expect(guarded('https://api.github.com/repos/example')).rejects.toBeInstanceOf(OfflineRequestError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards a loopback fetch when air-gap mode is on', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    const guarded = guardFetch(fetchImpl, {});
    const response = await guarded('http://127.0.0.1:9/health');
    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('allows a public fetch only when network access is explicitly enabled', () => {
    expect(() => assertOfflineRequestAllowed('https://example.com', { AIONUI_ALLOW_NETWORK: '1' })).not.toThrow();
  });
});
