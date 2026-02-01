// ============================================
// PRODUCTION-READY SOCKET.IO SERVER FOR RANDOM CHAT APP
// ============================================
// Optimized for Railway deployment with proper media handling,
// comprehensive error handling, memory management, and crash prevention

const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// ============================================
// ENVIRONMENT CONFIGURATION
// ============================================
const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

// Configuration constants for production stability
const CONFIG = {
  // Memory management
  MAX_WAITING_USERS: parseInt(process.env.MAX_WAITING_USERS) || 1000,
  MAX_ACTIVE_ROOMS: parseInt(process.env.MAX_ACTIVE_ROOMS) || 500,
  QUEUE_TIMEOUT: parseInt(process.env.QUEUE_TIMEOUT_MS) || 5 * 60 * 1000, // 5 minutes
  ROOM_TIMEOUT: parseInt(process.env.ROOM_TIMEOUT_MS) || 30 * 60 * 1000, // 30 minutes
  CLEANUP_INTERVAL: 60 * 1000, // 1 minute
  
  // Message limits
  MAX_MESSAGE_LENGTH: 10000,
  MAX_USERNAME_LENGTH: 50,
  MAX_INTERESTS: 10,
  
  // ============================================
  // MEDIA UPLOAD CONFIGURATION
  // ============================================
  // Separate limits for different media types
  MAX_TEXT_SIZE: 50 * 1024, // 50KB for text messages
  MAX_IMAGE_SIZE: parseInt(process.env.MAX_IMAGE_SIZE_MB) * 1024 * 1024 || 5 * 1024 * 1024, // 5MB default
  MAX_VIDEO_SIZE: parseInt(process.env.MAX_VIDEO_SIZE_MB) * 1024 * 1024 || 15 * 1024 * 1024, // 15MB default
  
  // Socket.IO buffer size (must accommodate largest possible message)
  MAX_HTTP_BUFFER_SIZE: 20 * 1024 * 1024, // 20MB to handle 15MB video + overhead
  
  // Rate limiting
  MESSAGE_RATE_LIMIT: 10, // messages per window
  MESSAGE_RATE_WINDOW: 1000, // 1 second
  MEDIA_RATE_LIMIT: 3, // media messages per window
  MEDIA_RATE_WINDOW: 5000, // 5 seconds (stricter for media)
  
  // Health check
  HEALTH_CHECK_INTERVAL: 30 * 1000, // 30 seconds
};

// Log configuration on startup
console.log('[CONFIG] Media limits:', {
  maxImage: `${CONFIG.MAX_IMAGE_SIZE / 1024 / 1024}MB`,
  maxVideo: `${CONFIG.MAX_VIDEO_SIZE / 1024 / 1024}MB`,
  httpBuffer: `${CONFIG.MAX_HTTP_BUFFER_SIZE / 1024 / 1024}MB`,
});

// ============================================
// INITIALIZE NEXT.JS
// ============================================
const app = next({ dev });
const handler = app.getRequestHandler();

// ============================================
// DATA STRUCTURES WITH SIZE LIMITS
// ============================================
const waitingUsers = new Map();
const activeRooms = new Map();
const socketToRoom = new Map();

// Rate limiting tracking - separate for text and media
const messageRateLimits = new Map();
const mediaRateLimits = new Map();

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Calculate size of base64 encoded data
 */
function getBase64Size(base64String) {
  if (!base64String || typeof base64String !== 'string') return 0;
  
  // Remove data URL prefix if present
  const base64Data = base64String.includes(',') 
    ? base64String.split(',')[1] 
    : base64String;
  
  // Calculate actual size (base64 is ~33% larger than binary)
  const padding = (base64Data.match(/=/g) || []).length;
  return (base64Data.length * 3 / 4) - padding;
}

/**
 * Validates user data to prevent malformed input from crashing server
 */
