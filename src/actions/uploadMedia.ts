import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";
import { MATRIX_MESSAGE_TYPES } from "../constants";
import * as fs from "fs";
import * as path from "path";

export const uploadMedia: Action = {
  name: "UPLOAD_MEDIA",
  similes: ["MATRIX_UPLOAD", "UPLOAD_FILE", "SEND_FILE"],
  description: "Upload and send media files to a Matrix room",
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
        logger.debug(`UPLOAD_MEDIA unavailable - Matrix service status:`, service.getServiceStatus());
      } else if (service) {
        logger.debug("UPLOAD_MEDIA unavailable - Matrix service found but client not ready");
      } else {
        logger.debug("UPLOAD_MEDIA unavailable - Matrix service not found");
      }
      return false;
    }

    const content = message.content;
    logger.debug(`UPLOAD_MEDIA validation called with content:`, content);
    
    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      logger.debug("UPLOAD_MEDIA: No content provided - treating as availability check");
      return true;
    }

    // If content is provided, validate required parameters
    const isValid = !!(content.filePath && content.roomId);
    logger.debug(`UPLOAD_MEDIA: Content validation result: ${isValid}`, { filePath: !!content.filePath, roomId: !!content.roomId });
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

      const { filePath, roomId, fileName, mimeType } = message.content;

      if (!filePath || !roomId) {
        logger.error("Missing required content: filePath and roomId");
        return false;
      }

      const absolutePath = path.resolve(filePath as string);
      if (!fs.existsSync(absolutePath)) {
        logger.error(`File not found: ${absolutePath}`);
        return false;
      }

      // Read file
      const fileBuffer = fs.readFileSync(absolutePath);
      const detectedFileName = fileName || path.basename(absolutePath);

      // Detect MIME type if not provided
      let detectedMimeType = mimeType as string;
      if (!detectedMimeType) {
        const ext = path.extname(absolutePath).toLowerCase();
        switch (ext) {
          case ".jpg":
          case ".jpeg":
            detectedMimeType = "image/jpeg";
            break;
          case ".png":
            detectedMimeType = "image/png";
            break;
          case ".gif":
            detectedMimeType = "image/gif";
            break;
          case ".mp4":
            detectedMimeType = "video/mp4";
            break;
          case ".mp3":
            detectedMimeType = "audio/mpeg";
            break;
          case ".pdf":
            detectedMimeType = "application/pdf";
            break;
          default:
            detectedMimeType = "application/octet-stream";
        }
      }

      // Upload file to Matrix
      const mxcUrl = await service.client.uploadContent(
        fileBuffer,
        detectedMimeType,
        detectedFileName,
      );

      // Determine message type based on MIME type
      let msgtype = MATRIX_MESSAGE_TYPES.FILE;
      if (detectedMimeType.startsWith("image/")) {
        msgtype = MATRIX_MESSAGE_TYPES.IMAGE;
      } else if (detectedMimeType.startsWith("audio/")) {
        msgtype = MATRIX_MESSAGE_TYPES.AUDIO;
      } else if (detectedMimeType.startsWith("video/")) {
        msgtype = MATRIX_MESSAGE_TYPES.VIDEO;
      }

      // Send message with file
      const messageContent: any = {
        msgtype,
        body: detectedFileName,
        url: mxcUrl,
        info: {
          mimetype: detectedMimeType,
          size: fileBuffer.length,
        },
      };

      // Add image-specific info
      if (msgtype === MATRIX_MESSAGE_TYPES.IMAGE) {
        // For images, we could add width/height info here
        messageContent.info.w = undefined; // Would need image processing library
        messageContent.info.h = undefined;
      }

      await service.client.sendMessage(roomId as string, messageContent);

      logger.success(`Media uploaded and sent to room ${roomId}: ${mxcUrl}`);
      return true;
    } catch (error) {
      logger.error(`Failed to upload media: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Upload the image file to the room" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll upload the image now.",
          action: "UPLOAD_MEDIA",
          filePath: "./image.jpg",
          roomId: "!general:matrix.org",
        },
      },
    ],
  ],
};

export default uploadMedia;
