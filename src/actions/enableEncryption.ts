import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";

export const enableEncryption: Action = {
  name: "ENABLE_ENCRYPTION",
  similes: ["MATRIX_ENCRYPT", "START_ENCRYPTION", "ENABLE_E2EE"],
  description: "Enable end-to-end encryption for a Matrix room",
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    logger.info(
      "🔍 ENABLE_ENCRYPTION validate method called - this confirms validation is running",
    );

    // Check if Matrix service is available
    const service = runtime.getService(
      MatrixService.serviceType,
    ) as MatrixService;
    if (!service?.client) {
      if (service && typeof service.getServiceStatus === "function") {
        logger.debug(
          `ENABLE_ENCRYPTION unavailable - Matrix service status:`,
          service.getServiceStatus(),
        );
      } else if (service) {
        logger.debug(
          "ENABLE_ENCRYPTION unavailable - Matrix service found but client not ready",
        );
      } else {
        logger.debug(
          "ENABLE_ENCRYPTION unavailable - Matrix service not found",
        );
      }
      return false;
    }

    const content = message.content;
    logger.debug(`ENABLE_ENCRYPTION validation called with content:`, content);

    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      logger.debug(
        "ENABLE_ENCRYPTION: No content provided - treating as availability check",
      );
      return true;
    }

    // If content is provided, validate required parameters
    const isValid = !!content.roomId;
    logger.debug(`ENABLE_ENCRYPTION: Content validation result: ${isValid}`, {
      roomId: !!content.roomId,
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

      const { roomId } = message.content;

      if (!roomId) {
        logger.error("Missing required content: roomId");
        return false;
      }

      // Check if room is already encrypted
      const roomState = await service.client.getRoomState(roomId as string);
      const isAlreadyEncrypted = roomState.some(
        (event) => event.type === "m.room.encryption",
      );

      if (isAlreadyEncrypted) {
        logger.info(`Room ${roomId} is already encrypted`);
        return true;
      }

      // Enable encryption for the room
      await service.client.sendStateEvent(
        roomId as string,
        "m.room.encryption",
        "",
        {
          algorithm: "m.megolm.v1.aes-sha2",
          rotation_period_ms: 604800000, // 7 days
          rotation_period_msgs: 100,
        },
      );

      logger.success(`Encryption enabled for room ${roomId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to enable encryption: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Enable encryption for this room" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll enable end-to-end encryption for this room.",
          action: "ENABLE_ENCRYPTION",
          roomId: "!general:matrix.org",
        },
      },
    ],
  ],
};

export default enableEncryption;
