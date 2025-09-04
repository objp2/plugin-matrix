# @elizaos/plugin-matrix

A comprehensive Matrix protocol plugin implementation for ElizaOS, enabling rich integration with Matrix homeservers for messaging, reactions, media sharing, and end-to-end encryption.

## Features

- **🔐 Full Matrix Protocol Support**: Built on the robust `matrix-bot-sdk`
- **💬 Message Handling**: Send and receive text messages in Matrix rooms
- **😀 Reactions**: React to messages with emoji reactions
- **🏠 Room Management**: Join, leave, and list Matrix rooms dynamically
- **📁 Media Support**: Upload and download media files (images, videos, audio, documents)
- **🔒 Encryption Support**: Compatible with Matrix end-to-end encryption (E2EE)
- **🛡️ Access Control**: Configurable room filtering for controlled bot access
- **💌 Direct Messages**: Support for private one-on-one conversations
- **📊 State Providers**: Access comprehensive room and user information
- **⚡ Event-driven Architecture**: Real-time Matrix event handling
- **🔧 TypeScript**: Full TypeScript support with comprehensive type definitions

## Installation

Install the plugin using your preferred package manager:

```bash
npm install @elizaos/plugin-matrix
# or
yarn add @elizaos/plugin-matrix
# or
bun add @elizaos/plugin-matrix
```

## Quick Start

### 1. Environment Configuration

Create a `.env` file with your Matrix credentials:

```bash
# Required: Matrix Connection
MATRIX_HOMESERVER_URL=https://matrix.org
MATRIX_ACCESS_TOKEN=your_matrix_access_token
MATRIX_USER_ID=@yourbot:matrix.org

# Optional: Room Restrictions  
MATRIX_ROOM_IDS=!room1:matrix.org,!room2:matrix.org

# Optional: Enable Encryption
MATRIX_ENCRYPTION_ENABLED=true
```

### 2. Getting Matrix Credentials

