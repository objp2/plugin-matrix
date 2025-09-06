import { describe, it, expect, beforeEach, vi } from 'vitest';
import matrixPlugin from '../src/index';
import { MatrixService } from '../src/service';
import { ContentType } from '@elizaos/core';
import { MATRIX_MESSAGE_TYPES } from '../src/constants';

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
          // Simulate a small valid JPEG header followed by some data
          handler(Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // JPEG magic bytes
          handler(Buffer.from('test-image-data'));
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

describe('Agent Image Visibility Integration Test', () => {
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

  describe('Agent Image Action Availability', () => {
    it('should make SEND_IMAGE_MESSAGE action available to the agent', async () => {
      const sendImageAction = matrixPlugin.actions.find(a => a.name === 'SEND_IMAGE_MESSAGE');
      expect(sendImageAction).toBeDefined();

      // Test availability check (empty content)
      const emptyMessage = { content: {} } as any;
      const isAvailable = await sendImageAction!.validate(mockRuntime, emptyMessage);
      expect(isAvailable).toBe(true);
    });

    it('should make UPLOAD_MEDIA action available to the agent', async () => {
      const uploadAction = matrixPlugin.actions.find(a => a.name === 'UPLOAD_MEDIA');
      expect(uploadAction).toBeDefined();

      // Test availability check (empty content)
      const emptyMessage = { content: {} } as any;
      const isAvailable = await uploadAction!.validate(mockRuntime, emptyMessage);
      expect(isAvailable).toBe(true);
    });

    it('should make DOWNLOAD_MEDIA action available to the agent', async () => {
      const downloadAction = matrixPlugin.actions.find(a => a.name === 'DOWNLOAD_MEDIA');
      expect(downloadAction).toBeDefined();

      // Test availability check (empty content)
      const emptyMessage = { content: {} } as any;
      const isAvailable = await downloadAction!.validate(mockRuntime, emptyMessage);
      expect(isAvailable).toBe(true);
    });

    it('should validate all actions are available when Matrix service is ready', async () => {
      const emptyMessage = { content: {} } as any;
      
      for (const action of matrixPlugin.actions) {
        const isAvailable = await action.validate(mockRuntime, emptyMessage);
        expect(isAvailable).toBe(true, `${action.name} should be available when service is ready`);
      }
    });
  });

  describe('Agent Image Processing Capabilities', () => {
    it('should receive image messages with proper attachments for agent analysis', async () => {
      const mockImageEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'screenshot.png',
          url: 'mxc://matrix.org/abc123',
          info: {
            mimetype: 'image/png',
            size: 125000,
            w: 1024,
            h: 768,
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

      await (service as any).handleRoomMessage('!room:matrix.org', mockImageEvent);

      // Verify agent received the event
      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Check that the agent receives clear image indicators
      expect(memory.content.text).toContain('📷 **IMAGE ATTACHED**: screenshot.png');
      expect(memory.content.text).toContain('1024x768');
      expect(memory.content.text).toContain('122KB');
      expect(memory.content.text).toContain('✅ Image successfully processed and available for analysis');

      // Check that attachments are available for VLM processing
      expect(memory.content.attachments).toBeDefined();
      expect(memory.content.attachments).toHaveLength(1);
      
      const attachment = memory.content.attachments[0];
      expect(attachment.contentType).toBe(ContentType.IMAGE);
      expect(attachment.url).toMatch(/^data:image\/png;base64,/);
      expect(attachment.title).toBe('screenshot.png');
      expect(attachment.source).toBe('mxc://matrix.org/abc123');
      
      // Verify the attachment contains the downloaded image data
      const base64Data = attachment.url.split(',')[1];
      expect(base64Data).toBeDefined();
      const decodedData = Buffer.from(base64Data, 'base64');
      expect(decodedData.length).toBeGreaterThan(0);
      
      // Verify JPEG magic bytes are present (from our mock)
      expect(decodedData[0]).toBe(0xff);
      expect(decodedData[1]).toBe(0xd8);
    });

    it('should handle agent sending images through SEND_IMAGE_MESSAGE action', async () => {
      const sendImageAction = matrixPlugin.actions.find(a => a.name === 'SEND_IMAGE_MESSAGE')!;
      
      const imageMessage = {
        content: {
          roomId: '!room:matrix.org',
          imageUrl: 'https://example.com/agent-generated-chart.png',
          text: 'Here is the chart you requested',
          fileName: 'chart.png',
          mimeType: 'image/png',
        },
      };

      const result = await sendImageAction.handler(mockRuntime, imageMessage as any);
      expect(result).toBe(true);

      // Verify both text and image were sent
      if (service.client) {
        expect(service.client.sendMessage).toHaveBeenCalledTimes(2);
        
        // First call should be text message
        expect(service.client.sendMessage).toHaveBeenNthCalledWith(1, '!room:matrix.org', {
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: 'Here is the chart you requested',
        });

        // Second call should be image message
        expect(service.client.sendMessage).toHaveBeenNthCalledWith(2, '!room:matrix.org', {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'chart.png',
          url: 'mxc://matrix.org/uploaded123',
          info: {
            mimetype: 'image/png',
            size: expect.any(Number),
          },
        });
      }
    });
  });

  describe('Agent Error Handling for Images', () => {
    it('should gracefully handle image download failures while still notifying the agent', async () => {
      // Mock HTTPS to simulate failure
      const httpsModule = await import('https');
      vi.mocked(httpsModule.get).mockImplementationOnce((url, callback) => {
        const mockResponse = {
          statusCode: 404,
          statusMessage: 'Not Found',
        };
        callback(mockResponse as any);
        return {
          on: vi.fn(),
          setTimeout: vi.fn(),
        } as any;
      });

      const mockImageEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
          body: 'broken-image.jpg',
          url: 'mxc://matrix.org/broken123',
          info: {
            mimetype: 'image/jpeg',
            size: 50000,
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

      await (service as any).handleRoomMessage('!room:matrix.org', mockImageEvent);

      expect(mockRuntime.emitEvent).toHaveBeenCalled();
      
      const emitCall = mockRuntime.emitEvent.mock.calls[0];
      const eventData = emitCall[1];
      const memory = eventData.message;

      // Agent should still be notified about the image, even if download failed
      expect(memory.content.text).toContain('📷 **IMAGE ATTACHED**: broken-image.jpg');
      expect(memory.content.text).toContain('⚠️ Image could not be processed - content may not be accessible');
      
      // No attachments should be present due to download failure
      expect(memory.content.attachments).toBeUndefined();
    });
  });
});