function validateUserData(userData) {
  if (!userData) {
    return { valid: false, error: 'No user data provided' };
  }

  if (!userData.username || typeof userData.username !== 'string') {
    return { valid: false, error: 'Invalid username' };
  }

  if (userData.username.length > CONFIG.MAX_USERNAME_LENGTH) {
    return { valid: false, error: 'Username too long' };
  }

  if (!['male', 'female'].includes(userData.gender)) {
    return { valid: false, error: 'Invalid gender' };
  }

  if (!['male', 'female', 'any'].includes(userData.preferredGender)) {
    return { valid: false, error: 'Invalid preferred gender' };
  }

  if (!Array.isArray(userData.interests)) {
    return { valid: false, error: 'Interests must be an array' };
  }

  if (userData.interests.length > CONFIG.MAX_INTERESTS) {
    return { valid: false, error: 'Too many interests' };
  }

  // Sanitize interests
  const validInterests = userData.interests
    .filter(i => typeof i === 'string' && i.length > 0 && i.length <= 50)
    .slice(0, CONFIG.MAX_INTERESTS);

  return { 
    valid: true, 
    data: {
      username: userData.username.trim().substring(0, CONFIG.MAX_USERNAME_LENGTH),
      gender: userData.gender,
      preferredGender: userData.preferredGender,
      interests: validInterests
    }
  };
}

/**
 * Validates message data with proper media size checking
 */
function validateMessage(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid message data' };
  }

  const type = data.type || 'text';
  
  if (!['text', 'image', 'video'].includes(type)) {
    return { valid: false, error: 'Invalid message type' };
  }

  if (!data.content || typeof data.content !== 'string') {
    return { valid: false, error: 'Invalid message content' };
  }

  // ============================================
  // MEDIA SIZE VALIDATION (CRITICAL FOR STABILITY)
  // ============================================
  if (type === 'text') {
    // Text messages - check character length
    if (data.content.length > CONFIG.MAX_MESSAGE_LENGTH) {
      return { valid: false, error: 'Message too long' };
    }
    
    // Also check byte size in case of special characters
    const byteSize = Buffer.byteLength(data.content, 'utf8');
    if (byteSize > CONFIG.MAX_TEXT_SIZE) {
      return { valid: false, error: 'Message size too large' };
    }
  } 
  else if (type === 'image') {
    // Image messages - validate base64 and check size
    if (!data.content.startsWith('data:image/')) {
      return { valid: false, error: 'Invalid image format' };
    }
    
    const imageSize = getBase64Size(data.content);
    console.log(`[VALIDATION] Image size: ${(imageSize / 1024 / 1024).toFixed(2)}MB`);
    
    if (imageSize > CONFIG.MAX_IMAGE_SIZE) {
      const maxMB = CONFIG.MAX_IMAGE_SIZE / 1024 / 1024;
      return { 
        valid: false, 
        error: `Image too large. Maximum size is ${maxMB}MB` 
      };
    }
    
    // Additional check: ensure it's a supported image type
    if (!data.content.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,/)) {
      return { valid: false, error: 'Unsupported image type. Use JPEG, PNG, GIF, or WebP' };
    }
  } 
  else if (type === 'video') {
    // Video messages - validate base64 and check size
    if (!data.content.startsWith('data:video/')) {
      return { valid: false, error: 'Invalid video format' };
    }
    
    const videoSize = getBase64Size(data.content);
    console.log(`[VALIDATION] Video size: ${(videoSize / 1024 / 1024).toFixed(2)}MB`);
    
    if (videoSize > CONFIG.MAX_VIDEO_SIZE) {
      const maxMB = CONFIG.MAX_VIDEO_SIZE / 1024 / 1024;
      return { 
        valid: false, 
        error: `Video too large. Maximum size is ${maxMB}MB` 
      };
    }
    
    // Additional check: ensure it's a supported video type
    if (!data.content.match(/^data:video\/(mp4|webm|ogg);base64,/)) {
      return { valid: false, error: 'Unsupported video type. Use MP4, WebM, or OGG' };
    }
  }

  return { valid: true };
}

/**
 * Check rate limiting for messages (separate limits for text and media)
 */
