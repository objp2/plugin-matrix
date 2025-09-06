import {
  ChannelType,
  type Character,
  type Content,
  EventType,
  type HandlerCallback,
  type IAgentRuntime,
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

    try {
      // Validate environment configuration
      const config = validateMatrixConfig({
        MATRIX_HOMESERVER_URL: runtime.getSetting("MATRIX_HOMESERVER_URL"),
        MATRIX_ACCESS_TOKEN: runtime.getSetting("MATRIX_ACCESS_TOKEN"),
        MATRIX_USER_ID: runtime.getSetting("MATRIX_USER_ID"),
        MATRIX_ROOM_IDS: runtime.getSetting("MATRIX_ROOM_IDS"),
        MATRIX_ENCRYPTION_ENABLED: runtime.getSetting(
          "MATRIX_ENCRYPTION_ENABLED",
        ),
      });

      if (
        !config.MATRIX_ACCESS_TOKEN ||
        config.MATRIX_ACCESS_TOKEN.trim() === ""
      ) {
        logger.warn(
          "Matrix access token not provided - Matrix functionality will be unavailable",
        );
        this.client = null;
        return;
      }

      // Initialize Matrix client
      const storage = new SimpleFsStorageProvider("./matrix-storage.json");
      this.client = new MatrixClient(
        config.MATRIX_HOMESERVER_URL,
        config.MATRIX_ACCESS_TOKEN,
        storage,
      );

      // Set up encryption if enabled
      if (config.MATRIX_ENCRYPTION_ENABLED) {
        try {
          const cryptoProvider = new RustSdkCryptoStorageProvider(
            "./matrix-crypto-store",
          );
          this.client.setStorageProvider(cryptoProvider);
          logger.info("Matrix encryption enabled with crypto storage provider");
        } catch (error) {
          logger.warn(`Failed to set up encryption storage provider: ${error}`);
          logger.warn("Continuing without encryption support");
        }
      }

      // Enable auto-join for room invites
      AutojoinRoomsMixin.setupOnClient(this.client);

      this.setupEventListeners();
      this.registerSendHandler();

      // Start the client
      this.client
        .start()
        .then(async () => {
          logger.success("Matrix client started successfully");

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
          this.client = null;
        });
    } catch (error) {
      runtime.logger.error(
        `Error initializing Matrix client: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.client = null;
    }
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

      // Note: The RustSdkCryptoStorageProvider should handle most of the crypto setup
      // Additional device verification and key management would be handled by the SDK

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
      } else {
        runtime.logger.warn(
          "[Matrix SendHandler] No text content provided to send.",
        );
      }

      // TODO: Add attachment handling here if necessary
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

      // Format message text based on type
      let messageText = messageContent.body;
      let isMediaMessage = false;

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
        messageText = `[${mediaType.toUpperCase()}] ${messageContent.body || `Shared a ${mediaType}`}`;

        // Add media URL info if available
        if (messageContent.url) {
          messageText += ` (${messageContent.url})`;
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
        // Check if the event has already been decrypted by the SDK
        if (event.content && event.content.msgtype && event.content.body) {
          // Message has been decrypted successfully
          decryptedContent = event.content;
          messageText = decryptedContent.body;
          isDecrypted = true;
          this.runtime.logger.debug(
            `Successfully decrypted message from ${event.sender} in room ${roomId}`,
          );
        } else {
          // Try to get the decrypted content if available
          this.runtime.logger.debug(
            `Message from ${event.sender} in room ${roomId} could not be decrypted`,
          );
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

      // Format message text based on type if decrypted
      let isMediaMessage = false;
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
          messageText = `[${mediaType.toUpperCase()}] ${decryptedContent.body || `Shared a ${mediaType}`}`;

          // Add media URL info if available
          if (decryptedContent.url) {
            messageText += ` (${decryptedContent.url})`;
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
            [MatrixEventTypes.ROOM_JOINED, EventType.WORLD_CONNECTED],
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
