import { type IAgentRuntime, type Memory, type Provider, type State, logger } from '@elizaos/core';
import { MatrixService } from '../service';

export const userInfoProvider: Provider = {
  name: 'MATRIX_USER_INFO',
  description: 'Provides information about Matrix users',
  get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<string> => {
    try {
      const service = runtime.getService(MatrixService.serviceType) as MatrixService;
      if (!service?.client) {
        return 'Matrix service not available';
      }

      const userId = message.content.userId as string;
      if (!userId) {
        return 'No user ID provided';
      }

      // Get user profile
      const profile = await service.client.getUserProfile(userId);
      
      const userInfo = [
        `User ID: ${userId}`,
        profile.displayname ? `Display Name: ${profile.displayname}` : '',
        profile.avatar_url ? `Avatar: ${profile.avatar_url}` : '',
      ].filter(Boolean).join('\n');

      return userInfo || `User ${userId} found but no additional information available`;
    } catch (error) {
      logger.error(`Error getting user info: ${error}`);
      return `Error retrieving user information: ${error}`;
    }
  },
};

export default userInfoProvider;