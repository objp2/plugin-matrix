import { type IAgentRuntime, type Plugin, logger } from '@elizaos/core';

// Import actions
import sendMessage from './actions/sendMessage';
import reactToMessage from './actions/reactToMessage';
import joinRoom from './actions/joinRoom';
import uploadMedia from './actions/uploadMedia';
import downloadMedia from './actions/downloadMedia';

// Import providers
import roomStateProvider from './providers/roomState';
import userInfoProvider from './providers/userInfo';

// Import service
import { MatrixService } from './service';

// Import tests (placeholder)
// import { MatrixTestSuite } from './tests';

const matrixPlugin: Plugin = {
  name: 'matrix',
  description: 'Matrix protocol plugin for ElizaOS, enabling integration with Matrix homeservers for messaging, reactions, and media sharing',
  services: [MatrixService],
  actions: [
    sendMessage,
    reactToMessage,
    joinRoom,
    uploadMedia,
    downloadMedia,
  ],
  providers: [
    roomStateProvider,
    userInfoProvider,
  ],
  // tests: [new MatrixTestSuite()],
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    const homeserverUrl = runtime.getSetting('MATRIX_HOMESERVER_URL') as string;
    const accessToken = runtime.getSetting('MATRIX_ACCESS_TOKEN') as string;
    const userId = runtime.getSetting('MATRIX_USER_ID') as string;

    if (!homeserverUrl || homeserverUrl.trim() === '') {
      logger.warn(
        'Matrix homeserver URL not provided - Matrix plugin is loaded but will not be functional'
      );
      logger.warn(
        'To enable Matrix functionality, please provide MATRIX_HOMESERVER_URL in your .eliza/.env file'
      );
    }

    if (!accessToken || accessToken.trim() === '') {
      logger.warn(
        'Matrix access token not provided - Matrix plugin is loaded but will not be functional'
      );
      logger.warn(
        'To enable Matrix functionality, please provide MATRIX_ACCESS_TOKEN in your .eliza/.env file'
      );
    }

    if (!userId || userId.trim() === '') {
      logger.warn(
        'Matrix user ID not provided - Matrix plugin is loaded but will not be functional'
      );
      logger.warn(
        'To enable Matrix functionality, please provide MATRIX_USER_ID in your .eliza/.env file'
      );
    }

    if (homeserverUrl && accessToken && userId) {
      logger.success('Matrix plugin initialized successfully');
    }
  },
};

export default matrixPlugin;