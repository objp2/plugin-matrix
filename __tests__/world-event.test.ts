import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixService } from '../src/service';
import { EventType } from '@elizaos/core';

// Mock the matrix-bot-sdk
vi.mock('matrix-bot-sdk', () => ({
  MatrixClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getJoinedRooms: vi.fn().mockResolvedValue(['!room1:matrix.org']),
    getRoomState: vi.fn().mockResolvedValue([
      { type: 'm.room.name', content: { name: 'Test Room' } }
    ]),
    getRoomMembers: vi.fn().mockResolvedValue([
      { userId: '@user1:matrix.org' },
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

describe('Matrix World Event Fix', () => {
  let mockRuntime: any;
  let mockEmitEvent: any;

  beforeEach(() => {
    mockEmitEvent = vi.fn();
    
    mockRuntime = {
      character: { settings: {} },
      agentId: 'test-agent-id',
      getSetting: vi.fn((key: string) => {
        const settings: Record<string, string> = {
          MATRIX_HOMESERVER_URL: 'https://matrix.org',
          MATRIX_ACCESS_TOKEN: 'syt_test_token',
          MATRIX_USER_ID: '@test:matrix.org',
        };
        return settings[key];
      }),
      registerSendHandler: vi.fn(),
      emitEvent: mockEmitEvent,
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
    };
  });

  it('should emit WORLD_CONNECTED event with proper world object', async () => {
    // Create a MatrixService instance
    const service = new MatrixService(mockRuntime);
    
    // Manually call the onReady method (it's private, so we access it via any)
    const privateService = service as any;
    await privateService.onReady();

    // Verify that emitEvent was called
    expect(mockEmitEvent).toHaveBeenCalled();
    
    // Get the event emission call
    const emitEventCalls = mockEmitEvent.mock.calls;
    const worldConnectedCall = emitEventCalls.find(call => 
      call[0].includes(EventType.WORLD_CONNECTED)
    );
    
    expect(worldConnectedCall).toBeDefined();
    
    // Verify the event payload structure
    const [eventTypes, payload] = worldConnectedCall;
    expect(eventTypes).toContain(EventType.WORLD_CONNECTED);
    
    // Verify that the payload contains a proper world object
    expect(payload).toHaveProperty('world');
    expect(payload.world).toHaveProperty('id');
    expect(payload.world).toHaveProperty('name');
    expect(payload.world).toHaveProperty('agentId');
    expect(payload.world).toHaveProperty('serverId');
    
    // Verify world object structure
    expect(payload.world.name).toBe('Test Room');
    expect(payload.world.agentId).toBe('test-agent-id');
    expect(payload.world.serverId).toBe('matrix');
    
    // Verify other required payload properties
    expect(payload).toHaveProperty('worldId');
    expect(payload).toHaveProperty('room');
    expect(payload).toHaveProperty('source', 'matrix');
  });

  it('should emit WORLD_JOINED event with proper world object', async () => {
    const service = new MatrixService(mockRuntime);
    
    // Simulate a room join event
    const mockEvent = {
      sender: '@user:matrix.org',
      room_id: '!room1:matrix.org',
    } as any;
    
    // Access private method to test room join handling
    const privateService = service as any;
    await privateService.handleRoomJoin('!room1:matrix.org', mockEvent);

    // Verify that emitEvent was called with WORLD_JOINED
    expect(mockEmitEvent).toHaveBeenCalled();
    
    // Get the event emission call
    const emitEventCalls = mockEmitEvent.mock.calls;
    const worldJoinedCall = emitEventCalls.find(call => 
      call[0].includes(EventType.WORLD_JOINED)
    );
    
    expect(worldJoinedCall).toBeDefined();
    
    // Verify the event payload structure
    const [eventTypes, payload] = worldJoinedCall;
    expect(eventTypes).toContain(EventType.WORLD_JOINED);
    
    // Verify that the payload contains a proper world object
    expect(payload).toHaveProperty('world');
    expect(payload.world).toHaveProperty('id');
    expect(payload.world).toHaveProperty('name');
    expect(payload.world).toHaveProperty('agentId');
    expect(payload.world).toHaveProperty('serverId');
    
    // Verify world object values
    expect(payload.world.name).toBe('Test Room');
    expect(payload.world.agentId).toBe('test-agent-id');
    expect(payload.world.serverId).toBe('matrix');
  });
});