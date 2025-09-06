import { describe, it, expect, beforeEach, vi } from 'vitest';
import matrixPlugin from '../src/index';
import { MatrixService } from '../src/service';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
    joinRoom: vi.fn().mockResolvedValue('!room:matrix.org'),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    getJoinedRooms: vi.fn().mockResolvedValue(['!room1:matrix.org']),
    getRoomState: vi.fn().mockResolvedValue([]),
    getUserId: vi.fn().mockResolvedValue('@bot:matrix.org'),
    on: vi.fn(),
  })),
  SimpleFsStorageProvider: vi.fn(),
  AutojoinRoomsMixin: {
    setupOnClient: vi.fn(),
  },
}));

describe('Matrix Actions Availability Fix', () => {
  let mockRuntime: any;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      client: {
        sendMessage: vi.fn().mockResolvedValue('$event:matrix.org'),
        joinRoom: vi.fn().mockResolvedValue('!room:matrix.org'),
        leaveRoom: vi.fn().mockResolvedValue(undefined),
        sendEvent: vi.fn().mockResolvedValue('$reaction:matrix.org'),
        getJoinedRooms: vi.fn().mockResolvedValue(['!room1:matrix.org']),
      },
      addAllowedRoom: vi.fn(),
      removeAllowedRoom: vi.fn(),
    };

    mockRuntime = {
      getService: vi.fn().mockReturnValue(mockService),
    };
  });

  it('should make all Matrix actions available when service is ready', async () => {
    const actionNames = matrixPlugin.actions.map(action => action.name);
    
    // Verify all expected actions are present
    expect(actionNames).toContain('LIST_ROOMS');
    expect(actionNames).toContain('JOIN_ROOM');
    expect(actionNames).toContain('LEAVE_ROOM');
    expect(actionNames).toContain('SEND_MESSAGE');
    expect(actionNames).toContain('UPLOAD_MEDIA');
    expect(actionNames).toContain('DOWNLOAD_MEDIA');
    expect(actionNames).toContain('REACT_TO_MESSAGE');
    expect(actionNames).toContain('ENABLE_ENCRYPTION');

    // Test that all actions validate as available when service is ready but no content provided
    const emptyMessage = { content: {} } as any;
    
    for (const action of matrixPlugin.actions) {
      const isAvailable = await action.validate(mockRuntime, emptyMessage);
      console.log(`Action ${action.name}: ${isAvailable} (service: ${!!mockRuntime.getService()}, client: ${!!mockRuntime.getService()?.client})`);
      expect(isAvailable).toBe(true, `${action.name} should be available when service is ready`);
    }
  });

  it('should make no actions available when Matrix service is not ready', async () => {
    const runtimeWithoutService = {
      getService: vi.fn().mockReturnValue(null),
    };

    const emptyMessage = { content: {} } as any;
    
    for (const action of matrixPlugin.actions) {
      const isAvailable = await action.validate(runtimeWithoutService as any, emptyMessage);
      expect(isAvailable).toBe(false, `${action.name} should not be available when service is not ready`);
    }
  });

  it('should make no actions available when Matrix client is not initialized', async () => {
    const runtimeWithServiceButNoClient = {
      getService: vi.fn().mockReturnValue({ client: null }),
    };

    const emptyMessage = { content: {} } as any;
    
    for (const action of matrixPlugin.actions) {
      const isAvailable = await action.validate(runtimeWithServiceButNoClient as any, emptyMessage);
      expect(isAvailable).toBe(false, `${action.name} should not be available when client is not initialized`);
    }
  });

  it('should validate content parameters when provided', async () => {
    // Test SEND_MESSAGE with valid content
    const sendMessageAction = matrixPlugin.actions.find(a => a.name === 'SEND_MESSAGE')!;
    const validSendMessage = {
      content: { text: 'Hello', roomId: '!room:matrix.org' }
    } as any;
    expect(await sendMessageAction.validate(mockRuntime, validSendMessage)).toBe(true);

    // Test SEND_MESSAGE with invalid content
    const invalidSendMessage = {
      content: { roomId: '!room:matrix.org' } // missing text
    } as any;
    expect(await sendMessageAction.validate(mockRuntime, invalidSendMessage)).toBe(false);

    // Test JOIN_ROOM with valid content
    const joinRoomAction = matrixPlugin.actions.find(a => a.name === 'JOIN_ROOM')!;
    const validJoinRoom = {
      content: { roomId: '!room:matrix.org' }
    } as any;
    expect(await joinRoomAction.validate(mockRuntime, validJoinRoom)).toBe(true);

    // Test UPLOAD_MEDIA with valid content
    const uploadMediaAction = matrixPlugin.actions.find(a => a.name === 'UPLOAD_MEDIA')!;
    const validUploadMedia = {
      content: { filePath: './test.jpg', roomId: '!room:matrix.org' }
    } as any;
    expect(await uploadMediaAction.validate(mockRuntime, validUploadMedia)).toBe(true);

    // Test UPLOAD_MEDIA with invalid content
    const invalidUploadMedia = {
      content: { filePath: './test.jpg' } // missing roomId
    } as any;
    expect(await uploadMediaAction.validate(mockRuntime, invalidUploadMedia)).toBe(false);
  });
});