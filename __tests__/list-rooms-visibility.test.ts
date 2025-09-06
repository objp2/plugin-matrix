import { describe, it, expect, beforeEach, vi } from 'vitest';
import matrixPlugin from '../src/index';

describe('List Rooms Action Visibility', () => {
  let mockRuntime: any;
  let mockService: any;
  let mockCallback: any;

  beforeEach(() => {
    mockCallback = vi.fn().mockResolvedValue([]);
    
    mockService = {
      client: {
        getJoinedRooms: vi.fn(),
        getRoomState: vi.fn(),
        getRoomMembers: vi.fn(),
      },
      getRoomInfo: vi.fn(),
      isRoomAllowed: vi.fn().mockReturnValue(true),
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

  describe('Agent Visibility', () => {
    it('should make room list visible to agent via callback when rooms exist', async () => {
      const listRoomsAction = matrixPlugin.actions.find(a => a.name === 'LIST_ROOMS')!;
      
      // Mock service responses
      const mockRooms = ['!room1:matrix.org', '!room2:matrix.org'];
      mockService.client.getJoinedRooms.mockResolvedValue(mockRooms);
      mockService.client.getRoomState.mockResolvedValue([
        { type: 'm.room.name', content: { name: 'Test Room 1' } }
      ]);
      mockService.client.getRoomMembers.mockResolvedValue(['@user1:matrix.org', '@user2:matrix.org']);
      mockService.getRoomInfo.mockImplementation((roomId: string) => ({
        id: roomId,
        name: roomId === '!room1:matrix.org' ? 'Test Room 1' : 'Test Room 2',
        isDirect: false,
        isEncrypted: false,
        memberCount: 2
      }));

      const message = { content: {} } as any;
      const state = { values: {}, data: {}, text: '' } as any;

      const result = await listRoomsAction.handler(
        mockRuntime, 
        message, 
        state, 
        {}, 
        mockCallback
      );

      expect(result).toBe(true);
      
      // Verify callback was called with visible room list
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      
      expect(callbackArgs).toMatchObject({
        text: expect.stringContaining('Here are all the Matrix rooms I\'ve joined (2 total):'),
        source: 'matrix'
      });
      
      // Verify the response contains room details that the agent can see
      expect(callbackArgs.text).toContain('Test Room 1');
      expect(callbackArgs.text).toContain('Test Room 2');
      expect(callbackArgs.text).toContain('!room1:matrix.org');
      expect(callbackArgs.text).toContain('!room2:matrix.org');
      expect(callbackArgs.text).toContain('Members: 2');
      expect(callbackArgs.text).toContain('Type: Group');
      expect(callbackArgs.text).toContain('Encrypted: 🔓 No');
    });

    it('should make empty room list visible to agent via callback', async () => {
      const listRoomsAction = matrixPlugin.actions.find(a => a.name === 'LIST_ROOMS')!;
      
      // Mock empty room list
      mockService.client.getJoinedRooms.mockResolvedValue([]);

      const message = { content: {} } as any;
      const state = { values: {}, data: {}, text: '' } as any;

      const result = await listRoomsAction.handler(
        mockRuntime, 
        message, 
        state, 
        {}, 
        mockCallback
      );

      expect(result).toBe(true);
      
      // Verify callback was called with empty room message
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      
      expect(callbackArgs).toMatchObject({
        text: 'I haven\'t joined any Matrix rooms yet.',
        source: 'matrix'
      });
    });

    it('should work without callback (backward compatibility)', async () => {
      const listRoomsAction = matrixPlugin.actions.find(a => a.name === 'LIST_ROOMS')!;
      
      // Mock service responses
      const mockRooms = ['!room1:matrix.org'];
      mockService.client.getJoinedRooms.mockResolvedValue(mockRooms);
      mockService.client.getRoomState.mockResolvedValue([]);
      mockService.client.getRoomMembers.mockResolvedValue(['@user1:matrix.org']);
      mockService.getRoomInfo.mockResolvedValue({
        id: '!room1:matrix.org',
        name: 'Test Room',
        isDirect: false,
        isEncrypted: false,
        memberCount: 1
      });

      const message = { content: {} } as any;
      const state = { values: {}, data: {}, text: '' } as any;

      // Call without callback - should not throw
      const result = await listRoomsAction.handler(
        mockRuntime, 
        message, 
        state, 
        {}
        // No callback parameter
      );

      expect(result).toBe(true);
      
      // Still stores data in state for agent access
      expect(state.values.rooms).toEqual(mockRooms);
      expect(state.values.roomCount).toBe(1);
      expect(state.values.roomsList).toBeDefined();
    });

    it('should store data in both state and send via callback for maximum agent visibility', async () => {
      const listRoomsAction = matrixPlugin.actions.find(a => a.name === 'LIST_ROOMS')!;
      
      // Mock service responses
      const mockRooms = ['!room1:matrix.org'];
      mockService.client.getJoinedRooms.mockResolvedValue(mockRooms);
      mockService.client.getRoomState.mockResolvedValue([]);
      mockService.client.getRoomMembers.mockResolvedValue(['@user1:matrix.org']);
      mockService.getRoomInfo.mockResolvedValue({
        id: '!room1:matrix.org',
        name: 'Test Room',
        isDirect: false,
        isEncrypted: false,
        memberCount: 1
      });

      const message = { content: {} } as any;
      const state = { values: {}, data: {}, text: '' } as any;

      const result = await listRoomsAction.handler(
        mockRuntime, 
        message, 
        state, 
        {}, 
        mockCallback
      );

      expect(result).toBe(true);
      
      // Verify data is stored in state (existing functionality)
      expect(state.values.rooms).toEqual(mockRooms);
      expect(state.values.roomCount).toBe(1);
      expect(state.values.roomsList).toBeDefined();
      expect(typeof state.values.roomsList).toBe('string');
      
      // Verify data is also in message content (existing functionality)
      expect(message.content.roomsList).toBeDefined();
      expect(typeof message.content.roomsList).toBe('string');
      
      // Verify callback was used to make data visible (new functionality)
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArgs = mockCallback.mock.calls[0][0];
      expect(callbackArgs.text).toContain('Test Room');
      expect(callbackArgs.source).toBe('matrix');
    });
  });
});