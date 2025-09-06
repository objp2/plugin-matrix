import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";

export const joinRoom: Action = {
  name: "JOIN_ROOM",
  similes: ["MATRIX_JOIN", "JOIN_MATRIX_ROOM", "ROOM_JOIN"],
  description: "Join a Matrix room",
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    logger.info(
      "🔍 JOIN_ROOM validate method called - this confirms validation is running",
    );

    // Check if Matrix service is available
    const service = runtime.getService(
      MatrixService.serviceType,
    ) as MatrixService;
    if (!service?.client) {
      if (service && typeof service.getServiceStatus === "function") {
        logger.debug(
          `JOIN_ROOM unavailable - Matrix service status:`,
          service.getServiceStatus(),
        );
      } else if (service) {
        logger.debug(
          "JOIN_ROOM unavailable - Matrix service found but client not ready",
        );
      } else {
        logger.debug("JOIN_ROOM unavailable - Matrix service not found");
      }
      return false;
    }

    const content = message.content;
    logger.debug(`JOIN_ROOM validation called with content:`, content);

    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      logger.debug(
        "JOIN_ROOM: No content provided - treating as availability check",
      );
      return true;
    }

    // If content is provided, validate required parameters
    const isValid = !!(content.roomId || content.roomAlias);
    logger.debug(`JOIN_ROOM: Content validation result: ${isValid}`, {
      roomId: !!content.roomId,
      roomAlias: !!content.roomAlias,
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

      const { roomId, roomAlias } = message.content;
      const roomIdentifier = roomId || roomAlias;

      if (!roomIdentifier) {
        logger.error("Missing required content: roomId or roomAlias");
        return false;
      }

      const joinedRoomId = await service.client.joinRoom(
        roomIdentifier as string,
      );

      // Add to allowed rooms if using restrictions
      service.addAllowedRoom(joinedRoomId);

      logger.success(`Successfully joined room ${joinedRoomId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to join room: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Join the general room" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll join the general room now.",
          action: "JOIN_ROOM",
          roomId: "!general:matrix.org",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Join #random:matrix.org" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll join the random room.",
          action: "JOIN_ROOM",
          roomAlias: "#random:matrix.org",
        },
      },
    ],
  ],
};

export default joinRoom;
