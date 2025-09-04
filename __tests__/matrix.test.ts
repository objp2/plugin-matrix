import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import matrixPlugin from '../src/index';
import { validateMatrixConfig } from '../src/environment';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
    joinRoom: vi.fn().mockResolvedValue('!room:matrix.org'),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    getJoinedRooms: vi.fn().mockResolvedValue(['!room1:matrix.org', '!room2:matrix.org']),
    getRoomState: vi.fn().mockResolvedValue([]),
    getUserId: vi.fn().mockResolvedValue('@bot:matrix.org'),
    on: vi.fn(),
  })),
  SimpleFsStorageProvider: vi.fn(),
  AutojoinRoomsMixin: {
    setupOnClient: vi.fn(),
  },
}));

describe('Matrix Plugin', () => {
  describe('Plugin Structure', () => {
    it('should have correct plugin structure', () => {
      expect(matrixPlugin).toBeDefined();
      expect(matrixPlugin.name).toBe('matrix');
      expect(matrixPlugin.description).toContain('Matrix protocol plugin');
      expect(matrixPlugin.services).toHaveLength(1);
      expect(matrixPlugin.actions).toHaveLength(8);
      expect(matrixPlugin.providers).toHaveLength(2);
    });

    it('should have all required actions', () => {
      const actionNames = matrixPlugin.actions.map(action => action.name);
      expect(actionNames).toContain('SEND_MESSAGE');
      expect(actionNames).toContain('REACT_TO_MESSAGE');
      expect(actionNames).toContain('JOIN_ROOM');
      expect(actionNames).toContain('LEAVE_ROOM');
      expect(actionNames).toContain('UPLOAD_MEDIA');
      expect(actionNames).toContain('DOWNLOAD_MEDIA');
      expect(actionNames).toContain('ENABLE_ENCRYPTION');
      expect(actionNames).toContain('LIST_ROOMS');
    });

    it('should have required providers', () => {
      const providerNames = matrixPlugin.providers.map(provider => provider.name);
      expect(providerNames).toContain('MATRIX_ROOM_STATE');
      expect(providerNames).toContain('MATRIX_USER_INFO');
    });
  });

  describe('Environment Validation', () => {
    it('should validate correct configuration', () => {
      const validConfig = {
        MATRIX_HOMESERVER_URL: 'https://matrix.org',
        MATRIX_ACCESS_TOKEN: 'syt_test_token',
        MATRIX_USER_ID: '@test:matrix.org',
        MATRIX_ROOM_IDS: '!room1:matrix.org,!room2:matrix.org',
        MATRIX_ENCRYPTION_ENABLED: true,
      };

      expect(() => validateMatrixConfig(validConfig)).not.toThrow();
    });

    it('should reject invalid homeserver URL', () => {
      const invalidConfig = {
        MATRIX_HOMESERVER_URL: 'not-a-url',
        MATRIX_ACCESS_TOKEN: 'syt_test_token',
        MATRIX_USER_ID: '@test:matrix.org',
      };

      expect(() => validateMatrixConfig(invalidConfig)).toThrow();
    });

    it('should reject invalid user ID format', () => {
      const invalidConfig = {
        MATRIX_HOMESERVER_URL: 'https://matrix.org',
        MATRIX_ACCESS_TOKEN: 'syt_test_token',
        MATRIX_USER_ID: 'invalid-user-id',
      };

      expect(() => validateMatrixConfig(invalidConfig)).toThrow();
    });

    it('should require access token', () => {
      const invalidConfig = {
        MATRIX_HOMESERVER_URL: 'https://matrix.org',
        MATRIX_USER_ID: '@test:matrix.org',
      };

      expect(() => validateMatrixConfig(invalidConfig)).toThrow();
    });
  });

  describe('MatrixService', () => {
    let mockRuntime: any;

    beforeEach(() => {
      mockRuntime = {
        character: { settings: {} },
        getSetting: vi.fn((key: string) => {
          const settings: Record<string, string> = {
            MATRIX_HOMESERVER_URL: 'https://matrix.org',
            MATRIX_ACCESS_TOKEN: 'syt_test_token',
            MATRIX_USER_ID: '@test:matrix.org',
          };
          return settings[key];
        }),
        registerSendHandler: vi.fn(),
        logger: {
          error: vi.fn(),
          warn: vi.fn(),
          info: vi.fn(),
          success: vi.fn(),
        },
      };
    });

    it('should initialize with valid configuration', () => {
      expect(() => new MatrixService(mockRuntime)).not.toThrow();
    });

    it('should handle missing access token gracefully', () => {
      mockRuntime.getSetting = vi.fn((key: string) => {
        if (key === 'MATRIX_ACCESS_TOKEN') return '';
        const settings: Record<string, string> = {
          MATRIX_HOMESERVER_URL: 'https://matrix.org',
          MATRIX_USER_ID: '@test:matrix.org',
        };
        return settings[key];
      });

      const service = new MatrixService(mockRuntime);
      expect(service.client).toBeNull();
    });

    it('should register send handler', () => {
      new MatrixService(mockRuntime);
      expect(mockRuntime.registerSendHandler).toHaveBeenCalledWith('matrix', expect.any(Function));
    });
  });
});

describe('Actions', () => {
  let mockRuntime: any;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      client: {
        sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
        joinRoom: vi.fn().mockResolvedValue('!room:matrix.org'),
        leaveRoom: vi.fn().mockResolvedValue(undefined),
        sendEvent: vi.fn().mockResolvedValue('$reaction:matrix.org'),
      },
      addAllowedRoom: vi.fn(),
      removeAllowedRoom: vi.fn(),
    };

    mockRuntime = {
      getService: vi.fn().mockReturnValue(mockService),
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
    };
  });

  describe('Send Message Action', () => {
    it('should validate message content', async () => {
      const sendMessage = matrixPlugin.actions.find(a => a.name === 'SEND_MESSAGE')!;
      
      const validMessage = {
        content: { text: 'Hello', roomId: '!room:matrix.org' },
      } as any;
      
      const invalidMessage = {
        content: { roomId: '!room:matrix.org' },
      } as any;

      expect(await sendMessage.validate(mockRuntime, validMessage)).toBe(true);
      expect(await sendMessage.validate(mockRuntime, invalidMessage)).toBe(false);
    });
  });

  describe('React to Message Action', () => {
    it('should validate reaction content', async () => {
      const reactAction = matrixPlugin.actions.find(a => a.name === 'REACT_TO_MESSAGE')!;
      
      const validMessage = {
        content: { 
          eventId: '$event:matrix.org',
          roomId: '!room:matrix.org',
          reaction: '👍'
        },
      } as any;
      
      const invalidMessage = {
        content: { roomId: '!room:matrix.org' },
      } as any;

      expect(await reactAction.validate(mockRuntime, validMessage)).toBe(true);
      expect(await reactAction.validate(mockRuntime, invalidMessage)).toBe(false);
    });
  });

  describe('Join Room Action', () => {
    it('should validate room identifier', async () => {
      const joinAction = matrixPlugin.actions.find(a => a.name === 'JOIN_ROOM')!;
      
      const validMessage = {
        content: { roomId: '!room:matrix.org' },
      } as any;
      
      const validAliasMessage = {
        content: { roomAlias: '#general:matrix.org' },
      } as any;
      
      const invalidMessage = {
        content: {},
      } as any;

      expect(await joinAction.validate(mockRuntime, validMessage)).toBe(true);
      expect(await joinAction.validate(mockRuntime, validAliasMessage)).toBe(true);
      expect(await joinAction.validate(mockRuntime, invalidMessage)).toBe(false);
    });
  });
});