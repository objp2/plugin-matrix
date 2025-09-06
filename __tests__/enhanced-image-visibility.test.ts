import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import sendImageMessage from '../src/actions/sendImageMessage';
import { MATRIX_MESSAGE_TYPES } from '../src/constants';
import { ContentType } from '@elizaos/core';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
    uploadContent: vi.fn().mockResolvedValue('mxc://matrix.org/uploaded123'),
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

// Mock https module for successful downloads
vi.mock('https', () => ({
  get: vi.fn((url, callback) => {
    const mockResponse = {
      statusCode: 200,
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          // Simulate image data chunks
          handler(Buffer.from('fake-image-data'));
        } else if (event === 'end') {
          handler();
        }
      }),
    };
    callback(mockResponse);
    return {
      on: vi.fn(),
      setTimeout: vi.fn(),
    };
  }),
}));

describe('Enhanced Image Visibility for Agents', () => {
  let mockRuntime: any;
  let service: MatrixService;

  beforeEach(async () => {
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
      getService: vi.fn((serviceType: string) => {
        if (serviceType === 'matrix') {
          return service;
        }
        return null;
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

  describe('Enhanced Image Processing', () => {
    it('should provide clear visual indicators for image messages', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'vacation-photo.jpg',
          url: 'mxc://matrix.org/abc123',
          info: {
            mimetype: 'image/jpeg',
            size: 1024000, // 1MB
            w: 1920,
            h: 1080,
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

      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Verify enhanced message text format
      expect(memory.content.text).toContain('📷 **IMAGE ATTACHED**: vacation-photo.jpg');
      expect(memory.content.text).toContain('1920x1080');
      expect(memory.content.text).toContain('1000KB');
      expect(memory.content.text).toContain('✅ Image successfully processed and available for analysis');

      // Verify attachment is properly created
      expect(memory.content.attachments).toBeDefined();
      expect(memory.content.attachments).toHaveLength(1);
      
      const attachment = memory.content.attachments[0];
      expect(attachment.contentType).toBe(ContentType.IMAGE);
      expect(attachment.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(attachment.description).toContain('image file: vacation-photo.jpg');
    });

    it('should handle encrypted images with proper indicators', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        type: 'm.room.encrypted',
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'secret-document.png',
          url: 'mxc://matrix.org/encrypted123',
          info: {
            mimetype: 'image/png',
            size: 2048000, // 2MB
            w: 2560,
            h: 1440,
          },
        },
      };

      const mockRoomInfo = {
        id: '!room:matrix.org',
        name: 'Encrypted Room',
        isDirect: true,
        isEncrypted: true,
        memberCount: 2,
      };

      vi.spyOn(service, 'getRoomInfo').mockResolvedValue(mockRoomInfo);

      // Call the encrypted message handler directly
      await (service as any).handleEncryptedMessage('!room:matrix.org', mockEvent);

      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Verify encrypted image indicators
      expect(memory.content.text).toContain('🔐📷 **ENCRYPTED IMAGE ATTACHED**: secret-document.png');
      expect(memory.content.text).toContain('2560x1440');
      expect(memory.content.text).toContain('2000KB');
      expect(memory.content.text).toContain('✅ Encrypted image successfully decrypted and processed for analysis');
    });

    it('should handle download failures gracefully with clear error messages', async () => {
      // Mock HTTPS to simulate failure
      const httpsModule = await import('https');
      vi.mocked(httpsModule.get).mockImplementationOnce((url, callback) => {
        const mockResponse = {
          statusCode: 500,
          statusMessage: 'Internal Server Error',
        };
        callback(mockResponse as any);
        return {
          on: vi.fn(),
          setTimeout: vi.fn(),
        } as any;
      });

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'broken-image.jpg',
          url: 'mxc://matrix.org/broken123',
          info: {
            mimetype: 'image/jpeg',
            size: 500000,
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

      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Verify error handling messaging
      expect(memory.content.text).toContain('📷 **IMAGE ATTACHED**: broken-image.jpg');
      expect(memory.content.text).toContain('⚠️ Image could not be processed - content may not be accessible');
      expect(memory.content.attachments).toBeUndefined();
    });
  });

  describe('Send Image Message Action', () => {
    it('should validate required parameters correctly', async () => {
      const validMemory = {
        content: {
          roomId: '!room:matrix.org',
          imageUrl: 'https://example.com/image.jpg',
          text: 'Check out this image!',
        },
      };

      const result = await sendImageMessage.validate(mockRuntime, validMemory as any);
      expect(result).toBe(true);

      const invalidMemory = {
        content: {
          roomId: '!room:matrix.org',
          // Missing image source
        },
      };

      const invalidResult = await sendImageMessage.validate(mockRuntime, invalidMemory as any);
      expect(invalidResult).toBe(false);
    });

    it('should handle image URL sending correctly', async () => {
      const memory = {
        content: {
          roomId: '!room:matrix.org',
          imageUrl: 'https://example.com/test-image.jpg',
          text: 'Here is an image for you',
          fileName: 'test-image.jpg',
          mimeType: 'image/jpeg',
        },
      };

      const result = await sendImageMessage.handler(mockRuntime, memory as any);
      expect(result).toBe(true);

      // Verify that both text and image messages were sent
      if (service.client) {
        expect(service.client.sendMessage).toHaveBeenCalledTimes(2);
        
        // First call should be text message
        expect(service.client.sendMessage).toHaveBeenNthCalledWith(1, '!room:matrix.org', {
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: 'Here is an image for you',
        });

        // Second call should be image message
        expect(service.client.sendMessage).toHaveBeenNthCalledWith(2, '!room:matrix.org', {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'test-image.jpg',
          url: 'mxc://matrix.org/uploaded123',
          info: {
            mimetype: 'image/jpeg',
            size: expect.any(Number),
          },
        });
      }
    });
  });

  describe('Enhanced Send Handler', () => {
    it('should handle attachments in send handler content', async () => {
      const target = { channelId: '!room:matrix.org' };
      const content = {
        text: 'Response with image',
        attachments: [{
          id: 'test-attachment-id',
          contentType: 'IMAGE' as const,
          url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
          title: 'test-image.jpg',
          description: 'Test image',
          source: 'data:image/jpeg;base64,/9j/...',
          text: 'test-image.jpg',
        }],
      };

      await (service as any).handleSendMessage(mockRuntime, target, content);

      if (service.client) {
        // Should send both text and image
        expect(service.client.sendMessage).toHaveBeenCalledTimes(2);
        expect(service.client.uploadContent).toHaveBeenCalledOnce();
      }
    });
  });

  describe('Improved Error Handling and Logging', () => {
    it('should provide detailed logging for image processing steps', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'detailed-log-test.jpg',
          url: 'mxc://matrix.org/abc123',
          info: {
            mimetype: 'image/jpeg',
            size: 1024,
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

      // Verify detailed logging was called
      expect(mockRuntime.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('🔍 [DEBUG] Image message details - fileName: detailed-log-test.jpg')
      );
      expect(mockRuntime.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Successfully downloaded and attached image: detailed-log-test.jpg')
      );
    });
  });
});