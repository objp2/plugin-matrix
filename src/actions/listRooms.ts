import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";

export const listRooms: Action = {
  name: "LIST_ROOMS",
  similes: ["MATRIX_ROOMS", "GET_ROOMS", "SHOW_ROOMS"],
  description: "List all Matrix rooms the bot has joined",
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    return true; // No specific validation needed
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

      // Get joined rooms
      const joinedRooms = await service.client.getJoinedRooms();

      if (joinedRooms.length === 0) {
        logger.info("No rooms joined");
        return true;
      }

      const roomInfoList: string[] = [];

      for (const roomId of joinedRooms) {
        try {
          const roomInfo = await service.getRoomInfo(roomId);
          const roomState = await service.client.getRoomState(roomId);

          // Check if encrypted
          const isEncrypted = roomState.some(
            (event) => event.type === "m.room.encryption",
          );

          // Get member count
          const members = await service.client.getRoomMembers(roomId);

          const roomDetails = [
            `📍 ${roomInfo.name || roomId}`,
            `   ID: ${roomId}`,
            roomInfo.topic ? `   Topic: ${roomInfo.topic}` : "",
            `   Members: ${members.length}`,
            `   Type: ${roomInfo.isDirect ? "DM" : "Group"}`,
            `   Encrypted: ${isEncrypted ? "🔒 Yes" : "🔓 No"}`,
            `   Allowed: ${service.isRoomAllowed(roomId) ? "✅ Yes" : "❌ No"}`,
          ]
            .filter(Boolean)
            .join("\n");

          roomInfoList.push(roomDetails);
        } catch (error) {
          logger.warn(`Error getting info for room ${roomId}: ${error}`);
          roomInfoList.push(`📍 ${roomId} (Error loading details)`);
        }
      }

      const roomsText = roomInfoList.join("\n\n");
      logger.info(`Joined rooms (${joinedRooms.length}):\n${roomsText}`);

      // Store the result in memory for potential use by other actions
      if (message.content) {
        message.content.roomsList = roomsText;
      }

      return true;
    } catch (error) {
      logger.error(`Failed to list rooms: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Show me all the rooms you're in" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll list all the Matrix rooms I've joined.",
          action: "LIST_ROOMS",
        },
      },
    ],
  ],
};

export default listRooms;
