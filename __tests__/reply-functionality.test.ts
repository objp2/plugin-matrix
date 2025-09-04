import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import { MATRIX_MESSAGE_TYPES } from '../src/constants';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('$reply:matrix.org'),
    getUserId: vi.fn().mockResolvedValue('@bot:matrix.org'),
    getUserProfile: vi.fn().mockResolvedValue({ displayname: 'Test Bot' }),
    getRoomState: vi.fn().mockResolvedValue([
      { type: 'm.room.name', content: { name: 'Test Room' } }
    ]),
    getRoomMembers: vi.fn().mockResolvedValue([
      { userId: '@user:matrix.org' },
      { userId: '@bot:matrix.org' },
      { userId: '@user2:matrix.org' }
    ]),
    getAccountData: vi.fn().mockRejectedValue(new Error('No account data')),
    on: vi.fn(),
  })),
  SimpleFsStorageProvider: vi.fn(),
  AutojoinRoomsMixin: {
    setupOnClient: vi.fn(),
  },
}));

describe('Matrix Reply Functionality', () => {
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
      },
    };

    service = new MatrixService(mockRuntime);
  });

  describe('Reply Message Formatting', () => {
    it('should format replies with proper Matrix m.relates_to structure', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$original123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello bot, how are you?'
        }
      };

      // Mock getUserProfile to return display name
      if (service.client) {
        service.client.getUserProfile = vi.fn().mockResolvedValue({ 
          displayname: 'Test User' 
        });
      }

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      // Get the callback function from the emitEvent call
      const emitEventCall = mockEmitEvent.mock.calls[0];
      const eventPayload = emitEventCall[1];
      const callback = eventPayload.callback;

      // Test the callback with a response
      await callback({ text: 'I am doing well, thank you!' });

      // Verify the bot sent a properly formatted reply
      expect(service.client?.sendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: '> <@user:matrix.org> Hello bot, how are you?\n\nI am doing well, thank you!',
          'm.relates_to': {
            'm.in_reply_to': {
              event_id: '$original123:matrix.org'
            }
          },
          format: 'org.matrix.custom.html',
          formatted_body: expect.stringContaining('<mx-reply>')
        })
      );
    });

    it('should handle HTML escaping in formatted replies', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$original123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello <script>alert("test")</script>'
        }
      };

      if (service.client) {
        service.client.getUserProfile = vi.fn().mockResolvedValue({ 
          displayname: 'Test User' 
        });
      }

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      const emitEventCall = mockEmitEvent.mock.calls[0];
      const eventPayload = emitEventCall[1];
      const callback = eventPayload.callback;

      await callback({ text: 'Safe response & proper escaping' });

      expect(service.client?.sendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          formatted_body: expect.stringContaining('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;')
        })
      );
    });

    it('should split long replies while maintaining reply format', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$original123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Short question'
        }
      };

      if (service.client) {
        service.client.getUserProfile = vi.fn().mockResolvedValue({ 
          displayname: 'Test User' 
        });
      }

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      const emitEventCall = mockEmitEvent.mock.calls[0];
      const eventPayload = emitEventCall[1];
      const callback = eventPayload.callback;

      // Create a very long response that will be split
      const longResponse = 'A'.repeat(5000);
      await callback({ text: longResponse });

      // Should be called multiple times for chunks
      expect(service.client?.sendMessage).toHaveBeenCalledTimes(2);
      
      // Each chunk should have the reply format
      const calls = (service.client?.sendMessage as any).mock.calls;
      calls.forEach((call: any) => {
        expect(call[1]).toHaveProperty('m.relates_to');
        expect(call[1]['m.relates_to']).toHaveProperty('m.in_reply_to');
        expect(call[1]['m.relates_to']['m.in_reply_to'].event_id).toBe('$original123:matrix.org');
      });
    });

    it('should handle replies without display name gracefully', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$original123:matrix.org',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          body: 'Hello bot'
        }
      };

      // Mock getUserProfile to fail
      if (service.client) {
        service.client.getUserProfile = vi.fn().mockRejectedValue(new Error('Profile not found'));
      }

      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      const emitEventCall = mockEmitEvent.mock.calls[0];
      const eventPayload = emitEventCall[1];
      const callback = eventPayload.callback;

      await callback({ text: 'Hello!' });

      // Should still send reply but without formatted_body
      expect(service.client?.sendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: '> <@user:matrix.org> Hello bot\n\nHello!',
          'm.relates_to': {
            'm.in_reply_to': {
              event_id: '$original123:matrix.org'
            }
          }
        })
      );

      // Should not have formatted_body since displayName was not available
      const sendMessageCall = (service.client?.sendMessage as any).mock.calls[0];
      expect(sendMessageCall[1]).not.toHaveProperty('format');
      expect(sendMessageCall[1]).not.toHaveProperty('formatted_body');
    });
  });

  describe('Reaction Response Formatting', () => {
    it('should not format reaction responses as replies', async () => {
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

      const emitEventCall = mockEmitEvent.mock.calls[0];
      const eventPayload = emitEventCall[1];
      const callback = eventPayload.callback;

      await callback({ text: 'Thanks for the reaction!' });

      // Reaction responses should be plain messages, not replies
      expect(service.client?.sendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        {
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: 'Thanks for the reaction!'
        }
      );
    });
  });
});