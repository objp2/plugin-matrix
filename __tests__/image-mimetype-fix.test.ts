import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import { ContentType } from '@elizaos/core';
import { MATRIX_MESSAGE_TYPES } from '../src/constants';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
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

describe('Image MIME Type Detection Fix', () => {
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
      registerSendHandler: vi.fn(),
      ensureConnection: vi.fn(),
      emitEvent: vi.fn(),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        success: vi.fn(),
      },
      agentId: 'test-agent',
    };

    service = new MatrixService(mockRuntime);
    await new Promise(resolve => setTimeout(resolve, 100)); // Allow service to initialize
  });

  it('should download image even when mimetype is missing from message info', async () => {
    const mockImageEvent = {
      sender: '@user1:matrix.org',
      event_id: '$image123:matrix.org',
      origin_server_ts: Date.now(),
      content: {
        msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
        body: 'test.jpg',
        url: 'mxc://matrix.org/test.jpg',
        info: {
          // Note: mimetype is missing - this should trigger the fix
          size: 12345,
          w: 800,
          h: 600,
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

    // Agent should receive the image with attachments even without mimetype
    expect(memory.content.text).toContain('📷 **IMAGE ATTACHED**: test.jpg');
    expect(memory.content.text).toContain('✅ Image successfully processed and available for analysis');
    
    // Most importantly, attachments should be present
    expect(memory.content.attachments).toBeDefined();
    expect(memory.content.attachments).toHaveLength(1);
    
    const attachment = memory.content.attachments[0];
    expect(attachment.contentType).toBe(ContentType.IMAGE);
    expect(attachment.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(attachment.title).toBe('test.jpg');

    // Check that the service detected JPEG from URL
    expect(mockRuntime.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('No mimetype provided for image, detected from URL: image/jpeg')
    );
  });

  it('should detect PNG mimetype from URL extension', async () => {
    const mockImageEvent = {
      sender: '@user1:matrix.org',
      event_id: '$image456:matrix.org',
      origin_server_ts: Date.now(),
      content: {
        msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
        body: 'screenshot.png',
        url: 'mxc://matrix.org/screenshot.png',
        info: {
          // No mimetype provided
          size: 54321,
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

    // Attachments should be present with PNG mimetype
    expect(memory.content.attachments).toBeDefined();
    expect(memory.content.attachments).toHaveLength(1);
    
    const attachment = memory.content.attachments[0];
    expect(attachment.url).toMatch(/^data:image\/png;base64,/);

    // Check that PNG was detected
    expect(mockRuntime.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('No mimetype provided for image, detected from URL: image/png')
    );
  });

  it('should use fallback JPEG mimetype for unknown extensions', async () => {
    const mockImageEvent = {
      sender: '@user1:matrix.org',
      event_id: '$image789:matrix.org',
      origin_server_ts: Date.now(),
      content: {
        msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
        body: 'unknown.xyz',
        url: 'mxc://matrix.org/unknown.xyz',
        info: {
          // No mimetype provided
          size: 98765,
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

    // Attachments should be present with fallback JPEG mimetype
    expect(memory.content.attachments).toBeDefined();
    expect(memory.content.attachments).toHaveLength(1);
    
    const attachment = memory.content.attachments[0];
    expect(attachment.url).toMatch(/^data:image\/jpeg;base64,/);

    // Check that fallback JPEG was used
    expect(mockRuntime.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('No mimetype provided for image, detected from URL: image/jpeg')
    );
  });
});