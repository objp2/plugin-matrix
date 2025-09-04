import { Action, type IAgentRuntime, type Memory, type State, logger } from '@elizaos/core';
import { MatrixService } from '../service';

export const leaveRoom: Action = {
  name: 'LEAVE_ROOM',
  similes: ['MATRIX_LEAVE', 'LEAVE_MATRIX_ROOM', 'ROOM_LEAVE', 'EXIT_ROOM'],
  description: 'Leave a Matrix room',
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content;
    return !!(content.roomId);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> => {
    try {
      const service = runtime.getService(MatrixService.serviceType) as MatrixService;
      if (!service?.client) {
        logger.error('Matrix service not available');
        return false;
      }

      const { roomId, reason } = message.content;
      
      if (!roomId) {
        logger.error('Missing required content: roomId');
        return false;
      }

      // Get room info before leaving for logging
      let roomName = roomId;
      try {
        const room = await service.client.getRoom(roomId as string);
        roomName = room?.name || roomId as string;
      } catch (error) {
        // Room info not critical for leaving
      }

      // Leave the room
      await service.client.leaveRoom(roomId as string, reason as string || 'Leaving room');
      
      // Remove from allowed rooms if it was dynamically added
      service.removeAllowedRoom(roomId as string);

      logger.success(`Successfully left room: ${roomName} (${roomId})`);
      return true;
    } catch (error) {
      logger.error(`Failed to leave room: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Leave the test room' },
      },
      {
        user: '{{user2}}',
        content: {
          text: 'I\'ll leave the test room now.',
          action: 'LEAVE_ROOM',
          roomId: '!test:matrix.org',
        },
      },
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Leave this room with a goodbye message' },
      },
      {
        user: '{{user2}}',
        content: {
          text: 'I\'ll leave with a goodbye message.',
          action: 'LEAVE_ROOM',
          roomId: '!general:matrix.org',
          reason: 'Thanks for having me! Goodbye!',
        },
      },
    ],
  ],
};

export default leaveRoom;