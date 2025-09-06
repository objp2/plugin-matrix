import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";

export const reactToMessage: Action = {
  name: "REACT_TO_MESSAGE",
  similes: ["MATRIX_REACT", "ADD_REACTION", "REACT"],
  description: "React to a Matrix message with an emoji",
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    // Check if Matrix service is available
    const service = runtime.getService(
      MatrixService.serviceType,
    ) as MatrixService;
    if (!service?.client) {
      if (service && typeof service.getServiceStatus === 'function') {
        logger.debug(`REACT_TO_MESSAGE unavailable - Matrix service status:`, service.getServiceStatus());
      } else if (service) {
        logger.debug("REACT_TO_MESSAGE unavailable - Matrix service found but client not ready");
      } else {
        logger.debug("REACT_TO_MESSAGE unavailable - Matrix service not found");
      }
      return false;
    }

    const content = message.content;
    logger.debug(`REACT_TO_MESSAGE validation called with content:`, content);
    
    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      logger.debug("REACT_TO_MESSAGE: No content provided - treating as availability check");
      return true;
    }

    // If content is provided, validate required parameters
    const isValid = !!(content.eventId && content.roomId && content.reaction);
    logger.debug(`REACT_TO_MESSAGE: Content validation result: ${isValid}`, { 
      eventId: !!content.eventId, 
      roomId: !!content.roomId, 
      reaction: !!content.reaction 
    });
    return isValid;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    try {
      const service = runtime.getService(
        MatrixService.serviceType,
      ) as MatrixService;
      if (!service?.client) {
        logger.error("Matrix service not available");
        return false;
      }

      const { eventId, roomId, reaction } = message.content;

      if (!eventId || !roomId || !reaction) {
        logger.error("Missing required content: eventId, roomId, and reaction");
        return false;
      }

      // Send reaction using Matrix annotation relation
      await service.client.sendEvent(roomId as string, "m.reaction", {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: eventId,
          key: reaction,
        },
      });

      logger.success(
        `Reaction ${reaction} sent to event ${eventId} in room ${roomId}`,
      );
      return true;
    } catch (error) {
      logger.error(`Failed to send reaction: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "React with a thumbs up to that message" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll add a thumbs up reaction.",
          action: "REACT_TO_MESSAGE",
          eventId: "$example:matrix.org",
          roomId: "!general:matrix.org",
          reaction: "👍",
        },
      },
    ],
  ],
};

export default reactToMessage;
