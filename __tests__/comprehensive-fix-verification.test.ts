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

describe('Matrix Actions Availability Complete Fix', () => {
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
        uploadContent: vi.fn().mockResolvedValue('mxc://matrix.org/example'),
      },
      addAllowedRoom: vi.fn(),
      removeAllowedRoom: vi.fn(),
    };

    mockRuntime = {
      getService: vi.fn().mockReturnValue(mockService),
    };
  });

  it('should fix the original issue where only LIST_ROOMS was available', async () => {
    // This test specifically verifies the fix for the reported issue
    const emptyMessage = { content: {} } as any;
    
    // These are the actions that were reported as not working
    const actionsThatShouldNowWork = [
      'SEND_MESSAGE',
      'SEND_IMAGE_MESSAGE', // This was the main culprit
      'JOIN_ROOM',
      'LEAVE_ROOM',
      'UPLOAD_MEDIA',
      'DOWNLOAD_MEDIA',
      'REACT_TO_MESSAGE',
      'ENABLE_ENCRYPTION'
    ];
    
    // LIST_ROOMS was already working
    const alreadyWorkingActions = ['LIST_ROOMS'];
    
    const allActions = [...actionsThatShouldNowWork, ...alreadyWorkingActions];
    
    for (const actionName of allActions) {
      const action = matrixPlugin.actions.find(a => a.name === actionName);
      expect(action).toBeDefined(`Action ${actionName} should exist`);
      
      const isAvailable = await action!.validate(mockRuntime, emptyMessage);
      expect(isAvailable).toBe(true, `${actionName} should now be available when service is ready`);
    }
  });

  it('should maintain proper parameter validation when content is provided', async () => {
    // Verify that the fix doesn't break existing parameter validation
    
    // SEND_IMAGE_MESSAGE should still validate parameters when content is provided
    const sendImageAction = matrixPlugin.actions.find(a => a.name === 'SEND_IMAGE_MESSAGE')!;
    
    // Valid content should pass
    const validMessage = {
      content: { roomId: '!room:matrix.org', imageUrl: 'https://example.com/image.jpg' }
    } as any;
    expect(await sendImageAction.validate(mockRuntime, validMessage)).toBe(true);
    
    // Invalid content should fail
    const invalidMessage = {
      content: { roomId: '!room:matrix.org' } // missing image source
    } as any;
    expect(await sendImageAction.validate(mockRuntime, invalidMessage)).toBe(false);
    
    // Missing roomId should fail
    const missingRoomMessage = {
      content: { imageUrl: 'https://example.com/image.jpg' }
    } as any;
    expect(await sendImageAction.validate(mockRuntime, missingRoomMessage)).toBe(false);
  });

  it('should correctly handle service unavailability scenarios', async () => {
    // Test with no service
    const runtimeWithoutService = {
      getService: vi.fn().mockReturnValue(null),
    };
    
    // Test with service but no client
    const runtimeWithServiceButNoClient = {
      getService: vi.fn().mockReturnValue({ client: null }),
    };
    
    const emptyMessage = { content: {} } as any;
    
    for (const action of matrixPlugin.actions) {
      // Should fail when service is not available
      expect(await action.validate(runtimeWithoutService as any, emptyMessage))
        .toBe(false, `${action.name} should not be available when service is missing`);
      
      // Should fail when client is not initialized
      expect(await action.validate(runtimeWithServiceButNoClient as any, emptyMessage))
        .toBe(false, `${action.name} should not be available when client is not initialized`);
    }
  });
});