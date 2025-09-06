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

describe('Matrix Encryption Improvements', () => {
  let mockRuntime: any;
  let mockEmitEvent: any;
  let mockEnsureConnection: any;
  let service: MatrixService;
  let mockSendMessage: any;

  beforeEach(() => {
    mockEmitEvent = vi.fn();
    mockEnsureConnection = vi.fn();
    mockSendMessage = vi.fn();
    
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
    if (service.client) {
      service.client.sendMessage = mockSendMessage;
    }
  });

  describe('Regular Messages via room.event', () => {
    it('should process regular messages that come through room.event listener', async () => {
      const mockEvent = {
        sender: '@user:matrix.org',
        event_id: '$event123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'Hello from room.event!'
        }
      };

      // Access private method to test message handling via room.event
      const privateService = service as any;
      await privateService.handleRoomMessage('!room:matrix.org', mockEvent);

      // Verify message was processed and emitted
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: 'Hello from room.event!',
              source: 'matrix',
            }),
          }),
          callback: expect.any(Function),
        })
      );
    });
  });

  describe('Encrypted Message Decryption', () => {
    it('should handle successfully decrypted encrypted messages', async () => {
      const mockDecryptedEvent = {
        sender: '@user:matrix.org',
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          // Decrypted content
          msgtype: 'm.text',
          body: 'This is a decrypted message!'
        }
      };

      const privateService = service as any;
      await privateService.handleEncryptedMessage('!room:matrix.org', mockDecryptedEvent);

      // Verify the decrypted message was processed
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: 'This is a decrypted message!',
              metadata: expect.objectContaining({
                messageType: 'm.text',
                isEncrypted: true,
                isDecrypted: true,
              }),
            }),
          }),
          callback: expect.any(Function), // Should have a callback for replies
        })
      );
    });

    it('should handle encrypted messages that could not be decrypted', async () => {
      const mockEncryptedEvent = {
        sender: '@user:matrix.org',
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          // No decrypted content available
          algorithm: 'm.megolm.v1.aes-sha2',
          ciphertext: 'encrypted_content_here'
        }
      };

      const privateService = service as any;
      await privateService.handleEncryptedMessage('!room:matrix.org', mockEncryptedEvent);

      // Verify the encrypted message was processed with placeholder text
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: '[Encrypted message - content not available]',
              metadata: expect.objectContaining({
                messageType: 'm.room.encrypted',
                isEncrypted: true,
                isDecrypted: false,
              }),
            }),
          }),
          callback: expect.any(Function), // Should still have a callback for replies
        })
      );
    });

    it('should handle decrypted media messages correctly', async () => {
      const mockDecryptedMediaEvent = {
        sender: '@user:matrix.org',
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          // Decrypted media content
          msgtype: 'm.image',
          body: 'secret_photo.jpg',
          url: 'mxc://matrix.org/abc123',
          info: {
            mimetype: 'image/jpeg',
            size: 54321
          }
        }
      };

      const privateService = service as any;
      await privateService.handleEncryptedMessage('!room:matrix.org', mockDecryptedMediaEvent);

      // Verify the decrypted media message was processed
      expect(mockEmitEvent).toHaveBeenCalledWith(
        [MatrixEventTypes.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED'],
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.objectContaining({
              text: '[IMAGE] secret_photo.jpg (mxc://matrix.org/abc123)',
              metadata: expect.objectContaining({
                messageType: 'm.image',
                isEncrypted: true,
                isDecrypted: true,
                isMedia: true,
                mediaUrl: 'mxc://matrix.org/abc123',
                mimeType: 'image/jpeg',
                fileSize: 54321,
              }),
            }),
          }),
        })
      );
    });
  });

  describe('Response Callbacks for Encrypted Messages', () => {
    it('should allow replies to encrypted messages', async () => {
      const mockEncryptedEvent = {
        sender: '@user:matrix.org',
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          msgtype: 'm.text',
          body: 'Can you reply to this?'
        }
      };

      const privateService = service as any;
      await privateService.handleEncryptedMessage('!room:matrix.org', mockEncryptedEvent);

      // Get the callback function from the emitted event
      const callArgs = mockEmitEvent.mock.calls[0];
      const eventPayload = callArgs[1];
      const callback = eventPayload.callback;

      // Test the callback
      await callback({ text: 'Yes, I can reply!' });

      // Verify the response was sent
      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        {
          msgtype: 'm.text',
          body: 'Yes, I can reply!'
        }
      );
    });

    it('should handle long response messages with chunking', async () => {
      const mockEncryptedEvent = {
        sender: '@user:matrix.org',
        event_id: '$encrypted123:matrix.org',
        origin_server_ts: 1234567890,
        type: 'm.room.encrypted',
        content: {
          msgtype: 'm.text',
          body: 'Tell me a long story'
        }
      };

      const privateService = service as any;
      await privateService.handleEncryptedMessage('!room:matrix.org', mockEncryptedEvent);

      // Get the callback function
      const callArgs = mockEmitEvent.mock.calls[0];
      const eventPayload = callArgs[1];
      const callback = eventPayload.callback;

      // Create a long message that would need chunking
      const longMessage = 'A'.repeat(5000); // Longer than 4096 chars
      await callback({ text: longMessage });

      // Verify multiple messages were sent (chunked)
      expect(mockSendMessage).toHaveBeenCalledTimes(2); // Should be split into 2 chunks
      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          msgtype: 'm.text',
          body: expect.any(String)
        })
      );
    });
  });
});