import type { Character, EntityPayload, MessagePayload, WorldPayload } from '@elizaos/core';
import type { MatrixClient, MatrixEvent } from 'matrix-bot-sdk';

/**
 * Matrix-specific event types
 */
export enum MatrixEventTypes {
  // Message events
  MESSAGE_RECEIVED = 'MATRIX_MESSAGE_RECEIVED',
  MESSAGE_SENT = 'MATRIX_MESSAGE_SENT',

  // Reaction events
  REACTION_RECEIVED = 'MATRIX_REACTION_RECEIVED',
  REACTION_REMOVED = 'MATRIX_REACTION_REMOVED',

  // Room events
  ROOM_JOINED = 'MATRIX_ROOM_JOINED',
  ROOM_LEFT = 'MATRIX_ROOM_LEFT',

  // User events
  USER_JOINED = 'MATRIX_USER_JOINED',
  USER_LEFT = 'MATRIX_USER_LEFT',

  // State events
  STATE_CHANGED = 'MATRIX_STATE_CHANGED',
}

/**
 * Matrix-specific message received payload
 */
export interface MatrixMessageReceivedPayload extends MessagePayload {
  /** The original Matrix event */
  originalEvent: MatrixEvent;
  /** The Matrix room */
  room: MatrixRoom;
}

/**
 * Matrix-specific message sent payload
 */
export interface MatrixMessageSentPayload extends MessagePayload {
  /** The event ID of the sent message */
  eventId: string;
  /** The Matrix room */
  room: MatrixRoom;
}

/**
 * Matrix-specific reaction received payload
 */
export interface MatrixReactionPayload extends MessagePayload {
  /** The original Matrix reaction event */
  originalEvent: MatrixEvent;
  /** The target event ID that was reacted to */
  targetEventId: string;
  /** The reaction key/emoji */
  reactionKey: string;
}

/**
 * Matrix-specific room payload
 */
export interface MatrixRoomPayload extends WorldPayload {
  /** The original Matrix room */
  room: MatrixRoom;
}

/**
 * Matrix-specific user joined payload
 */
export interface MatrixUserJoinedPayload extends EntityPayload {
  /** The Matrix user ID */
  userId: string;
  /** The Matrix room */
  room: MatrixRoom;
}

/**
 * Matrix-specific user left payload
 */
export interface MatrixUserLeftPayload extends EntityPayload {
  /** The Matrix user ID */
  userId: string;
  /** The Matrix room */
  room: MatrixRoom;
}

/**
 * Maps Matrix event types to their payload interfaces
 */
export interface MatrixEventPayloadMap {
  [MatrixEventTypes.MESSAGE_RECEIVED]: MatrixMessageReceivedPayload;
  [MatrixEventTypes.MESSAGE_SENT]: MatrixMessageSentPayload;
  [MatrixEventTypes.REACTION_RECEIVED]: MatrixReactionPayload;
  [MatrixEventTypes.REACTION_REMOVED]: MatrixReactionPayload;
  [MatrixEventTypes.ROOM_JOINED]: MatrixRoomPayload;
  [MatrixEventTypes.ROOM_LEFT]: MatrixRoomPayload;
  [MatrixEventTypes.USER_JOINED]: MatrixUserJoinedPayload;
  [MatrixEventTypes.USER_LEFT]: MatrixUserLeftPayload;
}

/**
 * Interface representing a Matrix service.
 */
export interface IMatrixService {
  client: MatrixClient | null;
  character: Character;
}

export const MATRIX_SERVICE_NAME = 'matrix';

export const ServiceType = {
  MATRIX: 'matrix',
} as const;

/**
 * Matrix plugin settings
 */
export interface MatrixSettings {
  allowedRoomIds?: string[];
  shouldIgnoreBotMessages?: boolean;
  shouldIgnoreDirectMessages?: boolean;
  shouldRespondOnlyToMentions?: boolean;
  encryptionEnabled?: boolean;
}

/**
 * Custom Room interface to replace missing matrix-bot-sdk Room
 */
export interface MatrixRoom {
  /** Room ID */
  id: string;
  /** Room name */
  name?: string;
  /** Room topic */
  topic?: string;
  /** Whether the room is a direct message room */
  isDirect: boolean;
  /** Whether the room is encrypted */
  isEncrypted: boolean;
  /** Number of members in the room */
  memberCount: number;
  /** Room avatar URL */
  avatarUrl?: string;
}

/**
 * Matrix room info
 */
export interface MatrixRoomInfo {
  id: string;
  name?: string;
  topic?: string;
  memberCount: number;
  isEncrypted: boolean;
  isDirect: boolean;
}

/**
 * Matrix user info
 */
export interface MatrixUserInfo {
  id: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Matrix media info
 */
export interface MatrixMediaInfo {
  mxcUrl: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
}