function checkRateLimit(socketId, isMedia = false) {
  const now = Date.now();
  const rateLimitMap = isMedia ? mediaRateLimits : messageRateLimits;
  const limit = isMedia ? CONFIG.MEDIA_RATE_LIMIT : CONFIG.MESSAGE_RATE_LIMIT;
  const window = isMedia ? CONFIG.MEDIA_RATE_WINDOW : CONFIG.MESSAGE_RATE_WINDOW;
  
  const userLimits = rateLimitMap.get(socketId) || { count: 0, windowStart: now };

  // Reset window if expired
  if (now - userLimits.windowStart > window) {
    userLimits.count = 0;
    userLimits.windowStart = now;
  }

  userLimits.count++;
  rateLimitMap.set(socketId, userLimits);

  const allowed = userLimits.count <= limit;
  
  if (!allowed && isMedia) {
    console.warn(`[RATE LIMIT] Socket ${socketId} exceeded media rate limit`);
  }

  return allowed;
}

/**
 * Matching algorithm with error handling
 */
function findMatch(user, socketId) {
  try {
    const compatibleMatches = [];

    for (const [waitingSocketId, waitingUser] of waitingUsers.entries()) {
      if (waitingSocketId === socketId) continue;

      const currentUserGenderMatch = 
        user.preferredGender === 'any' || 
        user.preferredGender === waitingUser.gender;

      const waitingUserGenderMatch = 
        waitingUser.preferredGender === 'any' || 
        waitingUser.preferredGender === user.gender;

      if (currentUserGenderMatch && waitingUserGenderMatch) {
        const commonInterests = user.interests.filter(
          interest => waitingUser.interests.includes(interest)
        );

        const matchScore = commonInterests.length;

        compatibleMatches.push({
          user: waitingUser,
          socketId: waitingSocketId,
          score: matchScore,
          commonInterests: commonInterests
        });
      }
    }

    if (compatibleMatches.length === 0) {
      return null;
    }

    const highestScore = Math.max(...compatibleMatches.map(m => m.score));
    const bestMatches = compatibleMatches.filter(m => m.score === highestScore);
    const randomIndex = Math.floor(Math.random() * bestMatches.length);
    const selectedMatch = bestMatches[randomIndex];

    console.log(`[MATCHING] Found ${compatibleMatches.length} compatible users, ${bestMatches.length} with highest score`);

    return {
      user: selectedMatch.user,
      socketId: selectedMatch.socketId,
      commonInterests: selectedMatch.commonInterests
    };
  } catch (error) {
    console.error('[MATCHING ERROR]', error);
    return null;
  }
}

/**
 * Clean up stale waiting users
 */
function cleanupWaitingUsers() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [socketId, user] of waitingUsers.entries()) {
    if (now - user.joinedAt > CONFIG.QUEUE_TIMEOUT) {
      waitingUsers.delete(socketId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[CLEANUP] Removed ${cleanedCount} stale waiting users`);
  }
}

/**
 * Clean up stale rooms
 */
function cleanupStaleRooms(io) {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [roomId, room] of activeRooms.entries()) {
    if (now - room.createdAt > CONFIG.ROOM_TIMEOUT) {
      // Notify users
      io.to(roomId).emit('chat-ended', {
        reason: 'Session timeout'
      });

      // Clean up
      socketToRoom.delete(room.user1.socketId);
      socketToRoom.delete(room.user2.socketId);
      
      const socket1 = io.sockets.sockets.get(room.user1.socketId);
      const socket2 = io.sockets.sockets.get(room.user2.socketId);
      
      if (socket1) socket1.leave(roomId);
      if (socket2) socket2.leave(roomId);
      
      activeRooms.delete(roomId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[CLEANUP] Removed ${cleanedCount} stale rooms`);
  }
}

/**
 * Clean up rate limit tracking
 */
function cleanupRateLimits() {
  const now = Date.now();
  
  for (const [socketId, limits] of messageRateLimits.entries()) {
    if (now - limits.windowStart > CONFIG.MESSAGE_RATE_WINDOW * 10) {
      messageRateLimits.delete(socketId);
    }
  }
  
  for (const [socketId, limits] of mediaRateLimits.entries()) {
    if (now - limits.windowStart > CONFIG.MEDIA_RATE_WINDOW * 10) {
      mediaRateLimits.delete(socketId);
    }
  }
}

/**
 * Check memory usage and enforce limits
 */
