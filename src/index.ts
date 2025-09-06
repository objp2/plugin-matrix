import { type IAgentRuntime, type Plugin, logger } from "@elizaos/core";

// Import actions
import sendMessage from "./actions/sendMessage";
import sendImageMessage from "./actions/sendImageMessage";
import reactToMessage from "./actions/reactToMessage";
import joinRoom from "./actions/joinRoom";
import leaveRoom from "./actions/leaveRoom";
import uploadMedia from "./actions/uploadMedia";
import downloadMedia from "./actions/downloadMedia";
import enableEncryption from "./actions/enableEncryption";
import listRooms from "./actions/listRooms";

// Import providers
import roomStateProvider from "./providers/roomState";
import userInfoProvider from "./providers/userInfo";

// Import service
import { MatrixService } from "./service";

// Import tests (placeholder)
// import { MatrixTestSuite } from './tests';

const matrixPlugin: Plugin = {
  name: "matrix",
  description:
    "Matrix protocol plugin for ElizaOS, enabling integration with Matrix homeservers for messaging, reactions, and media sharing",
  services: [MatrixService],
  actions: [
    sendMessage,
    sendImageMessage,
    reactToMessage,
    joinRoom,
    leaveRoom,
    uploadMedia,
    downloadMedia,
    enableEncryption,
    listRooms,
  ],
  providers: [roomStateProvider, userInfoProvider],
  // tests: [new MatrixTestSuite()],
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info("Matrix plugin init called - starting initialization");
    
    const homeserverUrl = runtime.getSetting("MATRIX_HOMESERVER_URL") as string;
    const accessToken = runtime.getSetting("MATRIX_ACCESS_TOKEN") as string;
    const userId = runtime.getSetting("MATRIX_USER_ID") as string;

    logger.debug("Matrix plugin actions registered");
    logger.debug(`Action count: ${matrixPlugin.actions?.length || 0}`);
    logger.debug(`Action names: ${(matrixPlugin.actions?.map(a => a.name) || []).join(', ')}`);

    if (!homeserverUrl || homeserverUrl.trim() === "") {
      logger.warn(
        "Matrix homeserver URL not provided - Matrix plugin is loaded but will not be functional",
      );
      logger.warn(
        "To enable Matrix functionality, please provide MATRIX_HOMESERVER_URL in your .eliza/.env file",
      );
    }

    if (!accessToken || accessToken.trim() === "") {
      logger.warn(
        "Matrix access token not provided - Matrix plugin is loaded but will not be functional",
      );
      logger.warn(
        "To enable Matrix functionality, please provide MATRIX_ACCESS_TOKEN in your .eliza/.env file",
      );
    }

    if (!userId || userId.trim() === "") {
      logger.warn(
        "Matrix user ID not provided - Matrix plugin is loaded but will not be functional",
      );
      logger.warn(
        "To enable Matrix functionality, please provide MATRIX_USER_ID in your .eliza/.env file",
      );
    }

    if (homeserverUrl && accessToken && userId) {
      logger.success("Matrix plugin initialized successfully");
    }

    // Add debugging to check service registration
    setTimeout(async () => {
      try {
        const service = runtime.getService(MatrixService.serviceType) as MatrixService;
        if (service) {
          const status = service.getServiceStatus();
          logger.info("Matrix service found in runtime after init");
          logger.info(`Service ready: ${status.isReady}, has client: ${status.hasClient}`);
        } else {
          logger.warn(`Matrix service NOT found in runtime after init - service type: ${MatrixService.serviceType}`);
        }
      } catch (error) {
        logger.error("Error checking Matrix service after init:", String(error));
      }
    }, 1000);
  },
};

export default matrixPlugin;
