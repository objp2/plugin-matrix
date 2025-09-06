import {
  Action,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { MatrixService } from "../service";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

export const downloadMedia: Action = {
  name: "DOWNLOAD_MEDIA",
  similes: ["MATRIX_DOWNLOAD", "DOWNLOAD_FILE", "GET_FILE"],
  description: "Download media files from Matrix",
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    logger.info(
      "🔍 DOWNLOAD_MEDIA validate method called - this confirms validation is running",
    );

    // Check if Matrix service is available
    const service = runtime.getService(
      MatrixService.serviceType,
    ) as MatrixService;
    if (!service?.client) {
      if (service && typeof service.getServiceStatus === "function") {
        logger.debug(
          `DOWNLOAD_MEDIA unavailable - Matrix service status:`,
          service.getServiceStatus(),
        );
      } else if (service) {
        logger.debug(
          "DOWNLOAD_MEDIA unavailable - Matrix service found but client not ready",
        );
      } else {
        logger.debug("DOWNLOAD_MEDIA unavailable - Matrix service not found");
      }
      return false;
    }

    const content = message.content;
    logger.debug(`DOWNLOAD_MEDIA validation called with content:`, content);

    // If no content provided, this is likely an availability check - return true if service is ready
    if (!content || Object.keys(content).length === 0) {
      logger.debug(
        "DOWNLOAD_MEDIA: No content provided - treating as availability check",
      );
      return true;
    }

    // If content is provided, validate required parameters
    const isValid = !!(content.mxcUrl && content.outputPath);
    logger.debug(`DOWNLOAD_MEDIA: Content validation result: ${isValid}`, {
      mxcUrl: !!content.mxcUrl,
      outputPath: !!content.outputPath,
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

      const { mxcUrl, outputPath, fileName } = message.content;

      if (!mxcUrl || !outputPath) {
        logger.error("Missing required content: mxcUrl and outputPath");
        return false;
      }

      // Convert MXC URL to HTTP URL
      const httpUrl = service.client.mxcToHttp(mxcUrl as string);
      if (!httpUrl) {
        logger.error(`Failed to convert MXC URL to HTTP: ${mxcUrl}`);
        return false;
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath as string);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Download file
      await downloadFile(httpUrl, outputPath as string);

      logger.success(`Media downloaded to: ${outputPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to download media: ${error}`);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Download that image file" },
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll download the image now.",
          action: "DOWNLOAD_MEDIA",
          mxcUrl: "mxc://matrix.org/example",
          outputPath: "./downloads/image.jpg",
        },
      },
    ],
  ],
};

/**
 * Helper function to download a file from URL
 */
function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;

    const file = fs.createWriteStream(outputPath);

    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
          );
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve();
        });

        file.on("error", (error) => {
          fs.unlink(outputPath, () => {}); // Clean up partial file
          reject(error);
        });
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

export default downloadMedia;
