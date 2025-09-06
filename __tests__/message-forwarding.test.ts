import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import { MatrixEventTypes } from '../src/types';
import { ChannelType } from '@elizaos/core';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
    getUserId: vi.fn().mockResolvedValue('@bot:matrix.org'),
    getUserProfile: vi.fn().mockResolvedValue({ displayname: 'Test User' }),
    getRoomState: vi.fn().mockResolvedValue([
      { type: 'm.room.name', content: { name: 'Test Room' } }
    ]),
    getRoomMembers: vi.fn().mockResolvedValue([
      { userId: '@user1:matrix.org' },
      { userId: '@bot:matrix.org' }
    ]),
    getAccountData: vi.fn().mockRejectedValue(new Error('No account data')),
    on: vi.fn(),
  })),
  SimpleFsStorageProvider: vi.fn(),
  AutojoinRoomsMixin: {
    setupOnClient: vi.fn(),
  },
}));

describe('Matrix Message Forwarding', () => {
  let mockRuntime: any;
  let mockEmitEvent: any;
  let mockEnsureConnection: any;
  let service: MatrixService;

  beforeEach(() => {
    mockEmitEvent = vi.fn();
    mockEnsureConnection = vi.fn();
    
    mockRuntime = {
      character: { settings: {} },
      agentId: 'test-agent-id',
      getSetting: vi.fn((key: string) => {
        const settings: Record<string, string> = {
          MATRIX_HOMESERVER_URL: 'https://matrix.org',
          MATRIX_ACCESS_TOKEN: 'syt_test_token',
          MATRIX_USER_ID: '@bot:matrix.org',
        };
        return settings[key];
      }),
      registerSendHandler: vi.fn(),
      emitEvent: mockEmitEvent,
      ensureConnection: mockEnsureConnection,
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

  describe('Message Listener Setup', () => {
    it('should set up event listeners on client initialization', () => {
      expect(service.client).toBeDefined();
      if (service.client) {
        expect(service.client.on).toHaveBeenCalledWith('room.message', expect.any(Function));
        expect(service.client.on).toHaveBeenCalledWith('room.event', expect.any(Function));
        expect(service.client.on).toHaveBeenCalledWith('room.join', expect.any(Function));
        expect(service.client.on).toHaveBeenCalledWith('room.leave', expect.any(Function));
      }
    });
  });

  describe('Message Processing and Forwarding', () => {
    it('should process and forward text messages to ElizaOS', async () => {
      // Mock group room (3+ members)
      if (service.client) {
        service.client.getRoomMembers = vi.fn().mockResolvedValue([
          { userId: '@user:matrix.org' },
          { userId: '@bot:matrix.org' },
          { userId: '@user2:matrix.org' }
        ]);
      }

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello, world!'
        }
      };

      // Access private method to test message handling
      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      // Verify ensureConnection was called
      expect(mockEnsureConnection).toHaveBeenCalledWith({
        entityId: expect.any(String),
        roomId: expect.any(String),
        userName: '@user:matrix.org',
        worldId: expect.any(String),
        worldName: 'Test Room',
        name: 'Test User',
        source: 'matrix',
        channelId: '!room:matrix.org',
        type: ChannelType.GROUP,
      });

      // Verify event was emitted to ElizaOS runtime
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          runtime: mockRuntime,
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: 'Hello, world!',
              source: 'matrix',
              channelType: ChannelType.GROUP,
            }),
          }),
          callback: expect.any(Function),
          originalEvent: mockEvent,
          room: expect.any(Object),
        })
      );
    });

    it('should skip forwarding bot messages', async () => {
      const mockEvent = {
        sender: '@bot:matrix.org', // Bot's own message
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Bot message'
        }
      };

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      // Should not emit event for bot's own messages
      expect(mockEmitEvent).not.toHaveBeenCalled();
      expect(mockEnsureConnection).not.toHaveBeenCalled();
    });

    it('should skip forwarding from restricted rooms', async () => {
      // Create service with room restrictions
      const restrictedRuntime = {
        ...mockRuntime,
        getSetting: vi.fn((key: string) => {
          const settings: Record<string, string> = {
            MATRIX_HOMESERVER_URL: 'https://matrix.org',
            MATRIX_ACCESS_TOKEN: 'syt_test_token',
            MATRIX_USER_ID: '@bot:matrix.org',
            MATRIX_ROOM_IDS: '!allowed:matrix.org', // Only allow specific room
          };
          return settings[key];
        }),
      };

      const restrictedService = new MatrixService(restrictedRuntime);
      
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello from restricted room'
        }
      };

      const privateService = restrictedService as any;
      await privateService.handleRoomMessage('!forbidden:matrix.org', mockEvent);

      // Should not emit event for messages from non-allowed rooms
      expect(mockEmitEvent).not.toHaveBeenCalled();
      expect(mockEnsureConnection).not.toHaveBeenCalled();
    });

    it('should handle callback responses correctly', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello, world!'
        }
      };

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      // Get the callback function from the emitEvent call
      const emitEventCall = mockEmitEvent.mock.calls[0];
      const eventPayload = emitEventCall[1];
      const callback = eventPayload.callback;

      // Test the callback with a response
      await callback({ text: 'Bot response' });

      // Verify the bot sent a response message
      expect(service.client?.sendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        {
          msgtype: 'm.text',
          body: 'Bot response'
        }
      );
    });

    it('should handle direct messages correctly', async () => {
      // Mock DM room (2 members)
      if (service.client) {
        service.client.getRoomMembers = vi.fn().mockResolvedValue([
          { userId: '@user:matrix.org' },
          { userId: '@bot:matrix.org' }
        ]);
      }

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'DM message'
        }
      };

      const privateService = service as any;
      await privateService.handleRoomMessage('!dm:matrix.org', mockEvent);

      // Verify connection was established with DM channel type
      expect(mockEnsureConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ChannelType.DM,
        })
      );

      // Verify event was emitted with DM channel type
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              channelType: ChannelType.DM,
            }),
          }),
        })
      );
    });

    it('should process and forward emote messages', async () => {
      // Mock group room (3+ members)
      if (service.client) {
        service.client.getRoomMembers = vi.fn().mockResolvedValue([
          { userId: '@user:matrix.org' },
          { userId: '@bot:matrix.org' },
          { userId: '@user2:matrix.org' }
        ]);
      }

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.emote',
          body: 'waves hello'
        }
      };

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: '*@user:matrix.org waves hello*',
              metadata: expect.objectContaining({
                messageType: 'm.emote',
                isMedia: false,
              }),
            }),
          }),
        })
      );
    });

    it('should process and forward media messages', async () => {
      // Clear any previous mock calls
      mockEmitEvent.mockClear();
      
      // Mock group room (3+ members)
      if (service.client) {
        service.client.getRoomMembers = vi.fn().mockResolvedValue([
          { userId: '@user:matrix.org' },
          { userId: '@bot:matrix.org' },
          { userId: '@user2:matrix.org' }
        ]);
      }

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.image',
          body: 'photo.jpg',
          url: 'mxc://matrix.org/abc123',
          info: {
            mimetype: 'image/jpeg',
            size: 12345
          }
        }
      };

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: expect.stringContaining('📷 **IMAGE ATTACHED**: photo.jpg'),
              metadata: expect.objectContaining({
                messageType: 'm.image',
                isMedia: true,
                mediaUrl: 'mxc://matrix.org/abc123',
                mimeType: 'image/jpeg',
                fileSize: 12345,
              }),
            }),
          }),
        })
      );
    });

    it('should skip unsupported message types', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.custom.unsupported', // Unsupported message type
          body: 'custom content'
        }
      };

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      // Should not process unsupported message types
      expect(mockEmitEvent).not.toHaveBeenCalled();
      expect(mockEnsureConnection).not.toHaveBeenCalled();
    });
  });

  describe('Reaction Forwarding', () => {
    it('should forward reaction events to ElizaOS', async () => {
      const mockReactionEvent = {
        sender: '@user:matrix.org',
        event_id: '$reaction123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.reaction',
        content: {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: '$target_event:matrix.org',
            key: '👍'
          }
        }
      };

      const privateService = service as any;
      await privateService.handleReactionEvent('!room:matrix.org', mockReactionEvent);

      // Verify reaction event was emitted
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.REACTION_RECEIVED, 'REACTION_RECEIVED'],
        expect.objectContaining({
          runtime: mockRuntime,
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: '*Reacted with 👍*',
              source: 'matrix',
            }),
          }),
          targetEventId: '$target_event:matrix.org',
          reactionKey: '👍',
        })
      );
    });
  });

  describe('Encrypted Message Handling', () => {
    beforeEach(() => {
      // Reset mocks for this test suite
      mockEmitEvent.mockClear();
      mockEnsureConnection.mockClear();
    });

    it('should handle encrypted messages that cannot be decrypted', async () => {
      // Use a simpler test that just verifies the method exists and doesn't throw
      const mockEncryptedEvent = {
        sender: '@user:matrix.org',
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          algorithm: 'm.megolm.v1.aes-sha2',
          ciphertext: 'encrypted_content_here'
        }
      };

      const privateService = service as any;
      
      // Should not throw an error
      await expect(privateService.handleEncryptedMessage('!room:matrix.org', mockEncryptedEvent))
        .resolves.toBeUndefined();
    });

    it('should skip encrypted messages from bot', async () => {
      const mockEncryptedEvent = {
        sender: '@bot:matrix.org', // Bot's own encrypted message
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          algorithm: 'm.megolm.v1.aes-sha2',
          ciphertext: 'encrypted_content_here'
        }
      };

      const privateService = service as any;
      await privateService.handleEncryptedMessage('!room:matrix.org', mockEncryptedEvent);

      // Should not emit event for bot's own encrypted messages
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in message processing gracefully', async () => {
      // Mock getRoomInfo to throw an error
      const privateService = service as any;
      privateService.getRoomInfo = vi.fn().mockRejectedValue(new Error('Room not found'));

      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello, world!'
        }
      };

      // Should not throw error
      await expect(privateService.handleRoomMessage('!room:matrix.org', mockEvent)).resolves.toBeUndefined();

      // Should log error
      expect(mockRuntime.logger.error).toHaveBeenCalled();
    });
  });
});