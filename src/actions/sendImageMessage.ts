import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";
import { MATRIX_MESSAGE_TYPES } from "../constants";

export const sendImageMessage: Action = {
  name: "SEND_IMAGE_MESSAGE",
  similes: [
    "SEND_MATRIX_IMAGE",
    "MATRIX_SEND_IMAGE",
    "IMAGE_SEND",
    "SHARE_IMAGE",
  ],
  description:
    "Send an image message to a Matrix room with text and image attachment",
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    logger.info(
      "🔍 SEND_IMAGE_MESSAGE validate method called - this confirms validation is running",
    );

    // Check if Matrix service is available
    const service = runtime.getService(
      MatrixService.serviceType,
    ) as MatrixService;
    if (!service?.client) {
      if (service && typeof service.getServiceStatus === "function") {
        logger.debug(
          `SEND_IMAGE_MESSAGE unavailable - Matrix service status:`,
          service.getServiceStatus(),
        );
      } else if (service) {
        logger.debug(
          "SEND_IMAGE_MESSAGE unavailable - Matrix service found but client not ready",
        );
      } else {
        logger.debug(
          "SEND_IMAGE_MESSAGE unavailable - Matrix service not found",
        );
      }
      return false;
    }

    const content = message.content;
    logger.debug(`SEND_IMAGE_MESSAGE validation called with content:`, content);

    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      logger.debug(
        "SEND_IMAGE_MESSAGE: No content provided - treating as availability check",
      );
      return true;
    }

    // If content is provided, validate required parameters
    const isValid = !!(
      content.roomId &&
      (content.imageUrl || content.imageData || content.filePath)
    );
    logger.debug(`SEND_IMAGE_MESSAGE: Content validation result: ${isValid}`, {
      roomId: !!content.roomId,
      imageUrl: !!content.imageUrl,
      imageData: !!content.imageData,
      filePath: !!content.filePath,
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

      const {
        text,
        roomId,
        imageUrl,
        imageData,
        filePath,
        fileName,
        mimeType,
      } = message.content;

      if (!roomId) {
        logger.error("Missing required content: roomId");
        return false;
      }

      if (!imageUrl && !imageData && !filePath) {
        logger.error(
          "Missing image content: must provide imageUrl, imageData, or filePath",
        );
        return false;
      }

      // If text is provided, send it first
      if (text) {
        await service.client.sendMessage(roomId as string, {
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: text,
        });
      }

      // Handle different image sources
      let imageBuffer: Buffer;
      let detectedFileName = (fileName as string) || "image";
      let detectedMimeType = mimeType as string;

      if (imageData) {
        // Handle base64 data URL or raw base64
        const base64Data = imageData.toString().includes("base64,")
          ? imageData.toString().split("base64,")[1]
          : imageData.toString();
        imageBuffer = Buffer.from(base64Data, "base64");

        // Extract MIME type from data URL if present
        if (imageData.toString().startsWith("data:")) {
          const mimeMatch = imageData.toString().match(/data:([^;]+)/);
          if (mimeMatch) {
            detectedMimeType = mimeMatch[1];
          }
        }
      } else if (filePath) {
        // Handle file path (reuse uploadMedia logic)
        const fs = await import("fs");
        const path = await import("path");

        const absolutePath = path.resolve(filePath as string);
        if (!fs.existsSync(absolutePath)) {
          logger.error(`File not found: ${absolutePath}`);
          return false;
        }

        imageBuffer = fs.readFileSync(absolutePath);
        detectedFileName = (fileName as string) || path.basename(absolutePath);

        // Detect MIME type if not provided
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
            case ".webp":
              detectedMimeType = "image/webp";
              break;
            default:
              detectedMimeType = "image/jpeg";
          }
        }
      } else if (imageUrl) {
        // Handle HTTP/HTTPS URL
        const https = await import("https");
        const http = await import("http");

        imageBuffer = await new Promise<Buffer>((resolve, reject) => {
          const client = imageUrl.toString().startsWith("https:")
            ? https
            : http;

          client
            .get(imageUrl as string, (response) => {
              if (response.statusCode !== 200) {
                reject(
                  new Error(
                    `HTTP ${response.statusCode}: ${response.statusMessage}`,
                  ),
                );
                return;
              }

              const chunks: Buffer[] = [];
              response.on("data", (chunk) => chunks.push(chunk));
              response.on("end", () => resolve(Buffer.concat(chunks)));
              response.on("error", reject);
            })
            .on("error", reject);
        });

        // Try to detect MIME type from response headers or URL
        if (!detectedMimeType) {
          const urlLower = imageUrl.toString().toLowerCase();
          if (urlLower.includes(".jpg") || urlLower.includes(".jpeg")) {
            detectedMimeType = "image/jpeg";
          } else if (urlLower.includes(".png")) {
            detectedMimeType = "image/png";
          } else if (urlLower.includes(".gif")) {
            detectedMimeType = "image/gif";
          } else if (urlLower.includes(".webp")) {
            detectedMimeType = "image/webp";
          } else {
            detectedMimeType = "image/jpeg";
          }
        }
      }

      // Default MIME type if still not detected
      if (!detectedMimeType) {
        detectedMimeType = "image/jpeg";
      }

      // Upload image to Matrix
      const mxcUrl = await service.client.uploadContent(
        imageBuffer!,
        detectedMimeType,
        detectedFileName,
      );

      // Send image message
      const messageContent = {
        msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
        body: detectedFileName,
        url: mxcUrl,
        info: {
          mimetype: detectedMimeType,
          size: imageBuffer!.length,
        },
      };

      await service.client.sendMessage(roomId as string, messageContent);

      logger.success(`Image sent to room ${roomId}: ${mxcUrl}`);
      return true;
    } catch (error) {
      logger.error(`Failed to send image message: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Send this image to the general room" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll send the image now.",
          action: "SEND_IMAGE_MESSAGE",
          roomId: "!general:matrix.org",
          imageUrl: "https://example.com/image.jpg",
          fileName: "example.jpg",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Share this photo with the team" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "Sharing the photo with the team.",
          action: "SEND_IMAGE_MESSAGE",
          roomId: "!team:matrix.org",
          filePath: "./photo.png",
          fileName: "team-photo.png",
        },
      },
    ],
  ],
};

export default sendImageMessage;
