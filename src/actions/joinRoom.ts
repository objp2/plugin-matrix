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
    // Check if Matrix service is available
    const service = runtime.getService(
      MatrixService.serviceType,
    ) as MatrixService;
    if (!service?.client) {
      return false;
    }

    const content = message.content;
    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      return true;
    }

    // If content is provided, validate required parameters
    return !!(content.roomId || content.roomAlias);
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
