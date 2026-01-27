// ============================================
// CUSTOM SOCKET.IO SERVER FOR RANDOM CHAT APP
// ============================================
// This file creates a custom HTTP server with Socket.io
// for real-time WebSocket communication between users

// Import the HTTP module from Node.js to create a server
const { createServer } = require('http');

// Import Next.js to handle page rendering
const next = require('next');

// Import Socket.io Server class for WebSocket functionality
const { Server } = require('socket.io');

// Import UUID generator for creating unique room IDs
const { v4: uuidv4 } = require('uuid');

// Check if we're in development or production mode
// process.env.NODE_ENV is set by Node.js environment
const dev = process.env.NODE_ENV !== 'production';

// Get the hostname from environment or default to '0.0.0.0'
// '0.0.0.0' allows connections from any network interface
const hostname = process.env.HOSTNAME || '0.0.0.0';

// Get the port from environment or default to 3000
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js application with configuration
// dev: enables hot reloading in development
// hostname: the server's hostname
// port: the server's port number
const app = next({ dev, hostname, port });

// Get the default request handler from Next.js
// This handles all HTTP requests for pages and API routes
const handler = app.getRequestHandler();

// ============================================
// WAITING QUEUE DATA STRUCTURE
// ============================================
// This Map stores users who are waiting to be matched
// Key: socket.id (unique identifier for each connection)
// Value: user object containing their preferences
const waitingUsers = new Map();

// ============================================
// ACTIVE ROOMS DATA STRUCTURE
// ============================================
// This Map stores active chat rooms with connected users
// Key: roomId (unique identifier for each room)
// Value: object containing both users' socket IDs and info
const activeRooms = new Map();

// ============================================
// SOCKET TO ROOM MAPPING
// ============================================
// This Map helps quickly find which room a socket belongs to
// Key: socket.id
// Value: roomId
const socketToRoom = new Map();

// ============================================
// MATCHING ALGORITHM FUNCTION
// ============================================
// This function finds a compatible match for a user
// based on gender preferences and common interests
// When multiple users have the same match score, it randomly selects one
function findMatch(user, socketId) {
  // Array to store all compatible matches with their scores
  // This allows us to randomly select from users with equal scores
  const compatibleMatches = [];

  // Iterate through all users in the waiting queue
  // entries() returns [key, value] pairs
  for (const [waitingSocketId, waitingUser] of waitingUsers.entries()) {
    // Skip if it's the same user (can't match with yourself)
    if (waitingSocketId === socketId) continue;

    // ============================================
    // GENDER PREFERENCE MATCHING LOGIC
    // ============================================
    
    // Check if current user wants to chat with 'any' gender
    // OR if the waiting user's gender matches current user's preference
    const currentUserGenderMatch = 
      user.preferredGender === 'any' || 
      user.preferredGender === waitingUser.gender;

    // Check if waiting user wants to chat with 'any' gender
    // OR if current user's gender matches waiting user's preference
    const waitingUserGenderMatch = 
      waitingUser.preferredGender === 'any' || 
      waitingUser.preferredGender === user.gender;

    // Both gender preferences must be satisfied for a valid match
    if (currentUserGenderMatch && waitingUserGenderMatch) {
      // ============================================
      // INTEREST MATCHING SCORE CALCULATION
      // ============================================
      
      // Calculate how many interests both users share
      // filter() keeps only interests that exist in both arrays
      const commonInterests = user.interests.filter(
        // Check if each interest exists in the waiting user's interests
        interest => waitingUser.interests.includes(interest)
      );

      // Get the count of common interests as the match score
      const matchScore = commonInterests.length;

      // Add this compatible user to the matches array
      // Store all the data we need for later use
      compatibleMatches.push({
        user: waitingUser,
        socketId: waitingSocketId,
        score: matchScore,
        commonInterests: commonInterests
      });
    }
  }

  // ============================================
  // RANDOM SELECTION FROM COMPATIBLE MATCHES
  // ============================================
  // If no compatible matches found, return null
  if (compatibleMatches.length === 0) {
    return null;
  }

  // Find the highest score among all matches
  const highestScore = Math.max(...compatibleMatches.map(m => m.score));

  // Filter to get only the matches with the highest score
  // This ensures we pick from the best matches
  const bestMatches = compatibleMatches.filter(m => m.score === highestScore);

  // Randomly select one match from the best matches
  // Math.random() gives a random number between 0 and 1
  // Multiply by array length and floor to get random index
  const randomIndex = Math.floor(Math.random() * bestMatches.length);
  const selectedMatch = bestMatches[randomIndex];

  // Log the selection for debugging
  console.log(`[MATCHING] Found ${compatibleMatches.length} compatible users, ${bestMatches.length} with highest score. Randomly selected index ${randomIndex}`);

  // Return the selected match with user data and socket ID
  return {
    user: selectedMatch.user,
    socketId: selectedMatch.socketId
  };
}

