import {
  ChannelType,
  type Character,
  type Content,
  ContentType,
  EventType,
  type HandlerCallback,
  type IAgentRuntime,
  type Media,
  type Memory,
  Role,
  Service,
  type TargetInfo,
  type UUID,
  type World,
  createUniqueUuid,
  logger,
} from "@elizaos/core";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
  MatrixEvent,
  MessageEvent,
  MessageEventContent,
  RoomEvent,
  MembershipEvent,
  RustSdkCryptoStorageProvider,
} from "matrix-bot-sdk";
import * as https from "https";
import * as http from "http";
import {
  MATRIX_SERVICE_NAME,
  MATRIX_EVENT_TYPES,
  MATRIX_MESSAGE_TYPES,
  MATRIX_MEMBERSHIP,
} from "./constants";
import {
  MatrixEventTypes,
  type IMatrixService,
  type MatrixSettings,
  type MatrixRoom,
} from "./types";
import { validateMatrixConfig } from "./environment";

/**
 * MatrixService class for interacting with Matrix protocol.
 * @extends Service
 * @implements IMatrixService
 */
export class MatrixService extends Service implements IMatrixService {
  static serviceType: string = MATRIX_SERVICE_NAME;
  capabilityDescription =
    "The agent is able to send and receive messages on Matrix";
  client: MatrixClient | null;
  character: Character;
  private matrixSettings: MatrixSettings;
  private allowedRoomIds?: string[];
  private dynamicRoomIds: Set<string> = new Set();

