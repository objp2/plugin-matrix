import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import { MATRIX_MESSAGE_TYPES } from '../src/constants';
import { ContentType } from '@elizaos/core';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
    getRoomState: vi.fn().mockResolvedValue([]),
    getRoomMembers: vi.fn().mockResolvedValue(['@user1:matrix.org', '@bot:matrix.org']),
    getUserId: vi.fn().mockResolvedValue('@bot:matrix.org'),
    getUserProfile: vi.fn().mockResolvedValue({ displayname: 'Test User' }),
    mxcToHttp: vi.fn().mockReturnValue('https://matrix.org/_matrix/media/v3/download/matrix.org/abc123'),
    on: vi.fn(),
  })),
  SimpleFsStorageProvider: vi.fn(),
  AutojoinRoomsMixin: {
    setupOnClient: vi.fn(),
  },
}));

// Mock http/https modules with default successful response
vi.mock('https', () => ({
  get: vi.fn((url, callback) => {
    const mockResponse = {
      statusCode: 200,
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          // Simulate image data chunks
          handler(Buffer.from('fake-image-data-chunk1'));
          handler(Buffer.from('fake-image-data-chunk2'));
        } else if (event === 'end') {
          handler();
        }
      }),
    };
    callback(mockResponse);
    return {
      on: vi.fn(),
    };
  }),
}));

vi.mock('http', () => ({
  get: vi.fn(),
}));