// ============================================
// MAIN SERVER INITIALIZATION
// ============================================
// Prepare Next.js application before starting the server
app.prepare().then(() => {
  // Create an HTTP server that delegates to Next.js handler
  // This server will handle both HTTP requests and WebSocket connections
  const httpServer = createServer(handler);

  // ============================================
  // SOCKET.IO SERVER CONFIGURATION
  // ============================================
  // Initialize Socket.io with the HTTP server
  const io = new Server(httpServer, {
    // CORS (Cross-Origin Resource Sharing) configuration
    // This allows connections from different domains
    cors: {
      // Allow requests from any origin (* means all)
      origin: '*',
      
      // HTTP methods allowed for the connection
      methods: ['GET', 'POST'],
    },
    
    // Path where Socket.io will listen for connections
    // Clients must connect to this specific path
    path: '/socket.io',
    
    // Add these options for better compatibility
    transports: ['websocket', 'polling'],
    
    // Increase ping timeout for better stability
    pingTimeout: 60000,
    
    // ============================================
    // CRITICAL: Increase max buffer size for images/videos
    // ============================================
    // Default is 1MB, increase to 100MB to handle large files
    maxHttpBufferSize: 100 * 1024 * 1024, // 100MB max buffer size
  });

  // ============================================
  // SOCKET CONNECTION EVENT HANDLER
  // ============================================
  // This event fires whenever a new client connects
  io.on('connection', (socket) => {
    // Log the new connection with the socket's unique ID
    console.log(`[CONNECTION] New user connected: ${socket.id}`);

    // ============================================
    // JOIN QUEUE EVENT HANDLER
    // ============================================
    // This event is triggered when a user wants to find a match
    socket.on('join-queue', (userData) => {
      // Log the user's data for debugging purposes
      console.log(`[JOIN QUEUE] User ${socket.id} joining queue:`, userData);

      // Create a user object with all necessary information
      const user = {
        // The display name chosen by the user
        username: userData.username,
        
        // The user's gender (male/female)
        gender: userData.gender,
        
        // The gender the user wants to chat with (male/female/any)
        preferredGender: userData.preferredGender,
        
        // Array of interests selected by the user
        interests: userData.interests || [],
        
        // Timestamp when user joined the queue (for timeout purposes)
        joinedAt: Date.now(),
      };

      // Try to find a compatible match from the waiting queue
      const match = findMatch(user, socket.id);

      // Check if a compatible match was found
      if (match) {
        // ============================================
        // MATCH FOUND - CREATE CHAT ROOM
        // ============================================
        
        // Log the successful match
        console.log(`[MATCH FOUND] Matching ${socket.id} with ${match.socketId}`);

        // Generate a unique room ID using UUID
        const roomId = uuidv4();

        // Remove the matched user from the waiting queue
        // since they're now going to be in a room
        waitingUsers.delete(match.socketId);

        // Add the current user's socket to the room
        // Socket.io rooms allow broadcasting to specific groups
        socket.join(roomId);

        // Get the matched user's socket object from Socket.io
        const matchSocket = io.sockets.sockets.get(match.socketId);
        
        // If the matched user's socket still exists, add them to the room
        if (matchSocket) {
          matchSocket.join(roomId);
        }

        // ============================================
        // STORE ROOM AND MAPPING DATA
        // ============================================
        
        // Store the room data in activeRooms Map
        activeRooms.set(roomId, {
          // First user in the room (current user)
          user1: { socketId: socket.id, ...user },
          
          // Second user in the room (matched user)
          user2: { socketId: match.socketId, ...match.user },
          
          // Timestamp when the room was created
          createdAt: Date.now(),
        });

        // Map both sockets to this room for quick lookup
        socketToRoom.set(socket.id, roomId);
        socketToRoom.set(match.socketId, roomId);

        // Calculate common interests between the two users
        // This will be displayed in the chat UI
        const commonInterests = user.interests.filter(
          interest => match.user.interests.includes(interest)
        );

        // ============================================
        // NOTIFY BOTH USERS OF THE MATCH
        // ============================================
        
        // Send match notification to the current user
        socket.emit('match-found', {
          // The room ID they've been assigned to
          roomId,
          
          // Information about their chat partner
          partner: {
            username: match.user.username,
            gender: match.user.gender,
            interests: match.user.interests,
          },
          
          // Shared interests between both users
          commonInterests,
        });

        // Send match notification to the matched user
        if (matchSocket) {
          matchSocket.emit('match-found', {
            // The room ID they've been assigned to
            roomId,
            
            // Information about their chat partner (current user)
            partner: {
              username: user.username,
              gender: user.gender,
              interests: user.interests,
            },
            
            // Shared interests between both users
            commonInterests,
          });
        }

        // Log the room creation for debugging
        console.log(`[ROOM CREATED] Room ${roomId} created with ${socket.id} and ${match.socketId}`);
      } else {
        // ============================================
        // NO MATCH FOUND - ADD TO WAITING QUEUE
        // ============================================
        
        // Add the user to the waiting queue
        waitingUsers.set(socket.id, user);
        
        // Notify the user that they're now searching
        socket.emit('searching');
        
        // Log the queue addition
        console.log(`[WAITING] User ${socket.id} added to waiting queue. Queue size: ${waitingUsers.size}`);
      }
    });

    // ============================================
    // LEAVE QUEUE EVENT HANDLER
    // ============================================
    // This event is triggered when a user cancels their search
    socket.on('leave-queue', () => {
      // Remove the user from the waiting queue
      waitingUsers.delete(socket.id);
      
      // Log the queue removal
      console.log(`[LEAVE QUEUE] User ${socket.id} left the queue`);
    });

    // ============================================
    // SEND MESSAGE EVENT HANDLER
    // ============================================
    // This event is triggered when a user sends a chat message
    socket.on('send-message', (data) => {
      // Get the room ID that this socket belongs to
      const roomId = socketToRoom.get(socket.id);
      
      // Only proceed if the user is in a valid room
      if (roomId) {
        // Create a message object with all necessary data
        const message = {
          // Unique identifier for the message
          id: uuidv4(),
          
          // The socket ID of the sender
          senderId: socket.id,
          
          // The text content of the message
          content: data.content,
          
          // Type of message (text, image, video)
          type: data.type || 'text',
          
          // Timestamp when the message was sent
          timestamp: Date.now(),
        };

        // Broadcast the message to everyone in the room
        // This includes the sender for confirmation
        io.to(roomId).emit('new-message', message);
        
        // Log the message for debugging (truncate long content)
        console.log(`[MESSAGE] In room ${roomId}: ${data.type || 'text'} message`);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: OFFER EVENT HANDLER
    // ============================================
    // This event forwards WebRTC offers for peer-to-peer connections
    socket.on('webrtc-offer', (data) => {
      // Get the room ID that this socket belongs to
      const roomId = socketToRoom.get(socket.id);
      
      // Only proceed if the user is in a valid room
      if (roomId) {
        // Forward the offer to other users in the room
        // broadcast.to() sends to everyone except the sender
        socket.broadcast.to(roomId).emit('webrtc-offer', {
          // The WebRTC offer signal data
          offer: data.offer,
          
          // The socket ID of who sent the offer
          from: socket.id,
        });
        
        // Log the signaling event
        console.log(`[WEBRTC] Offer sent in room ${roomId}`);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: ANSWER EVENT HANDLER
    // ============================================
    // This event forwards WebRTC answers for peer-to-peer connections
    socket.on('webrtc-answer', (data) => {
      // Get the room ID that this socket belongs to
      const roomId = socketToRoom.get(socket.id);
      
      // Only proceed if the user is in a valid room
      if (roomId) {
        // Forward the answer to other users in the room
        socket.broadcast.to(roomId).emit('webrtc-answer', {
          // The WebRTC answer signal data
          answer: data.answer,
          
          // The socket ID of who sent the answer
          from: socket.id,
        });
        
        // Log the signaling event
        console.log(`[WEBRTC] Answer sent in room ${roomId}`);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: ICE CANDIDATE EVENT HANDLER
    // ============================================
    // ICE candidates are used to establish the best connection path
    socket.on('webrtc-ice-candidate', (data) => {
      // Get the room ID that this socket belongs to
      const roomId = socketToRoom.get(socket.id);
      
      // Only proceed if the user is in a valid room
      if (roomId) {
        // Forward the ICE candidate to other users in the room
        socket.broadcast.to(roomId).emit('webrtc-ice-candidate', {
          // The ICE candidate data
          candidate: data.candidate,
          
          // The socket ID of who sent the candidate
          from: socket.id,
        });
      }
    });

    // ============================================
    // END CHAT EVENT HANDLER
    // ============================================
    // This event is triggered when a user wants to end the chat
    socket.on('end-chat', () => {
      // Get the room ID that this socket belongs to
      const roomId = socketToRoom.get(socket.id);
      
      // Only proceed if the user is in a valid room
      if (roomId) {
        // Notify all users in the room that the chat has ended
        io.to(roomId).emit('chat-ended', {
          // Reason for ending the chat
          reason: 'User left the chat',
        });

        // Get the room data to clean up both users
        const room = activeRooms.get(roomId);
        
        if (room) {
          // Remove socket-to-room mappings for both users
          socketToRoom.delete(room.user1.socketId);
          socketToRoom.delete(room.user2.socketId);

          // Get socket objects for both users
          const socket1 = io.sockets.sockets.get(room.user1.socketId);
          const socket2 = io.sockets.sockets.get(room.user2.socketId);

          // Make both users leave the Socket.io room
          if (socket1) socket1.leave(roomId);
          if (socket2) socket2.leave(roomId);
        }

        // Delete the room from active rooms
        activeRooms.delete(roomId);
        
        // Log the room closure
        console.log(`[ROOM CLOSED] Room ${roomId} has been closed`);
      }
    });

    // ============================================
    // TYPING INDICATOR EVENT HANDLER
    // ============================================
    // This event notifies the partner when user is typing
    socket.on('typing', (isTyping) => {
      // Get the room ID that this socket belongs to
      const roomId = socketToRoom.get(socket.id);
      
      // Only proceed if the user is in a valid room
      if (roomId) {
        // Broadcast typing status to other users in the room
        socket.broadcast.to(roomId).emit('partner-typing', isTyping);
      }
    });

    // ============================================
    // DISCONNECT EVENT HANDLER
    // ============================================
    // This event fires when a user disconnects (closes browser, loses connection)
    socket.on('disconnect', () => {
      // Log the disconnection
      console.log(`[DISCONNECT] User disconnected: ${socket.id}`);

      // Remove from waiting queue if they were searching
      waitingUsers.delete(socket.id);

      // Check if user was in an active room
      const roomId = socketToRoom.get(socket.id);
      
      if (roomId) {
        // Notify the partner that this user disconnected
        socket.broadcast.to(roomId).emit('chat-ended', {
          reason: 'Partner disconnected',
        });

        // Get the room data for cleanup
        const room = activeRooms.get(roomId);
        
        if (room) {
          // Find and clean up the partner's mapping
          const partnerSocketId = 
            room.user1.socketId === socket.id 
              ? room.user2.socketId 
              : room.user1.socketId;
          
          // Remove the partner's socket-to-room mapping
          socketToRoom.delete(partnerSocketId);
          
          // Get partner's socket and make them leave the room
          const partnerSocket = io.sockets.sockets.get(partnerSocketId);
          if (partnerSocket) {
            partnerSocket.leave(roomId);
          }
        }

        // Remove the disconnected user's mapping
        socketToRoom.delete(socket.id);
        
        // Delete the room
        activeRooms.delete(roomId);
        
        // Log the cleanup
        console.log(`[CLEANUP] Room ${roomId} cleaned up after disconnect`);
      }
    });
  });

  // ============================================
  // START THE HTTP SERVER
  // ============================================
  // Begin listening for connections on the specified port
  httpServer.listen(port, hostname, () => {
    // Log server startup information
    console.log(`\n🚀 Random Chat Server running at http://${hostname}:${port}`);
    console.log(`📡 Socket.io listening on path: /socket.io`);
    console.log(`🌍 Environment: ${dev ? 'development' : 'production'}\n`);
  });
});