  constructor(runtime: IAgentRuntime) {
    super(runtime);

    logger.info("🚀 MatrixService constructor called - service is being initialized");

    this.matrixSettings = {};
    if (this.runtime.character.settings?.matrix) {
      this.matrixSettings = this.runtime.character.settings
        .matrix as MatrixSettings;
    }

    this.character = runtime.character;

    // Parse MATRIX_ROOM_IDS env var to restrict the bot to specific rooms
    const roomIdsRaw = runtime.getSetting("MATRIX_ROOM_IDS") as
      | string
      | undefined;
    if (roomIdsRaw && roomIdsRaw.trim()) {
      this.allowedRoomIds = roomIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    logger.info("Initializing Matrix service...");

    try {
      // Check for required environment variables first
      const homeserverUrl = runtime.getSetting("MATRIX_HOMESERVER_URL") as string;
      const accessToken = runtime.getSetting("MATRIX_ACCESS_TOKEN") as string;
      const userId = runtime.getSetting("MATRIX_USER_ID") as string;

      logger.debug("Matrix configuration check:", {
        homeserverUrl: homeserverUrl ? `${homeserverUrl.substring(0, 20)}...` : "[NOT SET]",
        accessToken: accessToken ? `[PRESENT, length=${accessToken.length}]` : "[NOT SET]",
        userId: userId || "[NOT SET]",
      });

      // Validate environment configuration
      const config = validateMatrixConfig({
        MATRIX_HOMESERVER_URL: homeserverUrl,
        MATRIX_ACCESS_TOKEN: accessToken,
        MATRIX_USER_ID: userId,
        MATRIX_ROOM_IDS: runtime.getSetting("MATRIX_ROOM_IDS"),
        MATRIX_ENCRYPTION_ENABLED: runtime.getSetting(
          "MATRIX_ENCRYPTION_ENABLED",
        ),
      });

      logger.success("Matrix configuration validation passed");

      if (
        !config.MATRIX_ACCESS_TOKEN ||
        config.MATRIX_ACCESS_TOKEN.trim() === ""
      ) {
        logger.error(
          "Matrix access token not provided - Matrix actions will be unavailable",
        );
        logger.error(
          "To fix this: Set MATRIX_ACCESS_TOKEN environment variable with a valid Matrix access token",
        );
        this.client = null;
        return;
      }

      // Initialize Matrix client with proper encryption setup
      const storage = new SimpleFsStorageProvider("./matrix-storage.json");
      let cryptoStore = null;

      // Set up encryption if enabled
      if (config.MATRIX_ENCRYPTION_ENABLED) {
        try {
          cryptoStore = new RustSdkCryptoStorageProvider(
            "./matrix-crypto-store",
          );
          logger.info("Matrix encryption enabled with crypto storage provider");
        } catch (error) {
          logger.warn(`Failed to set up encryption storage provider: ${error}`);
          logger.warn("Continuing without encryption support");
        }
      }

      logger.info(`Creating Matrix client for ${config.MATRIX_USER_ID} on ${config.MATRIX_HOMESERVER_URL}`);

      this.client = new MatrixClient(
        config.MATRIX_HOMESERVER_URL,
        config.MATRIX_ACCESS_TOKEN,
        storage,
        cryptoStore,
      );

      // Enable auto-join for room invites
      AutojoinRoomsMixin.setupOnClient(this.client);

      this.setupEventListeners();
      this.registerSendHandler();

      logger.info("Starting Matrix client...");

      // Start the client
      this.client
        .start()
        .then(async () => {
          logger.success("Matrix client started successfully - Matrix actions are now available");

          // Initialize encryption if enabled
          if (config.MATRIX_ENCRYPTION_ENABLED) {
            await this.initializeEncryption();
          }

          this.onReady();
        })
        .catch((error) => {
          logger.error(
            `Failed to start Matrix client: ${error instanceof Error ? error.message : String(error)}`,
          );
          logger.error(
            "Matrix actions will be unavailable. Common causes:",
          );
          logger.error("- Invalid MATRIX_ACCESS_TOKEN");
          logger.error("- Network connectivity issues");
          logger.error("- Invalid MATRIX_HOMESERVER_URL");
          logger.error("- Homeserver authentication problems");
          this.client = null;
        });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Matrix configuration validation failed")) {
        logger.error(`Matrix configuration error: ${error.message}`);
        logger.error("Matrix actions will be unavailable. Please check your environment variables:");
        logger.error("- MATRIX_HOMESERVER_URL: Must be a valid URL (e.g., https://matrix.org)");
        logger.error("- MATRIX_ACCESS_TOKEN: Must be a valid Matrix access token");
        logger.error("- MATRIX_USER_ID: Must be in format @username:homeserver.tld");
      } else {
        runtime.logger.error(
          `Error initializing Matrix client: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.client = null;
    }
  }

  /**
   * Check if the Matrix service is ready for use
   * @returns true if the service is ready, false otherwise
   */
  public isReady(): boolean {
    return this.client !== null;
  }

  /**
   * Get detailed service status for debugging
   * @returns object with service status information
   */
  public getServiceStatus() {
    return {
      isReady: this.isReady(),
      hasClient: !!this.client,
      allowedRooms: this.allowedRoomIds?.length || 0,
      dynamicRooms: this.dynamicRoomIds.size,
    };
  }

  static async start(runtime: IAgentRuntime) {
    const service = new MatrixService(runtime);
    return service;
  }

  /**
   * Get room information using available SDK methods
   * This replaces the non-existent getRoom method
   */
  public async getRoomInfo(roomId: string): Promise<MatrixRoom> {
    if (!this.client) {
      throw new Error("Matrix client not available");
    }

    try {
      // Get basic room state
      const roomState = await this.client.getRoomState(roomId);

      // Extract room name
      const nameEvent = roomState.find((event) => event.type === "m.room.name");
      const name = nameEvent?.content?.name;

      // Extract room topic
      const topicEvent = roomState.find(
        (event) => event.type === "m.room.topic",
      );
      const topic = topicEvent?.content?.topic;

      // Extract room avatar
      const avatarEvent = roomState.find(
        (event) => event.type === "m.room.avatar",
      );
      const avatarUrl = avatarEvent?.content?.url;

      // Check if room is encrypted
      const encryptionEvent = roomState.find(
        (event) => event.type === "m.room.encryption",
      );
      const isEncrypted = !!encryptionEvent;

      // Get room members to check if it's a DM and get member count
      const members = await this.client.getRoomMembers(roomId);
      const memberCount = members.length;

      // Check if it's a direct message room (exactly 2 members)
      let isDirect = false;
      if (memberCount === 2) {
        // Additional check: look for m.direct account data
        try {
          const accountData = await this.client.getAccountData("m.direct");
          if (accountData) {
            // Check if this room is listed in any user's direct rooms
            const directRooms = Object.values(accountData).flat() as string[];
            isDirect = directRooms.includes(roomId);
          }
        } catch (error) {
          // If we can't get account data, fall back to member count check
          isDirect = memberCount === 2;
        }
      }

      return {
        id: roomId,
        name,
        topic,
        isDirect,
        isEncrypted,
        memberCount,
        avatarUrl,
      };
    } catch (error) {
      this.runtime.logger.error(
        `Failed to get room info for ${roomId}: ${error}`,
      );
      // Return minimal room info on error
      return {
        id: roomId,
        isDirect: false,
        isEncrypted: false,
        memberCount: 0,
      };
    }
  }

  /**
   * Check if a room is a direct message room
   */
  private async isDirectRoom(roomId: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      // First check member count
      const members = await this.client.getRoomMembers(roomId);
      if (members.length !== 2) {
        return false;
      }

      // Check m.direct account data
      try {
        const accountData = await this.client.getAccountData("m.direct");
        if (accountData) {
          const directRooms = Object.values(accountData).flat() as string[];
          return directRooms.includes(roomId);
        }
      } catch (error) {
        // If we can't get account data, assume it's direct if only 2 members
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize encryption for the Matrix client
   */
  private async initializeEncryption(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      logger.info("Initializing Matrix end-to-end encryption...");

      // Check if crypto is available on the client
      const clientWithCrypto = this.client as any;
      if (clientWithCrypto.crypto) {
        logger.info("Crypto client detected - encryption should be functional");

        // The RustSdkCryptoStorageProvider and CryptoClient should handle
        // automatic decryption of encrypted messages
      } else {
        logger.warn("No crypto client found - encryption may not be available");
      }

      logger.success("Matrix encryption initialized successfully");
    } catch (error) {
      logger.error(`Failed to initialize encryption: ${error}`);
    }
  }

  /**
   * Registers the send handler with the runtime.
   * @private
   */
  private registerSendHandler(): void {
    if (this.runtime) {
      this.runtime.registerSendHandler(
        "matrix",
        this.handleSendMessage.bind(this),
      );
    }
  }

  /**
   * The SendHandlerFunction implementation for Matrix.
   */
  async handleSendMessage(
    runtime: IAgentRuntime,
    target: TargetInfo,
    content: Content,
  ): Promise<void> {
    if (!this.client) {
      runtime.logger.error("[Matrix SendHandler] Client not ready.");
      throw new Error("Matrix client is not ready.");
    }

    // Skip sending if room restrictions are set and target room is not allowed
    if (
      target.channelId &&
      this.allowedRoomIds &&
      !this.isRoomAllowed(target.channelId)
    ) {
      runtime.logger.warn(
        `[Matrix SendHandler] Room ${target.channelId} is not in allowed rooms, skipping send.`,
      );
      return;
    }

    try {
      let targetRoomId: string;

      if (target.channelId) {
        targetRoomId = target.channelId;
      } else if (target.entityId) {
        // For DMs, create or get existing DM room
        const userId = target.entityId as string;
        targetRoomId = await this.getOrCreateDMRoom(userId);
      } else {
        throw new Error("Matrix SendHandler requires channelId or entityId.");
      }

      if (content.text) {
        // Split message if longer than Matrix limit (65536 chars, but we'll use a smaller limit)
        const chunks = this.splitMessage(content.text, 4096);
        for (const chunk of chunks) {
          await this.client.sendMessage(targetRoomId, {
            msgtype: MATRIX_MESSAGE_TYPES.TEXT,
            body: chunk,
          });
        }
      }

      // Handle attachments (images, files, etc.)
      if (content.attachments && content.attachments.length > 0) {
        for (const attachment of content.attachments) {
          try {
            if (attachment.contentType === "IMAGE" && attachment.url) {
              // Handle image attachments
              let imageBuffer: Buffer;

              if (attachment.url.startsWith("data:")) {
                // Handle base64 data URL
                const base64Data = attachment.url.split("base64,")[1];
                imageBuffer = Buffer.from(base64Data, "base64");
              } else {
                // Handle HTTP/HTTPS URL - download the image
                const https = await import("https");
                const http = await import("http");

                imageBuffer = await new Promise<Buffer>((resolve, reject) => {
                  const client = attachment.url.startsWith("https:")
                    ? https
                    : http;

                  client
                    .get(attachment.url, (response) => {
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
              }

              // Detect MIME type
              let mimeType = "image/jpeg";
              if (attachment.url.includes("data:")) {
                const mimeMatch = attachment.url.match(/data:([^;]+)/);
                if (mimeMatch) {
                  mimeType = mimeMatch[1];
                }
              }

              // Upload to Matrix
              const mxcUrl = await this.client.uploadContent(
                imageBuffer,
                mimeType,
                attachment.title || "image",
              );

              // Send image message
              await this.client.sendMessage(targetRoomId, {
                msgtype: MATRIX_MESSAGE_TYPES.IMAGE,
                body: attachment.title || "image",
                url: mxcUrl,
                info: {
                  mimetype: mimeType,
                  size: imageBuffer.length,
                },
              });

              runtime.logger.success(
                `[Matrix SendHandler] Sent image attachment: ${attachment.title}`,
              );
            }
            // Handle other attachment types (files, audio, video) if needed
          } catch (attachmentError) {
            runtime.logger.error(
              `[Matrix SendHandler] Failed to send attachment: ${attachmentError}`,
            );
          }
        }
      }

      if (
        !content.text &&
        (!content.attachments || content.attachments.length === 0)
      ) {
        runtime.logger.warn(
          "[Matrix SendHandler] No content provided to send.",
        );
      }
    } catch (error) {
      runtime.logger.error(
        `[Matrix SendHandler] Error sending message: ${error instanceof Error ? error.message : String(error)}`,
        { target, content },
      );
      throw error;
    }
  }

  /**
   * Helper function to split a string into chunks of a maximum length.
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = "";
    const lines = text.split("\n");

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= maxLength) {
        currentChunk += (currentChunk ? "\n" : "") + line;
      } else {
        if (currentChunk) chunks.push(currentChunk);

        if (line.length > maxLength) {
          for (let i = 0; i < line.length; i += maxLength) {
            chunks.push(line.substring(i, i + maxLength));
          }
          currentChunk = "";
        } else {
          currentChunk = line;
        }
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  /**
   * Get or create a DM room with a user
   */
  private async getOrCreateDMRoom(userId: string): Promise<string> {
    if (!this.client) {
      throw new Error("Matrix client not available");
    }

    try {
      // Try to find existing DM room
      const rooms = await this.client.getJoinedRooms();
      for (const roomId of rooms) {
        if (await this.isDirectRoom(roomId)) {
          const members = await this.client.getRoomMembers(roomId);
          if (
            members.length === 2 &&
            members.some((m) => m.userId === userId)
          ) {
            return roomId;
          }
        }
      }

      // Create new DM room
      const roomId = await this.client.createRoom({
        invite: [userId],
        is_direct: true,
        preset: "trusted_private_chat",
      });

      return roomId;
    } catch (error) {
      throw new Error(`Failed to get or create DM room: ${error}`);
    }
  }

  /**
   * Set up event listeners for the client.
   */
  private setupEventListeners() {
    if (!this.client) {
      return;
    }

    // Handle room messages
    this.client.on(
      "room.message",
      async (roomId: string, event: MatrixEvent) => {
        try {
          await this.handleRoomMessage(roomId, event);
        } catch (error) {
          this.runtime.logger.error(`Error handling room message: ${error}`);
        }
      },
    );

    // Handle room member events
    this.client.on("room.event", async (roomId: string, event: MatrixEvent) => {
      try {
        if (event.type === MATRIX_EVENT_TYPES.MEMBER) {
          await this.handleMemberEvent(roomId, event);
        } else if (event.type === MATRIX_EVENT_TYPES.REACTION) {
          await this.handleReactionEvent(roomId, event);
        } else if (event.type === MATRIX_EVENT_TYPES.MESSAGE) {
          // Handle regular messages that come through room.event instead of room.message
          await this.handleRoomMessage(roomId, event);
        } else if (event.type === MATRIX_EVENT_TYPES.ENCRYPTED) {
          await this.handleEncryptedMessage(roomId, event);
        }
      } catch (error) {
        this.runtime.logger.error(`Error handling room event: ${error}`);
      }
    });

    // Handle room join events
    this.client.on("room.join", async (roomId: string, event: MatrixEvent) => {
      try {
        await this.handleRoomJoin(roomId, event);
      } catch (error) {
        this.runtime.logger.error(`Error handling room join: ${error}`);
      }
    });

    // Handle room leave events
    this.client.on("room.leave", async (roomId: string, event: MatrixEvent) => {
      try {
        await this.handleRoomLeave(roomId, event);
      } catch (error) {
        this.runtime.logger.error(`Error handling room leave: ${error}`);
      }
    });
  }

  /**
   * Download media content from Matrix MXC URL
   * @param mxcUrl - Matrix content URL
   * @param mimeType - MIME type of the content
   * @param fileName - Original filename
   * @returns Promise resolving to Media object with downloaded content
   */
  private async downloadMediaContent(
    mxcUrl: string,
    mimeType: string,
    fileName: string,
  ): Promise<Media | null> {
    if (!this.client) {
      this.runtime.logger.error(
        "Matrix client not available for media download",
      );
      return null;
    }

    try {
      // Convert MXC URL to HTTP URL
      const httpUrl = this.client.mxcToHttp(mxcUrl);
      if (!httpUrl) {
        this.runtime.logger.error(
          `Failed to convert MXC URL to HTTP: ${mxcUrl}`,
        );
        return null;
      }

      this.runtime.logger.debug(
        `Converted MXC URL ${mxcUrl} to HTTP URL: ${httpUrl}`,
      );

      // Download the content as Buffer with improved error handling
      const contentBuffer = await this.downloadBuffer(httpUrl);

      if (!contentBuffer || contentBuffer.length === 0) {
        this.runtime.logger.error(`Downloaded empty content from ${httpUrl}`);
        return null;
      }

      this.runtime.logger.debug(
        `Successfully downloaded ${contentBuffer.length} bytes from ${httpUrl}`,
      );

      // Convert Buffer to base64 data URL for VLM consumption
      const base64Data = contentBuffer.toString("base64");
      if (!base64Data) {
        this.runtime.logger.error(
          `Failed to convert downloaded content to base64 for ${mxcUrl}`,
        );
        return null;
      }

      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      // Determine content type from MIME type
      let contentType: ContentType;
      if (mimeType.startsWith("image/")) {
        contentType = ContentType.IMAGE;
      } else if (mimeType.startsWith("video/")) {
        contentType = ContentType.VIDEO;
      } else if (mimeType.startsWith("audio/")) {
        contentType = ContentType.AUDIO;
      } else {
        contentType = ContentType.DOCUMENT;
      }

      const mediaId = createUniqueUuid(this.runtime, `${mxcUrl}-${fileName}`);

      const media: Media = {
        id: mediaId,
        url: dataUrl, // Use data URL for direct VLM access
        title: fileName,
        source: mxcUrl, // Keep original MXC URL as source
        description: `${contentType} file: ${fileName} (${Math.round(contentBuffer.length / 1024)}KB)`,
        text: fileName,
        contentType,
      };

      this.runtime.logger.success(
        `Successfully created media object for ${fileName} (${contentType})`,
      );
      return media;
    } catch (error) {
      this.runtime.logger.error(
        `Failed to download media content from ${mxcUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Download content from URL as Buffer with improved error handling and timeout
   * @param url - HTTP/HTTPS URL to download
   * @returns Promise resolving to Buffer
   */
  private async downloadBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https:") ? https : http;

      // Set a timeout for the request (30 seconds)
      const timeout = setTimeout(() => {
        reject(new Error(`Download timeout after 30 seconds for URL: ${url}`));
      }, 30000);

      const request = client
        .get(url, (response) => {
          clearTimeout(timeout);

          if (response.statusCode !== 200) {
            const errorMsg = `HTTP ${response.statusCode}: ${response.statusMessage || "Unknown error"} for URL: ${url}`;
            this.runtime.logger.error(errorMsg);
            reject(new Error(errorMsg));
            return;
          }

          const chunks: Buffer[] = [];
          let totalSize = 0;
          const maxSize = 50 * 1024 * 1024; // 50MB limit

          response.on("data", (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > maxSize) {
              clearTimeout(timeout);
              reject(
                new Error(
                  `File too large: ${totalSize} bytes exceeds 50MB limit`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });

          response.on("end", () => {
            clearTimeout(timeout);
            const buffer = Buffer.concat(chunks);
            this.runtime.logger.debug(
              `Downloaded ${buffer.length} bytes from ${url}`,
            );
            resolve(buffer);
          });

          response.on("error", (error) => {
            clearTimeout(timeout);
            this.runtime.logger.error(
              `Response error for ${url}: ${error.message}`,
            );
            reject(error);
          });
        })
        .on("error", (error) => {
          clearTimeout(timeout);
          this.runtime.logger.error(
            `Request error for ${url}: ${error.message}`,
          );
          reject(error);
        });

      // Set request timeout
      request.setTimeout(30000, () => {
        clearTimeout(timeout);
        request.destroy();
        reject(new Error(`Request timeout after 30 seconds for URL: ${url}`));
      });
    });
  }

  /**
   * Handle room messages
   */
  private async handleRoomMessage(roomId: string, event: MatrixEvent) {
    try {
      // Skip if we're sending the message
      if (event.sender === (await this.client?.getUserId())) {
        return;
      }

      // Skip if room restrictions are set and this room is not allowed
      if (this.allowedRoomIds && !this.isRoomAllowed(roomId)) {
        return;
      }

      // Skip bot messages if configured
      if (
        this.matrixSettings.shouldIgnoreBotMessages &&
        event.sender.includes("bot")
      ) {
        return;
      }

      const messageContent = event.content as MessageEventContent;
      if (!messageContent) {
        return;
      }

      // Handle supported message types
      const supportedTypes = [
        MATRIX_MESSAGE_TYPES.TEXT,
        MATRIX_MESSAGE_TYPES.EMOTE,
        MATRIX_MESSAGE_TYPES.NOTICE,
        MATRIX_MESSAGE_TYPES.IMAGE,
        MATRIX_MESSAGE_TYPES.FILE,
        MATRIX_MESSAGE_TYPES.AUDIO,
        MATRIX_MESSAGE_TYPES.VIDEO,
      ];

      if (!supportedTypes.includes(messageContent.msgtype)) {
        if (messageContent.msgtype) {
          this.runtime.logger.debug(
            `Received unsupported message type ${messageContent.msgtype} in room ${roomId}`,
          );
        }
        return;
      }

      const room = await this.getRoomInfo(roomId);
      const roomUUID = createUniqueUuid(this.runtime, roomId);
      const entityId = createUniqueUuid(this.runtime, event.sender);
      const messageUUID = createUniqueUuid(this.runtime, event.event_id);

      // Get user display name
      let displayName: string;
      try {
        const senderProfile = await this.client?.getUserProfile(event.sender);
        displayName = senderProfile?.displayname || event.sender;
      } catch (error) {
        this.runtime.logger.warn(
          `Failed to get profile for ${event.sender}: ${error}`,
        );
        displayName = event.sender;
      }

      await this.runtime.ensureConnection({
        entityId,
        roomId: roomUUID,
        userName: event.sender,
        worldId: roomUUID as UUID,
        worldName: room.name || roomId,
        name: displayName,
        source: "matrix",
        channelId: roomId,
        type: room.isDirect ? ChannelType.DM : ChannelType.GROUP,
      });

      // Format message text based on type and download media content if applicable
      let messageText = messageContent.body;
      let isMediaMessage = false;
      let attachments: Media[] = [];

      if (messageContent.msgtype === MATRIX_MESSAGE_TYPES.EMOTE) {
        messageText = `*${event.sender} ${messageContent.body}*`;
      } else if (messageContent.msgtype === MATRIX_MESSAGE_TYPES.NOTICE) {
        messageText = `[Notice] ${messageContent.body}`;
      } else if (
        [
          MATRIX_MESSAGE_TYPES.IMAGE,
          MATRIX_MESSAGE_TYPES.FILE,
          MATRIX_MESSAGE_TYPES.AUDIO,
          MATRIX_MESSAGE_TYPES.VIDEO,
        ].includes(messageContent.msgtype)
      ) {
        isMediaMessage = true;
        const mediaType = messageContent.msgtype.replace("m.", "");

        // For images, attempt to download content for VLM processing
        if (
          messageContent.msgtype === MATRIX_MESSAGE_TYPES.IMAGE &&
          messageContent.url
        ) {
          this.runtime.logger.debug(
            `Processing image message for VLM: ${messageContent.url}`,
          );

          // Always indicate that an image is present in the message text
          const fileName = messageContent.body || "image";
          const imageInfo = messageContent.info;
          const sizeInfo = imageInfo?.size
            ? ` (${Math.round(imageInfo.size / 1024)}KB)`
            : "";
          const dimensionInfo =
            imageInfo?.w && imageInfo?.h
              ? ` ${imageInfo.w}x${imageInfo.h}`
              : "";

          messageText = `📷 **IMAGE ATTACHED**: ${fileName}${dimensionInfo}${sizeInfo}\n\n${messageContent.body || "User shared an image"}`;

          // Attempt to download the image content
          if (messageContent.info?.mimetype) {
            try {
              this.runtime.logger.info(
                `Downloading image for VLM processing: ${fileName} (${messageContent.info.mimetype})`,
              );

              const mediaAttachment = await this.downloadMediaContent(
                messageContent.url,
                messageContent.info.mimetype,
                fileName,
              );

              if (mediaAttachment) {
                attachments.push(mediaAttachment);
                messageText += `\n\n✅ Image successfully processed and available for analysis.`;
                this.runtime.logger.success(
                  `Successfully downloaded and attached image: ${mediaAttachment.title}`,
                );
              } else {
                messageText += `\n\n⚠️ Image could not be processed - content may not be accessible.`;
                this.runtime.logger.warn(
                  `Failed to download image content but no error thrown: ${messageContent.url}`,
                );
              }
            } catch (error) {
              messageText += `\n\n❌ Error processing image - content not accessible for analysis.`;
              this.runtime.logger.error(
                `Critical error downloading image content from ${messageContent.url}: ${error}`,
              );
            }
          } else {
            messageText += `\n\n⚠️ Image metadata incomplete - cannot process for analysis.`;
            this.runtime.logger.warn(
              `Image message missing MIME type info: ${messageContent.url}`,
            );
          }
        } else {
          // Handle other media types (non-images)
          messageText = `[${mediaType.toUpperCase()}] ${messageContent.body || `Shared a ${mediaType}`}`;
          if (messageContent.url) {
            messageText += ` (${messageContent.url})`;
          }
        }
      }

      const memory: Memory = {
        id: messageUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          text: messageText,
          source: "matrix",
          channelType: room.isDirect ? ChannelType.DM : ChannelType.GROUP,
          attachments: attachments.length > 0 ? attachments : undefined,
          metadata: {
            messageType: messageContent.msgtype,
            originalEvent: event.event_id,
            roomId: roomId,
            isMedia: isMediaMessage,
            mediaUrl: messageContent.url,
            mimeType: messageContent.info?.mimetype,
            fileSize: messageContent.info?.size,
          },
        },
        roomId: roomUUID,
        createdAt: event.origin_server_ts || Date.now(),
      };

      const callback: HandlerCallback = async (content): Promise<Memory[]> => {
        try {
          if (content.text) {
            // Split long messages
            const chunks = this.splitMessage(content.text, 4096);
            for (const chunk of chunks) {
              await this.client?.sendMessage(roomId, {
                msgtype: MATRIX_MESSAGE_TYPES.TEXT,
                body: chunk,
              });
            }
          }
        } catch (error) {
          this.runtime.logger.error(`Error sending response message: ${error}`);
        }
        return [];
      };

      this.runtime.emitEvent(
        [MatrixEventTypes.MESSAGE_RECEIVED, "MESSAGE_RECEIVED"],
        {
          runtime: this.runtime,
          message: memory,
          callback,
          originalEvent: event,
          room,
        },
      );

      this.runtime.logger.debug(
        `Forwarded ${messageContent.msgtype} message from ${event.sender} in room ${roomId} to ElizaOS`,
      );
    } catch (error) {
      this.runtime.logger.error(
        `Error processing message from ${event.sender} in room ${roomId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle encrypted messages
   */
  private async handleEncryptedMessage(roomId: string, event: MatrixEvent) {
    try {
      // Skip if we're sending the message
      if (event.sender === (await this.client?.getUserId())) {
        return;
      }

      // Skip if room restrictions are set and this room is not allowed
      if (this.allowedRoomIds && !this.isRoomAllowed(roomId)) {
        return;
      }

      this.runtime.logger.debug(
        `Received encrypted message from ${event.sender} in room ${roomId}`,
      );

      // Try to decrypt the message using Matrix SDK
      let decryptedContent: any = null;
      let messageText = "[Encrypted message - content not available]";
      let isDecrypted = false;

      try {
        // Log the raw event content for debugging
        this.runtime.logger.debug(
          `Encrypted event content: ${JSON.stringify(event.content)}`,
        );

        // Check if the event has already been decrypted by the SDK
        // A decrypted event should have msgtype and body in the content
        if (
          event.content &&
          typeof event.content === "object" &&
          event.content.msgtype &&
          event.content.body
        ) {
          // Message has been decrypted successfully
          decryptedContent = event.content;
          messageText = decryptedContent.body;
          isDecrypted = true;
          this.runtime.logger.debug(
            `Successfully decrypted message from ${event.sender} in room ${roomId}: ${messageText.substring(0, 100)}...`,
          );
        } else {
          // Message could not be decrypted or decryption is in progress
          this.runtime.logger.debug(
            `Message from ${event.sender} in room ${roomId} could not be decrypted. ` +
              `Content type: ${typeof event.content}, has msgtype: ${!!event.content?.msgtype}, has body: ${!!event.content?.body}`,
          );

          // Check if this is actually an encryption error vs a decryption in progress
          if (event.content && event.content.algorithm) {
            this.runtime.logger.debug(
              `Encrypted with algorithm: ${event.content.algorithm}`,
            );
          }
        }
      } catch (decryptError) {
        this.runtime.logger.warn(
          `Failed to decrypt message from ${event.sender} in room ${roomId}: ${decryptError}`,
        );
      }
      const room = await this.getRoomInfo(roomId);
      const roomUUID = createUniqueUuid(this.runtime, roomId);
      const entityId = createUniqueUuid(this.runtime, event.sender);
      const messageUUID = createUniqueUuid(this.runtime, event.event_id);

      // Get user display name
      let displayName: string;
      try {
        const senderProfile = await this.client?.getUserProfile(event.sender);
        displayName = senderProfile?.displayname || event.sender;
      } catch (error) {
        displayName = event.sender;
      }

      await this.runtime.ensureConnection({
        entityId,
        roomId: roomUUID,
        userName: event.sender,
        worldId: roomUUID as UUID,
        worldName: room.name || roomId,
        name: displayName,
        source: "matrix",
        channelId: roomId,
        type: room.isDirect ? ChannelType.DM : ChannelType.GROUP,
      });

      // Format message text based on type if decrypted and download media content
      let isMediaMessage = false;
      let attachments: Media[] = [];

      if (isDecrypted && decryptedContent) {
        if (decryptedContent.msgtype === MATRIX_MESSAGE_TYPES.EMOTE) {
          messageText = `*${event.sender} ${decryptedContent.body}*`;
        } else if (decryptedContent.msgtype === MATRIX_MESSAGE_TYPES.NOTICE) {
          messageText = `[Notice] ${decryptedContent.body}`;
        } else if (
          [
            MATRIX_MESSAGE_TYPES.IMAGE,
            MATRIX_MESSAGE_TYPES.FILE,
            MATRIX_MESSAGE_TYPES.AUDIO,
            MATRIX_MESSAGE_TYPES.VIDEO,
          ].includes(decryptedContent.msgtype)
        ) {
          isMediaMessage = true;
          const mediaType = decryptedContent.msgtype.replace("m.", "");

          // For encrypted images, attempt to download content for VLM processing
          if (
            decryptedContent.msgtype === MATRIX_MESSAGE_TYPES.IMAGE &&
            decryptedContent.url
          ) {
            this.runtime.logger.debug(
              `Processing encrypted image message for VLM: ${decryptedContent.url}`,
            );

            // Always indicate that an encrypted image is present in the message text
            const fileName = decryptedContent.body || "encrypted_image";
            const imageInfo = decryptedContent.info;
            const sizeInfo = imageInfo?.size
              ? ` (${Math.round(imageInfo.size / 1024)}KB)`
              : "";
            const dimensionInfo =
              imageInfo?.w && imageInfo?.h
                ? ` ${imageInfo.w}x${imageInfo.h}`
                : "";

            messageText = `🔐📷 **ENCRYPTED IMAGE ATTACHED**: ${fileName}${dimensionInfo}${sizeInfo}\n\n${decryptedContent.body || "User shared an encrypted image"}`;

            // Attempt to download the encrypted image content
            if (decryptedContent.info?.mimetype) {
              try {
                this.runtime.logger.info(
                  `Downloading encrypted image for VLM processing: ${fileName} (${decryptedContent.info.mimetype})`,
                );

                const mediaAttachment = await this.downloadMediaContent(
                  decryptedContent.url,
                  decryptedContent.info.mimetype,
                  fileName,
                );

                if (mediaAttachment) {
                  attachments.push(mediaAttachment);
                  messageText += `\n\n✅ Encrypted image successfully decrypted and processed for analysis.`;
                  this.runtime.logger.success(
                    `Successfully downloaded and attached encrypted image: ${mediaAttachment.title}`,
                  );
                } else {
                  messageText += `\n\n⚠️ Encrypted image could not be processed - content may not be accessible.`;
                  this.runtime.logger.warn(
                    `Failed to download encrypted image content but no error thrown: ${decryptedContent.url}`,
                  );
                }
              } catch (error) {
                messageText += `\n\n❌ Error processing encrypted image - content not accessible for analysis.`;
                this.runtime.logger.error(
                  `Critical error downloading encrypted image content from ${decryptedContent.url}: ${error}`,
                );
              }
            } else {
              messageText += `\n\n⚠️ Encrypted image metadata incomplete - cannot process for analysis.`;
              this.runtime.logger.warn(
                `Encrypted image message missing MIME type info: ${decryptedContent.url}`,
              );
            }
          } else {
            // Handle other encrypted media types (non-images)
            messageText = `🔐[${mediaType.toUpperCase()}] ${decryptedContent.body || `Shared an encrypted ${mediaType}`}`;
            if (decryptedContent.url) {
              messageText += ` (${decryptedContent.url})`;
            }
          }
        }
      }

      const memory: Memory = {
        id: messageUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          text: messageText,
          source: "matrix",
          channelType: room.isDirect ? ChannelType.DM : ChannelType.GROUP,
          attachments: attachments.length > 0 ? attachments : undefined,
          metadata: {
            messageType: isDecrypted
              ? decryptedContent?.msgtype || "m.text"
              : "m.room.encrypted",
            originalEvent: event.event_id,
            roomId: roomId,
            isEncrypted: true,
            isDecrypted: isDecrypted,
            isMedia: isMediaMessage,
            mediaUrl: isDecrypted ? decryptedContent?.url : undefined,
            mimeType: isDecrypted
              ? decryptedContent?.info?.mimetype
              : undefined,
            fileSize: isDecrypted ? decryptedContent?.info?.size : undefined,
          },
        },
        roomId: roomUUID,
        createdAt: event.origin_server_ts || Date.now(),
      };

      // Provide callback for responses - encrypted messages should be able to reply too
      const callback: HandlerCallback = async (content): Promise<Memory[]> => {
        try {
          if (content.text) {
            // Split long messages
            const chunks = this.splitMessage(content.text, 4096);
            for (const chunk of chunks) {
              await this.client?.sendMessage(roomId, {
                msgtype: MATRIX_MESSAGE_TYPES.TEXT,
                body: chunk,
              });
            }
          }
        } catch (error) {
          this.runtime.logger.error(
            `Error sending response to encrypted message: ${error}`,
          );
        }
        return [];
      };

      this.runtime.emitEvent(
        [MatrixEventTypes.MESSAGE_RECEIVED, "MESSAGE_RECEIVED"],
        {
          runtime: this.runtime,
          message: memory,
          callback,
          originalEvent: event,
          room,
        },
      );

      this.runtime.logger.debug(
        `Forwarded ${isDecrypted ? "decrypted" : "encrypted"} message from ${event.sender} in room ${roomId} to ElizaOS`,
      );
    } catch (error) {
      this.runtime.logger.error(
        `Error processing encrypted message from ${event.sender} in room ${roomId}: ${error}`,
      );
    }
  }

  /**
   * Handle member events (join/leave)
   */
  private async handleMemberEvent(roomId: string, event: MatrixEvent) {
    const content = event.content as any;
    const membership = content.membership;

    if (membership === MATRIX_MEMBERSHIP.JOIN) {
      // User joined room
      const entityId = createUniqueUuid(
        this.runtime,
        event.state_key || event.sender,
      );
      const roomUUID = createUniqueUuid(this.runtime, roomId);

      this.runtime.emitEvent([MatrixEventTypes.USER_JOINED], {
        runtime: this.runtime,
        entityId,
        worldId: roomUUID,
        userId: event.state_key || event.sender,
        room: await this.getRoomInfo(roomId),
      });
    } else if (membership === MATRIX_MEMBERSHIP.LEAVE) {
      // User left room
      const entityId = createUniqueUuid(
        this.runtime,
        event.state_key || event.sender,
      );
      const roomUUID = createUniqueUuid(this.runtime, roomId);

      this.runtime.emitEvent([MatrixEventTypes.USER_LEFT], {
        runtime: this.runtime,
        entityId,
        worldId: roomUUID,
        userId: event.state_key || event.sender,
        room: await this.getRoomInfo(roomId),
      });
    }
  }

  /**
   * Handle reaction events
   */
  private async handleReactionEvent(roomId: string, event: MatrixEvent) {
    const content = event.content as any;
    const relatesTo = content["m.relates_to"];

    if (!relatesTo || relatesTo.rel_type !== "m.annotation") {
      return;
    }

    const targetEventId = relatesTo.event_id;
    const reactionKey = relatesTo.key;

    const roomUUID = createUniqueUuid(this.runtime, roomId);
    const entityId = createUniqueUuid(this.runtime, event.sender);
    const reactionUUID = createUniqueUuid(this.runtime, event.event_id);

    const memory: Memory = {
      id: reactionUUID,
      entityId,
      agentId: this.runtime.agentId,
      content: {
        text: `*Reacted with ${reactionKey}*`,
        source: "matrix",
        inReplyTo: createUniqueUuid(this.runtime, targetEventId),
      },
      roomId: roomUUID,
      createdAt: event.origin_server_ts || Date.now(),
    };

    const callback: HandlerCallback = async (content): Promise<Memory[]> => {
      if (content.text) {
        await this.client?.sendMessage(roomId, {
          msgtype: MATRIX_MESSAGE_TYPES.TEXT,
          body: content.text,
        });
      }
      return [];
    };

    this.runtime.emitEvent(
      [MatrixEventTypes.REACTION_RECEIVED, "REACTION_RECEIVED"],
      {
        runtime: this.runtime,
        message: memory,
        callback,
        originalEvent: event,
        targetEventId,
        reactionKey,
      },
    );
  }

  /**
   * Handle room join events
   */
  private async handleRoomJoin(roomId: string, event: MatrixEvent) {
    try {
      const room = await this.getRoomInfo(roomId);

      const roomUUID = createUniqueUuid(this.runtime, roomId);

      // Create a World object for the event
      const world: World = {
        id: roomUUID,
        name: room.name || roomId,
        agentId: this.runtime.agentId,
        serverId: "matrix",
      };

      this.runtime.emitEvent(
        [MatrixEventTypes.ROOM_JOINED, EventType.WORLD_JOINED],
        {
          runtime: this.runtime,
          worldId: roomUUID,
          world,
          room,
          source: "matrix",
        },
      );
    } catch (error) {
      this.runtime.logger.error(`Error handling room join: ${error}`);
    }
  }

  /**
   * Handle room leave events
   */
  private async handleRoomLeave(roomId: string, event: MatrixEvent) {
    try {
      const room = await this.getRoomInfo(roomId);
      const roomUUID = createUniqueUuid(this.runtime, roomId);

      this.runtime.emitEvent([MatrixEventTypes.ROOM_LEFT], {
        runtime: this.runtime,
        worldId: roomUUID,
        room,
        source: "matrix",
      });
    } catch (error) {
      this.runtime.logger.error(`Error handling room leave: ${error}`);
    }
  }

  /**
   * Called when the client is ready
   */
  private async onReady() {
    this.runtime.logger.success("MATRIX CLIENT READY");

    try {
      const joinedRooms = await this.client?.getJoinedRooms();
      if (!joinedRooms) return;

      for (const roomId of joinedRooms) {
        try {
          const room = await this.getRoomInfo(roomId);

          const roomUUID = createUniqueUuid(this.runtime, roomId);

          // Create a World object for the event
          const world: World = {
            id: roomUUID,
            name: room.name || roomId,
            agentId: this.runtime.agentId,
            serverId: "matrix",
          };

          this.runtime.emitEvent(
            [MatrixEventTypes.ROOM_JOINED, EventType.WORLD_JOINED],
            {
              runtime: this.runtime,
              worldId: roomUUID,
              world,
              room,
              source: "matrix",
            },
          );
        } catch (error) {
          this.runtime.logger.error(
            `Error processing room ${roomId}: ${error}`,
          );
        }
      }
    } catch (error) {
      this.runtime.logger.error("Error during Matrix ready processing:", error);
    }
  }

  /**
   * Checks if a room ID is allowed
   */
  public isRoomAllowed(roomId: string): boolean {
    if (!this.allowedRoomIds) {
      return true;
    }
    return (
      this.allowedRoomIds.includes(roomId) || this.dynamicRoomIds.has(roomId)
    );
  }

  /**
   * Adds a room to the dynamic allowed list
   */
  public addAllowedRoom(roomId: string): boolean {
    this.dynamicRoomIds.add(roomId);
    return true;
  }

  /**
   * Removes a room from the dynamic allowed list
   */
  public removeAllowedRoom(roomId: string): boolean {
    if (this.allowedRoomIds?.includes(roomId)) {
      return false;
    }
    return this.dynamicRoomIds.delete(roomId);
  }

  /**
   * Gets the list of all allowed rooms
   */
  public getAllowedRooms(): string[] {
    const envRooms = this.allowedRoomIds || [];
    const dynamicRooms = Array.from(this.dynamicRoomIds);
    return [...new Set([...envRooms, ...dynamicRooms])];
  }

  /**
   * Stops the Matrix service and cleans up resources
   */
  public async stop(): Promise<void> {
    this.runtime.logger.info("Stopping Matrix service...");

    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.runtime.logger.info("Matrix client stopped.");
    }

    this.runtime.logger.info("Matrix service stopped.");
  }
}

export default MatrixService;