function enforceMemoryLimits() {
  // Limit waiting users
  if (waitingUsers.size > CONFIG.MAX_WAITING_USERS) {
    const excess = waitingUsers.size - CONFIG.MAX_WAITING_USERS;
    const sortedUsers = Array.from(waitingUsers.entries())
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt); // Remove oldest first
    
    for (let i = 0; i < excess; i++) {
      waitingUsers.delete(sortedUsers[i][0]);
    }
    
    console.warn(`[MEMORY] Removed ${excess} oldest users to enforce waiting limit`);
  }

  // Limit active rooms
  if (activeRooms.size > CONFIG.MAX_ACTIVE_ROOMS) {
    const excess = activeRooms.size - CONFIG.MAX_ACTIVE_ROOMS;
    const sortedRooms = Array.from(activeRooms.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt); // Remove oldest first
    
    for (let i = 0; i < excess; i++) {
      const [roomId, room] = sortedRooms[i];
      socketToRoom.delete(room.user1.socketId);
      socketToRoom.delete(room.user2.socketId);
      activeRooms.delete(roomId);
    }
    
    console.warn(`[MEMORY] Removed ${excess} oldest rooms to enforce room limit`);
  }
}

/**
 * Get server health metrics
 */
function getHealthMetrics() {
  const memUsage = process.memoryUsage();
  
  return {
    status: 'healthy',
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    metrics: {
      waitingUsers: waitingUsers.size,
      activeRooms: activeRooms.size,
      socketMappings: socketToRoom.size,
      messageRateLimits: messageRateLimits.size,
      mediaRateLimits: mediaRateLimits.size,
    },
    config: {
      maxImageSizeMB: CONFIG.MAX_IMAGE_SIZE / 1024 / 1024,
      maxVideoSizeMB: CONFIG.MAX_VIDEO_SIZE / 1024 / 1024,
    },
    timestamp: new Date().toISOString(),
  };
}

