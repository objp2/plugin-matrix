export const MATRIX_SERVICE_NAME = "matrix";

export const MATRIX_MESSAGE_TYPES = {
  TEXT: "m.text",
  EMOTE: "m.emote",
  NOTICE: "m.notice",
  IMAGE: "m.image",
  FILE: "m.file",
  AUDIO: "m.audio",
  VIDEO: "m.video",
} as const;

export const MATRIX_EVENT_TYPES = {
  MESSAGE: "m.room.message",
  REACTION: "m.reaction",
  MEMBER: "m.room.member",
  ENCRYPTED: "m.room.encrypted",
  REDACTION: "m.room.redaction",
} as const;

export const MATRIX_MEMBERSHIP = {
  INVITE: "invite",
  JOIN: "join",
  LEAVE: "leave",
  BAN: "ban",
} as const;
