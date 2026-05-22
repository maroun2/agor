/**
 * CodexPromptService Tests
 *
 * Focused test: Verify SDK instance caching to prevent memory leak (issue #133)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexPromptService } from './prompt-service.js';

// Track how many Codex instances were created (module-level state)
let mockInstanceCount = 0;

// Mock @agor/core/sdk to avoid spawning real Codex SDK processes
vi.mock('@agor/core/sdk', () => {
  class MockCodex {
    apiKey: string;
    instanceId: number;

    constructor(options: { apiKey?: string }) {
      this.apiKey = options.apiKey || '';
      this.instanceId = ++mockInstanceCount;
    }

    startThread() {
      return {
        id: 'mock-thread-id',
        run: vi.fn(),
        runStreamed: vi.fn().mockResolvedValue({ events: [] }),
      };
    }

    resumeThread(threadId: string) {
      return {
        id: threadId,
        run: vi.fn(),
        runStreamed: vi.fn().mockResolvedValue({ events: [] }),
      };
    }
  }

  return {
    Codex: {
      Codex: MockCodex,
    },
  };
});

// Mock repositories and database
const mockMessagesRepo = {} as any;
const mockSessionsRepo = {
  findById: vi.fn(),
  update: vi.fn(),
} as any;
const mockSessionMCPServerRepo = {
  listServers: vi.fn().mockResolvedValue([]),
  listServersWithMetadata: vi.fn().mockResolvedValue([]),
} as any;
const mockWorktreesRepo = {
  findById: vi.fn(),
} as any;
const mockDb = {} as any;

describe('CodexPromptService - SDK Instance Caching (issue #133)', () => {
  beforeEach(() => {
    mockInstanceCount = 0;
    vi.clearAllMocks();
  });

  it('should create exactly one Codex instance on initialization', () => {
    const initialCount = mockInstanceCount;

    new CodexPromptService(
      mockMessagesRepo,
      mockSessionsRepo,
      mockSessionMCPServerRepo,
      mockWorktreesRepo,
      undefined, // reposRepo
      'test-api-key',
      mockDb
    );

    expect(mockInstanceCount).toBe(initialCount + 1);
  });

  it('should reuse the same Codex instance when API key has not changed', () => {
    const service = new CodexPromptService(
      mockMessagesRepo,
      mockSessionsRepo,
      mockSessionMCPServerRepo,
      mockWorktreesRepo,
      undefined, // reposRepo
      'test-api-key',
      mockDb
    );

    const countAfterInit = mockInstanceCount;

    // Simulate multiple calls to refreshClient with the same API key
    // Access private method via type assertion for testing
    const serviceWithPrivate = service as any;
    serviceWithPrivate.refreshClient('test-api-key');
    serviceWithPrivate.refreshClient('test-api-key');
    serviceWithPrivate.refreshClient('test-api-key');

    // Should NOT create new instances - still same count
    expect(mockInstanceCount).toBe(countAfterInit);
  });

  it('should create a new Codex instance only when API key changes', () => {
    const service = new CodexPromptService(
      mockMessagesRepo,
      mockSessionsRepo,
      mockSessionMCPServerRepo,
      mockWorktreesRepo,
      undefined, // reposRepo
      'initial-key',
      mockDb
    );

    const countAfterInit = mockInstanceCount;

    // Call with same API key - should NOT create new instance
    const serviceWithPrivate = service as any;
    serviceWithPrivate.refreshClient('initial-key');
    expect(mockInstanceCount).toBe(countAfterInit);

    // Call with different API key - SHOULD create new instance
    serviceWithPrivate.refreshClient('new-api-key');
    expect(mockInstanceCount).toBe(countAfterInit + 1);

    // Call with same new key again - should NOT create another instance
    serviceWithPrivate.refreshClient('new-api-key');
    expect(mockInstanceCount).toBe(countAfterInit + 1);
  });

  it('should handle empty/undefined API keys correctly', () => {
    const service = new CodexPromptService(
      mockMessagesRepo,
      mockSessionsRepo,
      mockSessionMCPServerRepo,
      mockWorktreesRepo,
      undefined, // reposRepo
      undefined,
      mockDb
    );

    const countAfterInit = mockInstanceCount;

    // Call with empty string - should not recreate if already empty
    const serviceWithPrivate = service as any;
    serviceWithPrivate.refreshClient('');
    expect(mockInstanceCount).toBe(countAfterInit);

    // Call with actual key - should create new instance
    serviceWithPrivate.refreshClient('new-key');
    expect(mockInstanceCount).toBe(countAfterInit + 1);
  });
});

describe('CodexPromptService - Permission Config Resolution', () => {
  beforeEach(() => {
    mockInstanceCount = 0;
    vi.clearAllMocks();

    mockWorktreesRepo.findById.mockResolvedValue({
      worktree_id: 'worktree-1',
      path: '/tmp/agor-test-worktree',
    });
  });

  async function runPrompt(service: CodexPromptService) {
    for await (const _event of service.promptSessionStreaming(
      'session-1' as any,
      'test prompt',
      'task-1' as any
    )) {
      // Consume stream so setup path runs.
    }
  }

  function createService() {
    const service = new CodexPromptService(
      mockMessagesRepo,
      mockSessionsRepo,
      mockSessionMCPServerRepo,
      mockWorktreesRepo,
      undefined, // reposRepo
      'test-api-key',
      mockDb
    );

    vi.spyOn(service as any, 'ensureCodexSessionContext').mockResolvedValue('/tmp/mock-codex-home');
    const ensureConfigSpy = vi.spyOn(service as any, 'ensureCodexConfig').mockResolvedValue(0);

    return { service, ensureConfigSpy };
  }

  it('maps unified allow-all mode to Codex full access config when codex override is absent', async () => {
    mockSessionsRepo.findById.mockResolvedValue({
      session_id: 'session-1',
      worktree_id: 'worktree-1',
      permission_config: { mode: 'allow-all' },
      mcp_token: 'mcp-token',
      created_at: new Date('2026-05-22T00:00:00.000Z'),
    });

    const { service, ensureConfigSpy } = createService();

    await runPrompt(service);

    expect(ensureConfigSpy).toHaveBeenCalledWith(
      'never',
      true,
      'session-1',
      '/tmp/mock-codex-home',
      'mcp-token'
    );
  });

  it('prefers explicit Codex config over unified mode', async () => {
    mockSessionsRepo.findById.mockResolvedValue({
      session_id: 'session-1',
      worktree_id: 'worktree-1',
      permission_config: {
        mode: 'allow-all',
        codex: {
          sandboxMode: 'read-only',
          approvalPolicy: 'untrusted',
          networkAccess: false,
        },
      },
      mcp_token: 'mcp-token',
      created_at: new Date('2026-05-22T00:00:00.000Z'),
    });

    const { service, ensureConfigSpy } = createService();

    await runPrompt(service);

    expect(ensureConfigSpy).toHaveBeenCalledWith(
      'untrusted',
      false,
      'session-1',
      '/tmp/mock-codex-home',
      'mcp-token'
    );
  });
});