// ============================================
// MAIN SERVER INITIALIZATION
// ============================================
app.prepare().then(() => {
  const httpServer = createServer(handler);

  // ============================================
  // SOCKET.IO SERVER CONFIGURATION
  // ============================================
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    
    // ============================================
    // CRITICAL: Proper timeout configuration
    // ============================================
    pingTimeout: 60000,
    pingInterval: 25000,
    
    // ============================================
    // CRITICAL: Buffer size for media uploads
    // ============================================
    // This MUST be larger than MAX_VIDEO_SIZE to prevent crashes
    maxHttpBufferSize: CONFIG.MAX_HTTP_BUFFER_SIZE,
    
    connectTimeout: 45000,
    allowUpgrades: true,
    perMessageDeflate: {
      threshold: 1024, // Only compress messages > 1KB
    },
    
    // ============================================
    // CRITICAL: Handle upgrade errors gracefully
    // ============================================
    handlePreflightRequest: (req, res) => {
      const headers = {
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Origin": req.headers.origin || '*',
        "Access-Control-Allow-Credentials": true,
        "Access-Control-Max-Age": 1728000,
      };
      res.writeHead(200, headers);
      res.end();
    },
  });

  // ============================================
  // GLOBAL ERROR HANDLER FOR SOCKET.IO
  // ============================================
  io.engine.on('connection_error', (err) => {
    console.error('[ENGINE ERROR]', {
      code: err.code,
      message: err.message,
      context: err.context,
    });
    // Don't crash - just log
  });

  // ============================================
  // PERIODIC CLEANUP TASKS
  // ============================================
  const cleanupInterval = setInterval(() => {
    try {
      cleanupWaitingUsers();
      cleanupStaleRooms(io);
      cleanupRateLimits();
      enforceMemoryLimits();
    } catch (error) {
      console.error('[CLEANUP ERROR]', error);
      // Don't let cleanup errors crash the server
    }
  }, CONFIG.CLEANUP_INTERVAL);

  // ============================================
  // HEALTH CHECK MONITORING
  // ============================================
  const healthInterval = setInterval(() => {
    try {
      const health = getHealthMetrics();
      console.log('[HEALTH]', JSON.stringify(health));
      
      // Warning if memory high
      if (health.memory.heapUsedPercent > 85) {
        console.warn('[WARNING] High memory usage:', health.memory.heapUsedPercent + '%');
      }
    } catch (error) {
      console.error('[HEALTH CHECK ERROR]', error);
    }
  }, CONFIG.HEALTH_CHECK_INTERVAL);

  // ============================================
  // SOCKET CONNECTION EVENT HANDLER
  // ============================================
  io.on('connection', (socket) => {
    console.log(`[CONNECTION] New user connected: ${socket.id}`);

    // ============================================
    // SOCKET ERROR HANDLER (CRITICAL)
    // ============================================
    socket.on('error', (error) => {
      console.error(`[SOCKET ERROR] ${socket.id}:`, error);
      // Don't crash - errors are isolated per socket
    });

    // ============================================
    // JOIN QUEUE EVENT HANDLER
    // ============================================
    socket.on('join-queue', (userData) => {
      try {
        // Validate user data
        const validation = validateUserData(userData);
        if (!validation.valid) {
          console.warn(`[VALIDATION ERROR] ${socket.id}: ${validation.error}`);
          socket.emit('error', { message: validation.error });
          return;
        }

        const validData = validation.data;
        console.log(`[JOIN QUEUE] User ${socket.id} joining queue:`, validData.username);

        // Check if already in queue or room
        if (waitingUsers.has(socket.id) || socketToRoom.has(socket.id)) {
          socket.emit('error', { message: 'Already in queue or chat' });
          return;
        }

        const user = {
          ...validData,
          joinedAt: Date.now(),
        };

        const match = findMatch(user, socket.id);

        if (match) {
          console.log(`[MATCH FOUND] Matching ${socket.id} with ${match.socketId}`);

          const roomId = uuidv4();
          waitingUsers.delete(match.socketId);

          socket.join(roomId);

          const matchSocket = io.sockets.sockets.get(match.socketId);
          if (matchSocket) {
            matchSocket.join(roomId);
          } else {
            console.warn(`[MATCH ERROR] Match socket ${match.socketId} not found`);
            waitingUsers.set(socket.id, user);
            socket.emit('searching');
            return;
          }

          activeRooms.set(roomId, {
            user1: { socketId: socket.id, ...user },
            user2: { socketId: match.socketId, ...match.user },
            createdAt: Date.now(),
          });

          socketToRoom.set(socket.id, roomId);
          socketToRoom.set(match.socketId, roomId);

          const commonInterests = match.commonInterests || [];

          socket.emit('match-found', {
            roomId,
            partner: {
              username: match.user.username,
              gender: match.user.gender,
              interests: match.user.interests,
            },
            commonInterests,
          });

          if (matchSocket) {
            matchSocket.emit('match-found', {
              roomId,
              partner: {
                username: user.username,
                gender: user.gender,
                interests: user.interests,
              },
              commonInterests,
            });
          }

          console.log(`[ROOM CREATED] Room ${roomId} created`);
        } else {
          waitingUsers.set(socket.id, user);
          socket.emit('searching');
          console.log(`[WAITING] User ${socket.id} added to queue. Queue size: ${waitingUsers.size}`);
        }
      } catch (error) {
        console.error(`[JOIN QUEUE ERROR] ${socket.id}:`, error);
        socket.emit('error', { message: 'Failed to join queue' });
      }
    });

    // ============================================
    // LEAVE QUEUE EVENT HANDLER
    // ============================================
    socket.on('leave-queue', () => {
      try {
        waitingUsers.delete(socket.id);
        console.log(`[LEAVE QUEUE] User ${socket.id} left the queue`);
      } catch (error) {
        console.error(`[LEAVE QUEUE ERROR] ${socket.id}:`, error);
      }
    });

    // ============================================
    // SEND MESSAGE EVENT HANDLER (WITH MEDIA SUPPORT)
    // ============================================
    socket.on('send-message', (data) => {
      try {
        const isMedia = data.type === 'image' || data.type === 'video';
        
        // Rate limiting (stricter for media)
        if (!checkRateLimit(socket.id, isMedia)) {
          const limitType = isMedia ? 'media' : 'message';
          const waitTime = isMedia 
            ? Math.ceil(CONFIG.MEDIA_RATE_WINDOW / 1000) 
            : Math.ceil(CONFIG.MESSAGE_RATE_WINDOW / 1000);
          
          socket.emit('error', { 
            message: `Too many ${limitType}s. Please wait ${waitTime} seconds.` 
          });
          return;
        }

        // Validate message (includes media size validation)
        const validation = validateMessage(data);
        if (!validation.valid) {
          console.warn(`[MESSAGE VALIDATION ERROR] ${socket.id}: ${validation.error}`);
          socket.emit('error', { message: validation.error });
          return;
        }

        const roomId = socketToRoom.get(socket.id);
        if (!roomId) {
          socket.emit('error', { message: 'Not in a chat room' });
          return;
        }

        // Verify room still exists
        if (!activeRooms.has(roomId)) {
          socket.emit('error', { message: 'Chat room no longer exists' });
          socketToRoom.delete(socket.id);
          return;
        }

        const message = {
          id: uuidv4(),
          senderId: socket.id,
          content: data.content,
          type: data.type || 'text',
          timestamp: Date.now(),
        };

        // Log media transfers
        if (isMedia) {
          const sizeMB = (getBase64Size(data.content) / 1024 / 1024).toFixed(2);
          console.log(`[MEDIA] Room ${roomId}: ${data.type} (${sizeMB}MB) from ${socket.id}`);
        }

        io.to(roomId).emit('new-message', message);
        
      } catch (error) {
        console.error(`[SEND MESSAGE ERROR] ${socket.id}:`, error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ============================================
    // WEBRTC SIGNALING: OFFER
    // ============================================
    socket.on('webrtc-offer', (data) => {
      try {
        const roomId = socketToRoom.get(socket.id);
        if (roomId && activeRooms.has(roomId)) {
          socket.broadcast.to(roomId).emit('webrtc-offer', {
            offer: data.offer,
            from: socket.id,
          });
          console.log(`[WEBRTC] Offer sent in room ${roomId}`);
        }
      } catch (error) {
        console.error(`[WEBRTC OFFER ERROR] ${socket.id}:`, error);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: ANSWER
    // ============================================
    socket.on('webrtc-answer', (data) => {
      try {
        const roomId = socketToRoom.get(socket.id);
        if (roomId && activeRooms.has(roomId)) {
          socket.broadcast.to(roomId).emit('webrtc-answer', {
            answer: data.answer,
            from: socket.id,
          });
          console.log(`[WEBRTC] Answer sent in room ${roomId}`);
        }
      } catch (error) {
        console.error(`[WEBRTC ANSWER ERROR] ${socket.id}:`, error);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: ICE CANDIDATE
    // ============================================
    socket.on('webrtc-ice-candidate', (data) => {
      try {
        const roomId = socketToRoom.get(socket.id);
        if (roomId && activeRooms.has(roomId)) {
          socket.broadcast.to(roomId).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            from: socket.id,
          });
        }
      } catch (error) {
        console.error(`[WEBRTC ICE ERROR] ${socket.id}:`, error);
      }
    });

    // ============================================
    // END CHAT EVENT HANDLER
    // ============================================
    socket.on('end-chat', () => {
      try {
        const roomId = socketToRoom.get(socket.id);
        if (!roomId) return;

        io.to(roomId).emit('chat-ended', {
          reason: 'User left the chat',
        });

        const room = activeRooms.get(roomId);
        if (room) {
          socketToRoom.delete(room.user1.socketId);
          socketToRoom.delete(room.user2.socketId);

          const socket1 = io.sockets.sockets.get(room.user1.socketId);
          const socket2 = io.sockets.sockets.get(room.user2.socketId);

          if (socket1) socket1.leave(roomId);
          if (socket2) socket2.leave(roomId);
        }

        activeRooms.delete(roomId);
        console.log(`[ROOM CLOSED] Room ${roomId} closed by user`);
      } catch (error) {
        console.error(`[END CHAT ERROR] ${socket.id}:`, error);
      }
    });

    // ============================================
    // TYPING INDICATOR
    // ============================================
    socket.on('typing', (isTyping) => {
      try {
        const roomId = socketToRoom.get(socket.id);
        if (roomId && activeRooms.has(roomId)) {
          socket.broadcast.to(roomId).emit('partner-typing', isTyping);
        }
      } catch (error) {
        console.error(`[TYPING ERROR] ${socket.id}:`, error);
      }
    });

    // ============================================
    // DISCONNECT EVENT HANDLER
    // ============================================
    socket.on('disconnect', () => {
      try {
        console.log(`[DISCONNECT] User disconnected: ${socket.id}`);

        waitingUsers.delete(socket.id);
        messageRateLimits.delete(socket.id);
        mediaRateLimits.delete(socket.id);

        const roomId = socketToRoom.get(socket.id);
        if (roomId) {
          socket.broadcast.to(roomId).emit('chat-ended', {
            reason: 'Partner disconnected',
          });

          const room = activeRooms.get(roomId);
          if (room) {
            const partnerSocketId = 
              room.user1.socketId === socket.id 
                ? room.user2.socketId 
                : room.user1.socketId;
            
            socketToRoom.delete(partnerSocketId);
            
            const partnerSocket = io.sockets.sockets.get(partnerSocketId);
            if (partnerSocket) {
              partnerSocket.leave(roomId);
            }
          }

          socketToRoom.delete(socket.id);
          activeRooms.delete(roomId);
          console.log(`[CLEANUP] Room ${roomId} cleaned up after disconnect`);
        }
      } catch (error) {
        console.error(`[DISCONNECT ERROR] ${socket.id}:`, error);
      }
    });
  });

  // ============================================
  // GLOBAL ERROR HANDLERS
  // ============================================
  process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    console.error('Stack:', error.stack);
    // Log but don't exit - Railway will restart anyway if needed
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
    console.error('Promise:', promise);
    // Log but don't exit
  });

  // ============================================
  // GRACEFUL SHUTDOWN (CRITICAL FOR RAILWAY)
  // ============================================
  const gracefulShutdown = (signal) => {
    console.log(`\n[${signal}] Graceful shutdown initiated...`);
    
    // Stop accepting new connections
    httpServer.close(() => {
      console.log('[SHUTDOWN] HTTP server closed');
    });

    // Clear intervals
    clearInterval(cleanupInterval);
    clearInterval(healthInterval);

    // Notify all connected users
    io.emit('server-shutdown', { 
      message: 'Server is restarting. Please reconnect in a moment.' 
    });

    // Close all socket connections gracefully
    io.close(() => {
      console.log('[SHUTDOWN] Socket.IO server closed');
      
      // Final cleanup
      waitingUsers.clear();
      activeRooms.clear();
      socketToRoom.clear();
      messageRateLimits.clear();
      mediaRateLimits.clear();
      
      console.log('[SHUTDOWN] Cleanup complete');
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      console.log('[SHUTDOWN] Forcing exit after timeout');
      process.exit(0);
    }, 10000);
  };

  // Listen for termination signals (Railway uses SIGTERM)
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // ============================================
  // START THE HTTP SERVER
  // ============================================
  httpServer.listen(port, '0.0.0.0', () => {
    console.log('='.repeat(70));
    console.log(`🚀 Server listening on port ${port}`);
    console.log(`🌍 Environment: ${dev ? 'development' : 'production'}`);
    console.log(`💾 Memory limits: ${CONFIG.MAX_WAITING_USERS} waiting users, ${CONFIG.MAX_ACTIVE_ROOMS} rooms`);
    console.log(`📸 Image limit: ${CONFIG.MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    console.log(`🎥 Video limit: ${CONFIG.MAX_VIDEO_SIZE / 1024 / 1024}MB`);
    console.log(`📦 HTTP buffer: ${CONFIG.MAX_HTTP_BUFFER_SIZE / 1024 / 1024}MB`);
    console.log(`🧹 Cleanup interval: ${CONFIG.CLEANUP_INTERVAL / 1000}s`);
    console.log(`⏱️  Queue timeout: ${CONFIG.QUEUE_TIMEOUT / 1000}s`);
    console.log(`📊 Health check interval: ${CONFIG.HEALTH_CHECK_INTERVAL / 1000}s`);
    console.log('='.repeat(70));
  });
}).catch((error) => {
  console.error('[STARTUP ERROR]', error);
  process.exit(1);
});