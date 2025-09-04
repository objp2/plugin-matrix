import { Action, type IAgentRuntime, type Memory, type State, logger } from '@elizaos/core';
import { MatrixService } from '../service';
import { MATRIX_MESSAGE_TYPES } from '../constants';

export const sendMessage: Action = {
  name: 'SEND_MESSAGE',
  similes: ['SEND_MATRIX_MESSAGE', 'MATRIX_SEND', 'MESSAGE_SEND'],
  description: 'Send a message to a Matrix room',
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content;
    return !!(content.text && content.roomId);
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

      const { text, roomId } = message.content;
      
      if (!text || !roomId) {
        logger.error('Missing required content: text and roomId');
        return false;
      }

      await service.client.sendMessage(roomId as string, {
        msgtype: MATRIX_MESSAGE_TYPES.TEXT,
        body: text,
      });

      logger.success(`Message sent to room ${roomId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to send message: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Send a hello message to the general room' },
      },
      {
        user: '{{user2}}',
        content: {
          text: 'I\'ll send the message now.',
          action: 'SEND_MESSAGE',
          roomId: '!general:matrix.org',
        },
      },
    ],
  ],
};

export default sendMessage;