describe('Matrix Image Download for VLMs', () => {
  let mockRuntime: any;
  let service: MatrixService;

  beforeEach(async () => {
    // Reset the https mock to default successful behavior
    const httpsModule = await import('https');
    vi.mocked(httpsModule.get).mockImplementation((url, callback) => {
      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            // Simulate image data chunks
            handler(Buffer.from('fake-image-data-chunk1'));
            handler(Buffer.from('fake-image-data-chunk2'));
          } else if (event === 'end') {
            handler();
          }
        }),
      };
      callback(mockResponse);
      return {
        on: vi.fn(),
      };
    });

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
      ensureConnection: vi.fn(),
      emitEvent: vi.fn(),
      agentId: 'test-agent-id',
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        debug: vi.fn(),
      },
    };

    service = new MatrixService(mockRuntime);
  });

  describe('Image Message Processing', () => {
    it('should download image content and include as attachment for image messages', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'test-image.jpg',
          url: 'mxc://matrix.org/abc123',
          info: {
            mimetype: 'image/jpeg',
            size: 12345,
            w: 800,
            h: 600,
          },
        },
      };

      // Mock room info
      const mockRoomInfo = {
        id: '!room:matrix.org',
        name: 'Test Room',
        isDirect: false,
        isEncrypted: false,
        memberCount: 2,
      };

      // Spy on getRoomInfo method
      vi.spyOn(service, 'getRoomInfo').mockResolvedValue(mockRoomInfo);

      // Call the private method through reflection
      await (service as any).handleRoomMessage('!room:matrix.org', mockEvent);

      // Verify that emitEvent was called with the correct structure
      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Check that the memory contains attachments
      expect(memory.content.attachments).toBeDefined();
      expect(memory.content.attachments).toHaveLength(1);

      const attachment = memory.content.attachments[0];
      
      // Verify attachment properties
      expect(attachment.contentType).toBe(ContentType.IMAGE);
      expect(attachment.title).toBe('test-image.jpg');
      expect(attachment.source).toBe('mxc://matrix.org/abc123');
      expect(attachment.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(attachment.description).toBe('image file: test-image.jpg');
      
      // Verify the base64 data is present
      const base64Data = attachment.url.split(',')[1];
      expect(base64Data).toBeDefined();
      expect(Buffer.from(base64Data, 'base64').toString()).toBe('fake-image-data-chunk1fake-image-data-chunk2');
    });

    it('should handle non-image media messages without downloading content', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.VIDEO,
          body: 'test-video.mp4',
          url: 'mxc://matrix.org/video123',
          info: {
            mimetype: 'video/mp4',
            size: 123456,
          },
        },
      };

      const mockRoomInfo = {
        id: '!room:matrix.org',
        name: 'Test Room',
        isDirect: false,
        isEncrypted: false,
        memberCount: 2,
      };

      vi.spyOn(service, 'getRoomInfo').mockResolvedValue(mockRoomInfo);

      await (service as any).handleRoomMessage('!room:matrix.org', mockEvent);

      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Video messages should not have attachments downloaded automatically
      expect(memory.content.attachments).toBeUndefined();
      expect(memory.content.text).toContain('[VIDEO] test-video.mp4');
    });

    it('should handle download failures gracefully', async () => {
      // Override the https mock to simulate failure for this test
      const httpsModule = await import('https');
      vi.mocked(httpsModule.get).mockImplementationOnce((url, callback) => {
        const mockResponse = {
          statusCode: 404,
          statusMessage: 'Not Found',
        };
        callback(mockResponse as any);
        return {
          on: vi.fn(),
        } as any;
      });

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'missing-image.jpg',
          url: 'mxc://matrix.org/missing123',
          info: {
            mimetype: 'image/jpeg',
            size: 12345,
          },
        },
      };

      const mockRoomInfo = {
        id: '!room:matrix.org',
        name: 'Test Room',
        isDirect: false,
        isEncrypted: false,
        memberCount: 2,
      };

      vi.spyOn(service, 'getRoomInfo').mockResolvedValue(mockRoomInfo);

      // Clear previous mock calls
      mockRuntime.logger.warn.mockClear();
      mockRuntime.logger.error.mockClear();

      await (service as any).handleRoomMessage('!room:matrix.org', mockEvent);

      // Message should still be processed even if download fails
      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Should not have attachments due to download failure
      expect(memory.content.attachments).toBeUndefined();
      expect(memory.content.text).toContain('[IMAGE] missing-image.jpg');
      
      // Should have logged the error (the download method logs errors, not warnings)
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download media content')
      );
    });

    it('should handle encrypted image messages correctly', async () => {
      // Reset the mocks to ensure clean state
      mockRuntime.emitEvent.mockClear();
      
      // For encrypted messages, we need to test via handleRoomMessage with encrypted event type
      // and simulate decrypted content by including the expected content structure
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        type: 'm.room.encrypted',
        content: {
          // This simulates content that has been decrypted by the Matrix SDK
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'encrypted-image.jpg',
          url: 'mxc://matrix.org/encrypted123',
          info: {
            mimetype: 'image/png',
            size: 54321,
          },
        },
      };

      const mockRoomInfo = {
        id: '!room:matrix.org',
        name: 'Encrypted Room',
        isDirect: false,
        isEncrypted: true,
        memberCount: 2,
      };

      vi.spyOn(service, 'getRoomInfo').mockResolvedValue(mockRoomInfo);

      // Test regular message handling with encrypted content that has been decrypted
      await (service as any).handleRoomMessage('!room:matrix.org', mockEvent);

      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Should have attachment since the content includes decrypted image data
      expect(memory.content.attachments).toBeDefined();
      expect(memory.content.attachments).toHaveLength(1);

      const attachment = memory.content.attachments[0];
      expect(attachment.contentType).toBe(ContentType.IMAGE);
      expect(attachment.title).toBe('encrypted-image.jpg');
    });
  });

  describe('Media Content Download Helper', () => {
    it('should convert different image types correctly', async () => {
      const testCases = [
        { mimeType: 'image/jpeg', expectedType: ContentType.IMAGE },
        { mimeType: 'image/png', expectedType: ContentType.IMAGE },
        { mimeType: 'image/gif', expectedType: ContentType.IMAGE },
        { mimeType: 'video/mp4', expectedType: ContentType.VIDEO },
        { mimeType: 'audio/mpeg', expectedType: ContentType.AUDIO },
        { mimeType: 'application/pdf', expectedType: ContentType.DOCUMENT },
      ];

      for (const testCase of testCases) {
        const result = await (service as any).downloadMediaContent(
          'mxc://matrix.org/test123',
          testCase.mimeType,
          'test-file'
        );

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result.contentType).toBe(testCase.expectedType);
        expect(result.url).toMatch(new RegExp(`^data:${testCase.mimeType.replace('/', '\\/')};base64,`));
      }
    });

    it('should handle invalid MXC URLs gracefully', async () => {
      // Mock mxcToHttp to return null for invalid URLs
      if (service.client) {
        vi.mocked(service.client.mxcToHttp).mockReturnValue(null);
      }

      const result = await (service as any).downloadMediaContent(
        'invalid://not-mxc',
        'image/jpeg',
        'test.jpg'
      );

      expect(result).toBeNull();
      expect(mockRuntime.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to convert MXC URL to HTTP')
      );
    });
  });
});