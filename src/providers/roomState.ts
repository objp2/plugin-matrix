import { type IAgentRuntime, type Memory, type Provider, type State, logger } from '@elizaos/core';
import { MatrixService } from '../service';

export const roomStateProvider: Provider = {
  name: 'MATRIX_ROOM_STATE',
  description: 'Provides information about Matrix room state and members',
  get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<string> => {
    try {
      const service = runtime.getService(MatrixService.serviceType) as MatrixService;
      if (!service?.client) {
        return 'Matrix service not available';
      }

      const roomId = message.content.roomId as string;
      if (!roomId) {
        return 'No room ID provided';
      }

      // Get room information
      const roomInfo = await service.getRoomInfo(roomId);
      
      // Get room members
      const members = await service.client.getRoomMembers(roomId);
      const memberCount = members.length;
      
      // Get room state
      const roomState = await service.client.getRoomState(roomId);

      // Check if room is encrypted
      const isEncrypted = roomState.some(event => event.type === 'm.room.encryption');

      const stateInfo = [
        `Room: ${roomInfo.name || roomId}`,
        `ID: ${roomId}`,
        roomInfo.topic ? `Topic: ${roomInfo.topic}` : '',
        `Members: ${memberCount}`,
        `Type: ${roomInfo.isDirect ? 'Direct Message' : 'Group Room'}`,
        `Encrypted: ${isEncrypted ? 'Yes' : 'No'}`,
        `Allowed by bot: ${service.isRoomAllowed(roomId) ? 'Yes' : 'No'}`,
      ].filter(Boolean).join('\n');

      return stateInfo;
    } catch (error) {
      logger.error(`Error getting room state: ${error}`);
      return `Error retrieving room state: ${error}`;
    }
  },
};

export default roomStateProvider;