**Option A: Element Web Client**
1. Open [Element Web](https://app.element.io)
2. Log in to your Matrix account
3. Go to Settings → Help & About → Advanced
4. Copy your Access Token

**Option B: Matrix API**
```bash
curl -X POST "https://matrix.org/_matrix/client/r0/login" \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"yourbot","password":"yourpassword"}'
```

### 3. Plugin Integration

Add the plugin to your ElizaOS character configuration:

```typescript
import matrixPlugin from '@elizaos/plugin-matrix';

const character = {
  name: "MatrixBot",
  // ... other character config
  plugins: [
    matrixPlugin,
    // ... other plugins
  ],
};
```

## Actions Reference

### Core Messaging

#### `SEND_MESSAGE`
Send text messages to Matrix rooms.

```typescript
{
  action: 'SEND_MESSAGE',
  text: 'Hello, Matrix!',
  roomId: '!general:matrix.org'
}
```

#### `REACT_TO_MESSAGE`
React to messages with emoji.

```typescript
{
  action: 'REACT_TO_MESSAGE',
  eventId: '$event:matrix.org',
  roomId: '!general:matrix.org',
  reaction: '👍'
}
```

### Room Management

#### `JOIN_ROOM`
Join Matrix rooms by ID or alias.

```typescript
{
  action: 'JOIN_ROOM',
  roomId: '!example:matrix.org'
  // or
  roomAlias: '#general:matrix.org'
}
```

#### `LEAVE_ROOM`
Leave Matrix rooms with optional reason.

```typescript
{
  action: 'LEAVE_ROOM',
  roomId: '!example:matrix.org',
  reason: 'Goodbye!'
}
```

#### `LIST_ROOMS`
List all joined rooms with details.

```typescript
{
  action: 'LIST_ROOMS'
}
```

### Media Handling

#### `UPLOAD_MEDIA`
Upload and send media files.

```typescript
{
  action: 'UPLOAD_MEDIA',
  filePath: './image.jpg',
  roomId: '!general:matrix.org',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg'
}
```

#### `DOWNLOAD_MEDIA`
Download media from Matrix.

```typescript
{
  action: 'DOWNLOAD_MEDIA',
  mxcUrl: 'mxc://matrix.org/example',
  outputPath: './downloads/file.jpg'
}
```

### Security

#### `ENABLE_ENCRYPTION`
Enable end-to-end encryption for rooms.

```typescript
{
  action: 'ENABLE_ENCRYPTION',
  roomId: '!secure:matrix.org'
}
```

## Providers Reference

### `MATRIX_ROOM_STATE`
Get comprehensive room information:

```typescript
const roomState = await provider.get(runtime, {
  content: { roomId: '!example:matrix.org' }
});
```

Returns:
- Room name and topic
- Member count and list
- Encryption status
- Room type (DM/Group)
- Bot permissions

### `MATRIX_USER_INFO`
Get user profile information:

```typescript
const userInfo = await provider.get(runtime, {
  content: { userId: '@user:matrix.org' }
});
```

Returns:
- Display name
- Avatar URL
- User ID

## Events

The plugin emits these Matrix-specific events:

- `MATRIX_MESSAGE_RECEIVED` - Incoming messages
- `MATRIX_MESSAGE_SENT` - Outgoing messages  
- `MATRIX_REACTION_RECEIVED` - Reaction events
- `MATRIX_ROOM_JOINED` - Room join events
- `MATRIX_ROOM_LEFT` - Room leave events
- `MATRIX_USER_JOINED` - User join events
- `MATRIX_USER_LEFT` - User leave events

## Architecture

### MatrixService

The core service manages:
- Matrix client lifecycle and authentication
- Real-time event processing and forwarding
- Room membership and permission management
- Media upload/download coordination
- End-to-end encryption handling

### Security Features

- **🔒 E2E Encryption**: Automatic encryption/decryption in encrypted rooms
- **🛡️ Access Control**: Room-based restrictions limit bot access
- **🔑 Token Security**: Secure handling of Matrix access tokens
- **✅ Input Validation**: Comprehensive validation using Zod schemas

### Error Handling

- Graceful degradation when Matrix is unavailable
- Comprehensive logging at all levels
- Automatic retry mechanisms for transient failures
- Clear error messages for configuration issues

## Configuration Examples

### Basic Setup
```bash
MATRIX_HOMESERVER_URL=https://matrix.org
MATRIX_ACCESS_TOKEN=syt_yourtoken_here
MATRIX_USER_ID=@mybot:matrix.org
```

### Private Server
```bash
MATRIX_HOMESERVER_URL=https://matrix.private.com
MATRIX_ACCESS_TOKEN=syt_yourtoken_here
MATRIX_USER_ID=@bot:private.com
MATRIX_ENCRYPTION_ENABLED=true
```

### Restricted Access
```bash
MATRIX_HOMESERVER_URL=https://matrix.org
MATRIX_ACCESS_TOKEN=syt_yourtoken_here
MATRIX_USER_ID=@restrictedbot:matrix.org
MATRIX_ROOM_IDS=!allowed1:matrix.org,!allowed2:matrix.org
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Development Mode

```bash
npm run dev
```

## Testing

The plugin includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Troubleshooting

### Common Issues

**Authentication Failures**
- Verify your access token is valid and not expired
- Ensure your user ID format matches `@username:homeserver.com`
- Check homeserver URL is accessible

**Connection Problems**
- Verify network connectivity to homeserver
- Check firewall settings for Matrix ports
- Validate SSL certificates for HTTPS homeservers

**Permission Errors**
- Ensure bot account has necessary room permissions
- Check if rooms require invitation vs. public join
- Verify encryption keys are properly synchronized

**Encryption Issues**
- Ensure `MATRIX_ENCRYPTION_ENABLED=true` for encrypted rooms
- Verify device keys are properly set up
- Check room encryption state matches expectations

### Debug Logging

Enable detailed logging:

```bash
LOG_LEVEL=debug
```

This provides comprehensive information about:
- Matrix client connection status
- Message processing pipeline
- Room state changes
- Encryption operations
- API call details

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Resources

- **[ElizaOS Documentation](https://docs.elizaos.ai/)** - Framework documentation
- **[Matrix Specification](https://spec.matrix.org/)** - Protocol specification  
- **[Matrix Bot SDK](https://github.com/turt2live/matrix-bot-sdk)** - Underlying SDK
- **[Element](https://element.io/)** - Reference Matrix client

## Support

- **GitHub Issues**: Bug reports and feature requests
- **Matrix Room**: `#elizaos:matrix.org` - Community support
- **Documentation**: Check ElizaOS docs for framework-specific help

---

Built with ❤️ for the ElizaOS ecosystem
