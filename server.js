// ============================================
// IMPORT REQUIRED MODULES
// ============================================

// Import the HTTP module from Node.js to create a server
// This allows us to create a basic HTTP server that can handle requests
const { createServer } = require('http');

// Import Next.js framework for server-side rendering and routing
// Next.js handles all our page rendering and API routes
const next = require('next');

// Import Socket.io Server class for real-time WebSocket communication
// Socket.io enables bidirectional, event-based communication between clients and server
const { Server } = require('socket.io');

// Import UUID v4 generator for creating unique identifiers
// We use this to create unique room IDs that won't collide
const { v4: uuidv4 } = require('uuid');

// ============================================
// ENVIRONMENT CONFIGURATION
// ============================================

// Check if we're running in development or production mode
// process.env.NODE_ENV is an environment variable set by Node.js
// In development: enables hot reloading, verbose errors, etc.
// In production: optimizes for performance and security
const dev = process.env.NODE_ENV !== 'production';

// Get the port number from environment variables or default to 3000
// Railway and other hosting providers set PORT automatically
// parseInt() converts the string to a number, base 10
// Example: process.env.PORT might be "8080" which becomes 8080
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize the Next.js application with our configuration
// This prepares Next.js to handle page rendering and routing
// The 'dev' parameter tells Next.js whether to enable development features
const app = next({ dev });

// Get Next.js's default request handler function
// This function processes HTTP requests for pages, API routes, and static files
// We'll use this after handling our custom health check endpoint
const handler = app.getRequestHandler();

// ============================================
// IN-MEMORY DATA STORES
// ============================================
// These Maps store all our application state in server memory
// Note: Data is lost when server restarts (ephemeral storage)

// Store users who are currently waiting to be matched with someone
// Structure: Map<socketId: string, user: object>
// Example: waitingUsers.set('abc123', { username: 'John', gender: 'male', ... })
const waitingUsers = new Map();

// Store all active chat rooms with their participants
// Structure: Map<roomId: string, room: object>
// Example: activeRooms.set('room-uuid', { user1: {...}, user2: {...}, createdAt: 1234567890 })
const activeRooms = new Map();

// Quick lookup map to find which room a socket belongs to
// Structure: Map<socketId: string, roomId: string>
// Example: socketToRoom.set('abc123', 'room-uuid')
// This prevents us from having to loop through all activeRooms to find a user's room
const socketToRoom = new Map();

// ============================================
// MATCHING ALGORITHM FUNCTION
// ============================================
// This function finds the best compatible match for a user
// It considers gender preferences and shared interests
// When multiple users have the same compatibility score, it randomly selects one

/**
 * Find a compatible match for a user from the waiting queue
 * @param {Object} user - The user looking for a match (contains username, gender, interests, etc.)
 * @param {string} socketId - The socket ID of the user looking for a match
 * @returns {Object|null} - Returns matched user object or null if no match found
 */
function findMatch(user, socketId) {
  // Create an array to store all users who are compatible
  // We store all compatible matches (not just the first one) so we can:
  // 1. Calculate compatibility scores for each
  // 2. Randomly select from users with equal scores
  const compatibleMatches = [];

  // Loop through every user currently in the waiting queue
  // entries() returns an iterator of [key, value] pairs
  // We destructure each entry into waitingSocketId and waitingUser
  for (const [waitingSocketId, waitingUser] of waitingUsers.entries()) {
    
    // Skip if we're comparing the user with themselves
    // This prevents a user from being matched with their own socket
    if (waitingSocketId === socketId) continue;

    // ============================================
    // BIDIRECTIONAL GENDER PREFERENCE MATCHING
    // ============================================
    // Both users' gender preferences must be satisfied for a valid match
    
    // Check if the current user's gender preference is satisfied
    // True if: user wants 'any' gender OR waiting user's gender matches user's preference
    // Example: user wants 'female' and waitingUser is 'female' → true
    // Example: user wants 'any' and waitingUser is 'male' → true
    const currentUserGenderMatch = 
      user.preferredGender === 'any' || 
      user.preferredGender === waitingUser.gender;

    // Check if the waiting user's gender preference is satisfied
    // True if: waiting user wants 'any' gender OR current user's gender matches their preference
    // Example: waitingUser wants 'male' and user is 'male' → true
    // This ensures BOTH users get what they want (bidirectional matching)
    const waitingUserGenderMatch = 
      waitingUser.preferredGender === 'any' || 
      waitingUser.preferredGender === user.gender;

    // Only proceed if BOTH gender preferences are satisfied
    // If either user's preference isn't met, skip this potential match
    if (currentUserGenderMatch && waitingUserGenderMatch) {
      
      // ============================================
      // CALCULATE INTEREST COMPATIBILITY SCORE
      // ============================================
      
      // Find all interests that both users share
      // filter() creates a new array with elements that pass the test
      // For each interest in user's array, check if it exists in waitingUser's array
      // Example: user.interests = ['sports', 'music', 'gaming']
      //          waitingUser.interests = ['music', 'gaming', 'reading']
      //          commonInterests = ['music', 'gaming'] (2 matches)
      const commonInterests = user.interests.filter(
        // includes() checks if the interest exists in the waiting user's interests array
        interest => waitingUser.interests.includes(interest)
      );

      // The match score is simply the number of shared interests
      // Higher score = better match
      // Example: 0 shared interests = score 0, 3 shared interests = score 3
      const matchScore = commonInterests.length;

      // Add this compatible user to our matches array
      // We store all the information we'll need later
      compatibleMatches.push({
        user: waitingUser,           // The full user object
        socketId: waitingSocketId,   // Their socket ID (needed to send them messages)
        score: matchScore,            // Their compatibility score
        commonInterests: commonInterests  // The actual shared interests (for display)
      });
    }
  }

  // ============================================
  // HANDLE NO MATCHES SCENARIO
  // ============================================
  
  // If no compatible users were found, return null
  // The calling function will then add this user to the waiting queue
  if (compatibleMatches.length === 0) {
    return null;
  }

  // ============================================
  // SELECT BEST MATCH RANDOMLY
  // ============================================
  
  // Find the highest compatibility score among all matches
  // Math.max() returns the largest number from a list
  // We use the spread operator (...) to pass all scores as individual arguments
  // map() creates an array of just the scores from our matches
  // Example: [1, 3, 2, 3] → Math.max returns 3
  const highestScore = Math.max(...compatibleMatches.map(m => m.score));

  // Filter to keep only matches with the highest score
  // This ensures we always pick from the BEST matches, not just any compatible user
  // Example: If highest score is 3, we only keep users with score 3
  // If multiple users have score 3, we'll randomly pick one from this filtered array
  const bestMatches = compatibleMatches.filter(m => m.score === highestScore);

  // Randomly select one match from the best matches
  // Math.random() generates a number between 0 (inclusive) and 1 (exclusive)
  // Multiply by array length to get a number between 0 and length
  // Math.floor() rounds down to get a valid array index
  // Example: bestMatches.length = 3
  //          Math.random() = 0.7
  //          0.7 * 3 = 2.1
  //          Math.floor(2.1) = 2 (valid index: 0, 1, or 2)
  const randomIndex = Math.floor(Math.random() * bestMatches.length);
  
  // Get the selected match using our random index
  const selectedMatch = bestMatches[randomIndex];

  // Log the matching decision for debugging and monitoring
  // This helps us understand the matching algorithm's behavior in production
  console.log(`[MATCHING] Found ${compatibleMatches.length} compatible users, ${bestMatches.length} with highest score. Randomly selected index ${randomIndex}`);

  // Return the selected match with user data and socket ID
  // The calling function will use this to create a chat room
  return {
    user: selectedMatch.user,
    socketId: selectedMatch.socketId
  };
}

// ============================================
// MAIN SERVER INITIALIZATION
// ============================================

// Wait for Next.js to finish preparing before starting the server
// prepare() compiles pages, sets up routing, etc.
// then() is a Promise that runs when preparation is complete
app.prepare().then(() => {
  
  // ============================================
  // CREATE HTTP SERVER WITH HEALTH CHECK
  // ============================================
  
  // Create an HTTP server with a custom request handler
  // This server will handle both regular HTTP requests and WebSocket upgrades
  // We define a custom handler instead of just using Next.js's handler
  // so we can add our health check endpoint
  const httpServer = createServer((req, res) => {
    
    // ✅ FIX 1: HEALTH CHECK ENDPOINT FOR RAILWAY
    // Railway (and other platforms) periodically check if your app is alive
    // by making HTTP requests to a specific endpoint (usually /health)
    // If this request fails or times out, Railway thinks your app crashed
    // and will restart it, causing the "link crashes after some hours" issue
    
    // Check if the request is for the health check endpoint
    // We check both /health and /api/health for flexibility
    if (req.url === '/health' || req.url === '/api/health') {
      
      // Set HTTP status code to 200 (OK) - indicates server is healthy
      // Set Content-Type header to application/json - tells client we're sending JSON
      res.writeHead(200, { 'Content-Type': 'application/json' });
      
      // Send a JSON response with server health information
      // This data helps with monitoring and debugging
      res.end(JSON.stringify({
        status: 'ok',                              // Simple status indicator
        activeRooms: activeRooms.size,            // Number of active chat rooms
        waitingUsers: waitingUsers.size,          // Number of users waiting for a match
        connectedSockets: io ? io.sockets.sockets.size : 0,  // Total connected sockets
        uptime: process.uptime(),                 // How long the server has been running (seconds)
        memory: process.memoryUsage()             // Current memory usage (useful for detecting leaks)
      }));
      
      // Return immediately - don't pass this request to Next.js
      return;
    }
    
    // For all other requests, delegate to Next.js's request handler
    // This handles page rendering, API routes, static files, etc.
    handler(req, res);
  });

  // ============================================
  // SOCKET.IO SERVER CONFIGURATION
  // ============================================
  
  // ✅ FIX 5: REDUCED BUFFER SIZE TO PREVENT MEMORY CRASHES
  
  // Create a new Socket.io server attached to our HTTP server
  // Socket.io will handle all WebSocket connections for real-time communication
  const io = new Server(httpServer, {
    
    // CORS (Cross-Origin Resource Sharing) configuration
    // This controls which domains can connect to our WebSocket server
    cors: {
      origin: '*',              // Allow connections from any domain (use specific domains in production)
      methods: ['GET', 'POST'], // Allow GET and POST HTTP methods
    },
    
    // The URL path where Socket.io will listen for connections
    // Clients must connect to: ws://your-domain/socket.io
    path: '/socket.io',
    
    // Transport methods for establishing connections
    // websocket: Direct WebSocket connection (faster, preferred)
    // polling: HTTP long-polling fallback (slower, but works through firewalls)
    // Socket.io will try websocket first, fall back to polling if needed
    transports: ['websocket', 'polling'],
    
    // How long to wait (in milliseconds) for a ping response before considering the connection dead
    // 60000ms = 60 seconds (default is 20 seconds, we increased it for stability)
    // If a client doesn't respond to a ping within this time, disconnect them
    pingTimeout: 60000,
    
    // ✅ CRITICAL FIX: Maximum size of a single message
    // Original code had 100MB which could crash the server with multiple large uploads
    // Reduced to 10MB to prevent memory exhaustion
    // 10 * 1024 * 1024 = 10,485,760 bytes = 10 megabytes
    // If a client tries to send a larger message, Socket.io will reject it
    maxHttpBufferSize: 10 * 1024 * 1024, // 10MB max per message
  });

  // ============================================
  // ✅ FIX 6: SOCKET.IO ERROR HANDLER
  // ============================================
  
  // Listen for connection errors at the engine level (underlying transport layer)
  // These errors occur before a socket is fully established
  // Examples: Invalid handshake, CORS errors, protocol errors
  // Without this handler, these errors would crash the server
  io.engine.on('connection_error', (err) => {
    // Log the error details for debugging
    // err.req = the HTTP request that caused the error
    // err.code = error code (e.g., 1, 2, 3 for different error types)
    // err.message = human-readable error description
    // err.context = additional error context
    console.error('[IO CONNECTION ERROR]', err);
    // Don't crash the server - just log and continue
  });

  // ============================================
  // ✅ FIX 2: PERIODIC CLEANUP OF STALE CONNECTIONS
  // ============================================
  // This prevents memory leaks by removing dead connections
  // Without this, disconnected users would stay in memory forever
  
  // setInterval() runs a function repeatedly at a specified interval
  // This function runs every 60000ms (60 seconds)
  setInterval(() => {
    
    // Get the current timestamp in milliseconds
    // Used to check how long users have been waiting
    const now = Date.now();
    
    // Define timeout threshold: 5 minutes in milliseconds
    // 5 * 60 * 1000 = 300,000 milliseconds = 5 minutes
    // Users waiting longer than this are considered "stale" and removed
    const TIMEOUT = 5 * 60 * 1000;

    // ============================================
    // CLEAN STALE WAITING USERS
    // ============================================
    
    // Loop through all users in the waiting queue
    for (const [socketId, user] of waitingUsers.entries()) {
      
      // Calculate how long this user has been waiting
      // now - user.joinedAt = milliseconds since they joined
      // If this is greater than TIMEOUT, they've been waiting too long
      if (now - user.joinedAt > TIMEOUT) {
        
        // Remove this user from the waiting queue
        // They've been waiting for 5+ minutes, likely disconnected
        waitingUsers.delete(socketId);
        
        // Log the cleanup action for monitoring
        console.log(`[CLEANUP] Removed stale waiting user: ${socketId}`);
      }
    }

    // ============================================
    // CLEAN DEAD ACTIVE ROOMS
    // ============================================
    
    // Loop through all active chat rooms
    for (const [roomId, room] of activeRooms.entries()) {
      
      // Try to get the socket object for user1
      // If the socket doesn't exist in io.sockets.sockets, it's disconnected
      // io.sockets.sockets is a Map of all currently connected sockets
      const socket1 = io.sockets.sockets.get(room.user1.socketId);
      
      // Try to get the socket object for user2
      const socket2 = io.sockets.sockets.get(room.user2.socketId);

      // If BOTH sockets don't exist, the room is dead (both users disconnected)
      // We use the ! (NOT) operator: !socket1 means "socket1 doesn't exist"
      // && means "and" - both conditions must be true
      if (!socket1 && !socket2) {
        
        // Remove the room from activeRooms Map
        // This frees up memory
        activeRooms.delete(roomId);
        
        // Remove both socket-to-room mappings
        // Even though the sockets are gone, their mappings might still exist
        socketToRoom.delete(room.user1.socketId);
        socketToRoom.delete(room.user2.socketId);
        
        // Log the cleanup action
        console.log(`[CLEANUP] Removed dead room: ${roomId}`);
      }
    }

    // ============================================
    // LOG CURRENT SERVER STATUS
    // ============================================
    
    // Log current counts for monitoring
    // This helps you see how your server is performing over time
    // Watch for: activeRooms growing too large, waitingUsers growing too large
    console.log(`[STATUS] Rooms: ${activeRooms.size}, Waiting: ${waitingUsers.size}, Connected: ${io.sockets.sockets.size}`);
    
  }, 60000); // Run this cleanup function every 60 seconds

  // ============================================
  // ✅ FIX 7: HEARTBEAT MECHANISM
  // ============================================
  // This detects "zombie" connections (clients that appear connected but aren't responding)
  // These happen when: network drops without proper disconnect, browser crashes, etc.
  
  // setInterval() runs this function every 30 seconds
  const heartbeat = setInterval(() => {
    
    // Loop through every connected socket
    // io.sockets.sockets is a Map of all active socket connections
    io.sockets.sockets.forEach((socket) => {
      
      // Check if this socket has responded to the last ping
      // isAlive is set to false when we send a ping
      // It's set back to true when the client responds with a pong
      // If it's still false, the client didn't respond to our last ping
      if (socket.isAlive === false) {
        
        // This socket is dead (not responding to pings)
        // Log that we're terminating it
        console.log(`[HEARTBEAT] Terminating dead socket: ${socket.id}`);
        
        // Forcefully disconnect this socket
        // true = close immediately without waiting for close handshake
        return socket.disconnect(true);
      }
      
      // Set isAlive to false BEFORE sending ping
      // If the client responds with pong, the 'pong' handler will set it back to true
      // If they don't respond by the next heartbeat, isAlive will still be false
      socket.isAlive = false;
      
      // Send a ping to the client
      // The client should automatically respond with a pong
      socket.ping();
    });
    
  }, 30000); // Run every 30 seconds (30000 milliseconds)

  // ============================================
  // SOCKET CONNECTION EVENT HANDLER
  // ============================================
  // This is the main event handler - it fires whenever a new client connects
  // Everything inside this function has access to the 'socket' object
  // which represents the individual client's connection
  
  io.on('connection', (socket) => {
    
    // Log when a new user connects
    // socket.id is a unique identifier Socket.io assigns to each connection
    console.log(`[CONNECTION] New user connected: ${socket.id}`);
    
    // ============================================
    // ✅ FIX 7: INITIALIZE HEARTBEAT FOR THIS SOCKET
    // ============================================
    
    // Set isAlive to true when the socket first connects
    // This property doesn't exist by default - we're adding it to track health
    socket.isAlive = true;
    
    // Listen for 'pong' responses from the client
    // When a client responds to our ping, this event fires
    socket.on('pong', () => {
      // Set isAlive back to true - this socket is healthy
      socket.isAlive = true;
    });

    // ============================================
    // ✅ FIX 3: JOIN QUEUE WITH ERROR HANDLING
    // ============================================
    // This event is triggered when a user wants to find a chat partner
    
    socket.on('join-queue', (userData) => {
      
      // Wrap everything in try-catch to prevent server crashes
      // If ANY code inside try{} throws an error, catch{} will handle it
      try {
        
        // ============================================
        // VALIDATE INCOMING USER DATA
        // ============================================
        // Check if userData exists and has required properties
        // Without this check, accessing userData.username would crash if userData is null/undefined
        
        // !userData = true if userData is null, undefined, or falsy
        // !userData.username = true if username property is missing or empty
        // !userData.gender = true if gender property is missing or empty
        // || means "or" - if ANY of these is true, the whole condition is true
        if (!userData || !userData.username || !userData.gender) {
          
          // Send an error message back to the client
          // The client can show this error to the user
          socket.emit('error', { message: 'Invalid user data' });
          
          // Return early - don't process this invalid request
          return;
        }

        // ============================================
        // CREATE USER OBJECT
        // ============================================
        // Build a clean user object with all necessary data
        
        const user = {
          username: userData.username,           // Display name chosen by user
          gender: userData.gender,               // User's gender (male/female)
          preferredGender: userData.preferredGender,  // Gender they want to chat with (male/female/any)
          interests: userData.interests || [],   // Array of interests, default to empty array if not provided
          joinedAt: Date.now(),                  // Timestamp when they joined queue (for timeout cleanup)
        };

        // ============================================
        // TRY TO FIND A MATCH
        // ============================================
        
        // Call our matching algorithm function
        // It returns either a matched user object or null
        const match = findMatch(user, socket.id);

        // ============================================
        // HANDLE MATCH FOUND SCENARIO
        // ============================================
        
        // Check if a compatible match was found
        if (match) {
          
          // Log the successful match for monitoring
          console.log(`[MATCH FOUND] Matching ${socket.id} with ${match.socketId}`);

          // ============================================
          // CREATE UNIQUE ROOM ID
          // ============================================
          
          // Generate a unique room identifier using UUID v4
          // Example: "a3bb189e-8bf9-3888-9912-ace4e6543002"
          // This ensures no two rooms will ever have the same ID
          const roomId = uuidv4();
          
          // Remove the matched user from the waiting queue
          // They're no longer waiting - they're about to enter a room
          waitingUsers.delete(match.socketId);

          // ============================================
          // ADD BOTH USERS TO THE SOCKET.IO ROOM
          // ============================================
          // Socket.io "rooms" are like chat channels
          // When you emit to a room, only sockets in that room receive it
          
          // Add the current user's socket to the room
          socket.join(roomId);
          
          // Get the matched user's socket object from Socket.io's internal Map
          // We need their socket object to add them to the room too
          const matchSocket = io.sockets.sockets.get(match.socketId);
          
          // Check if the matched user's socket still exists
          // It might not if they disconnected right before being matched
          if (matchSocket) {
            // Add the matched user's socket to the same room
            matchSocket.join(roomId);
          }

          // ============================================
          // STORE ROOM DATA IN MEMORY
          // ============================================
          
          // Create a room object with all relevant data
          // We store this so we can look up room info and clean up later
          activeRooms.set(roomId, {
            // First user (the one who just joined queue)
            user1: { 
              socketId: socket.id,  // Their socket ID
              ...user                // Spread operator: copies all properties from user object
            },
            // Second user (the matched user from waiting queue)
            user2: { 
              socketId: match.socketId, 
              ...match.user 
            },
            // Timestamp when this room was created
            // Useful for analytics and cleaning up old rooms
            createdAt: Date.now(),
          });

          // ============================================
          // CREATE BIDIRECTIONAL SOCKET-TO-ROOM MAPPINGS
          // ============================================
          // These allow us to quickly find which room a socket is in
          // without looping through all activeRooms
          
          // Map current user's socket ID to this room ID
          socketToRoom.set(socket.id, roomId);
          
          // Map matched user's socket ID to this room ID
          socketToRoom.set(match.socketId, roomId);

          // ============================================
          // CALCULATE COMMON INTERESTS
          // ============================================
          
          // Find interests both users share (to display in UI)
          // filter() keeps only interests that exist in both arrays
          const commonInterests = user.interests.filter(
            // For each interest in current user's array,
            // check if it exists in matched user's interests array
            interest => match.user.interests.includes(interest)
          );

          // ============================================
          // NOTIFY CURRENT USER OF MATCH
          // ============================================
          
          // Send 'match-found' event to the current user
          // They'll receive this in their client-side code
          socket.emit('match-found', {
            roomId,  // The room ID they're now in
            
            // Information about their chat partner
            partner: {
              username: match.user.username,     // Partner's display name
              gender: match.user.gender,         // Partner's gender
              interests: match.user.interests,   // Partner's interests
            },
            
            // Interests both users share
            commonInterests,
          });

          // ============================================
          // NOTIFY MATCHED USER OF MATCH
          // ============================================
          
          // Check if matched user's socket still exists
          if (matchSocket) {
            
            // Send 'match-found' event to the matched user
            // Their partner info is the CURRENT user (opposite of above)
            matchSocket.emit('match-found', {
              roomId,  // Same room ID
              
              // From matched user's perspective, current user is their partner
              partner: {
                username: user.username,
                gender: user.gender,
                interests: user.interests,
              },
              
              // Same common interests (obviously)
              commonInterests,
            });
          }

          // Log the successful room creation
          console.log(`[ROOM CREATED] Room ${roomId} created`);
          
        } else {
          
          // ============================================
          // NO MATCH FOUND - ADD TO WAITING QUEUE
          // ============================================
          
          // Add this user to the waiting queue
          // They'll wait here until someone compatible joins
          waitingUsers.set(socket.id, user);
          
          // Notify the user that we're searching for a match
          // The client can show a "Searching..." UI
          socket.emit('searching');
          
          // Log the queue addition
          console.log(`[WAITING] User ${socket.id} added to queue. Size: ${waitingUsers.size}`);
        }
        
      } catch (error) {
        
        // ============================================
        // ERROR HANDLING
        // ============================================
        // If ANY error occurred in the try block, we end up here
        // This prevents the entire server from crashing
        
        // Log the error with details for debugging
        console.error(`[ERROR] join-queue for ${socket.id}:`, error);
        
        // Send a user-friendly error message to the client
        // Don't send the raw error (might contain sensitive info)
        socket.emit('error', { message: 'Failed to join queue' });
      }
    });

    // ============================================
    // LEAVE QUEUE EVENT HANDLER
    // ============================================
    // Triggered when a user cancels their search
    
    socket.on('leave-queue', () => {
      
      // Remove this user from the waiting queue
      // If they weren't in the queue, this does nothing (safe)
      waitingUsers.delete(socket.id);
      
      // Log the action
      console.log(`[LEAVE QUEUE] User ${socket.id} left the queue`);
    });

    // ============================================
    // ✅ FIX 3 & 5: SEND MESSAGE WITH ERROR HANDLING AND SIZE CHECK
    // ============================================
    // This event is triggered when a user sends a chat message
    
    socket.on('send-message', (data) => {
      
      // Wrap in try-catch to prevent crashes from malformed data
      try {
        
        // ============================================
        // VALIDATE MESSAGE DATA
        // ============================================
        
        // Check if data exists and has content
        // Without this, accessing data.content would crash if data is null
        if (!data || !data.content) {
          // Silently ignore invalid messages
          // We could also emit an error, but bad messages are common (network issues, etc.)
          return;
        }

        // ============================================
        // ✅ CHECK MESSAGE SIZE TO PREVENT MEMORY ISSUES
        // ============================================
        
        // Convert the entire data object to a JSON string
        // This gives us the actual size that will be sent over the network
        // JSON.stringify() converts JavaScript object to JSON string
        const messageSize = JSON.stringify(data).length;
        
        // Check if message exceeds 10MB limit
        // 10 * 1024 * 1024 = 10,485,760 bytes = 10 megabytes
        if (messageSize > 10 * 1024 * 1024) {
          
          // Message is too large - reject it
          // Send error to the client so they know why it failed
          socket.emit('error', { message: 'File too large. Max 10MB.' });
          
          // Don't process this message
          return;
        }

        // ============================================
        // FIND WHICH ROOM THIS SOCKET IS IN
        // ============================================
        
        // Look up the room ID for this socket
        // Returns undefined if socket isn't in a room
        const roomId = socketToRoom.get(socket.id);
        
        // Only proceed if the user is in a valid room
        // If they're not in a room, they can't send messages
        if (roomId) {
          
          // ============================================
          // CREATE MESSAGE OBJECT
          // ============================================
          
          // Build a complete message object with metadata
          const message = {
            id: uuidv4(),              // Unique message ID
            senderId: socket.id,       // Who sent it (for UI to show left/right alignment)
            content: data.content,     // The actual message content (text, image data, etc.)
            type: data.type || 'text', // Message type (text, image, video, audio), default to 'text'
            timestamp: Date.now(),     // When the message was sent
          };
          
          // ============================================
          // BROADCAST MESSAGE TO ROOM
          // ============================================
          
          // Send the message to everyone in the room
          // io.to(roomId) targets only sockets in this specific room
          // emit() sends the 'new-message' event with the message data
          // This includes the sender (they'll see their own message as confirmation)
          io.to(roomId).emit('new-message', message);
          
          // Log the message for monitoring
          // We don't log the full content (privacy and log size)
          console.log(`[MESSAGE] In room ${roomId}: ${data.type || 'text'} message`);
        }
        
      } catch (error) {
        
        // If any error occurs (JSON.stringify fails, etc.), log it
        // Don't crash the server
        console.error(`[ERROR] send-message:`, error);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: OFFER EVENT HANDLER
    // ============================================
    // WebRTC allows peer-to-peer video/audio calls
    // The "offer" is the first step in establishing a WebRTC connection
    // Our server just relays these signals between users (we don't process the video)
    
    socket.on('webrtc-offer', (data) => {
      
      // Wrap in try-catch for safety
      try {
        
        // Find which room this socket is in
        const roomId = socketToRoom.get(socket.id);
        
        // Only proceed if they're in a room
        if (roomId) {
          
          // Forward the offer to the OTHER user in the room
          // socket.broadcast.to(roomId) sends to everyone in the room EXCEPT the sender
          socket.broadcast.to(roomId).emit('webrtc-offer', {
            offer: data.offer,  // The WebRTC offer signal data (SDP)
            from: socket.id,    // Who sent it (so recipient knows who to answer)
          });
          
          // Log the signaling event
          console.log(`[WEBRTC] Offer sent in room ${roomId}`);
        }
        
      } catch (error) {
        console.error(`[ERROR] webrtc-offer:`, error);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: ANSWER EVENT HANDLER
    // ============================================
    // The "answer" is the response to an offer
    // This completes the WebRTC connection negotiation
    
    socket.on('webrtc-answer', (data) => {
      
      try {
        
        // Find which room this socket is in
        const roomId = socketToRoom.get(socket.id);
        
        if (roomId) {
          
          // Forward the answer to the OTHER user in the room
          socket.broadcast.to(roomId).emit('webrtc-answer', {
            answer: data.answer,  // The WebRTC answer signal data (SDP)
            from: socket.id,      // Who sent it
          });
          
          console.log(`[WEBRTC] Answer sent in room ${roomId}`);
        }
        
      } catch (error) {
        console.error(`[ERROR] webrtc-answer:`, error);
      }
    });

    // ============================================
    // WEBRTC SIGNALING: ICE CANDIDATE EVENT HANDLER
    // ============================================
    // ICE candidates are network routing information
    // They help WebRTC find the best path to connect two peers
    // Multiple candidates are usually exchanged to find the optimal connection
    
    socket.on('webrtc-ice-candidate', (data) => {
      
      try {
        
        // Find which room this socket is in
        const roomId = socketToRoom.get(socket.id);
        
        if (roomId) {
          
          // Forward the ICE candidate to the OTHER user
          socket.broadcast.to(roomId).emit('webrtc-ice-candidate', {
            candidate: data.candidate,  // The ICE candidate data (IP, port, protocol, etc.)
            from: socket.id,            // Who sent it
          });
        }
        
      } catch (error) {
        console.error(`[ERROR] webrtc-ice-candidate:`, error);
      }
    });

    // ============================================
    // END CHAT EVENT HANDLER
    // ============================================
    // Triggered when a user clicks "End Chat" or "Next" button
    
    socket.on('end-chat', () => {
      
      try {
        
        // Find which room this socket is in
        const roomId = socketToRoom.get(socket.id);
        
        if (roomId) {
          
          // ============================================
          // NOTIFY BOTH USERS THAT CHAT ENDED
          // ============================================
          
          // Send to ALL users in the room (including the one who clicked end)
          // io.to(roomId) targets everyone in the room
          io.to(roomId).emit('chat-ended', {
            reason: 'User left the chat',  // Why the chat ended
          });

          // ============================================
          // CLEAN UP ROOM DATA
          // ============================================
          
          // Get the room data so we can clean up both users
          const room = activeRooms.get(roomId);
          
          if (room) {
            
            // Remove socket-to-room mappings for BOTH users
            // This is important - both users need their mappings cleared
            socketToRoom.delete(room.user1.socketId);
            socketToRoom.delete(room.user2.socketId);

            // Get socket objects for both users
            const socket1 = io.sockets.sockets.get(room.user1.socketId);
            const socket2 = io.sockets.sockets.get(room.user2.socketId);

            // Make both users leave the Socket.io room
            // leave() removes them from the room so they don't get future messages
            if (socket1) socket1.leave(roomId);
            if (socket2) socket2.leave(roomId);
          }

          // Delete the room from activeRooms Map
          // This frees up memory
          activeRooms.delete(roomId);
          
          // Log the room closure
          console.log(`[ROOM CLOSED] Room ${roomId} closed`);
        }
        
      } catch (error) {
        console.error(`[ERROR] end-chat:`, error);
      }
    });

    // ============================================
    // TYPING INDICATOR EVENT HANDLER
    // ============================================
    // Shows "Partner is typing..." in the UI
    
    socket.on('typing', (isTyping) => {
      
      try {
        
        // Find which room this socket is in
        const roomId = socketToRoom.get(socket.id);
        
        if (roomId) {
          
          // Broadcast typing status to the OTHER user only
          // socket.broadcast.to(roomId) excludes the sender
          // isTyping is a boolean: true when typing starts, false when stops
          socket.broadcast.to(roomId).emit('partner-typing', isTyping);
        }
        
      } catch (error) {
        console.error(`[ERROR] typing:`, error);
      }
    });

    // ============================================
    // DISCONNECT EVENT HANDLER
    // ============================================
    // This fires automatically when a socket disconnects
    // Reasons: user closed browser, lost internet, server restart, etc.
    
    socket.on('disconnect', () => {
      
      // Log the disconnection
      console.log(`[DISCONNECT] User disconnected: ${socket.id}`);

      // ============================================
      // REMOVE FROM WAITING QUEUE
      // ============================================
      
      // If they were waiting for a match, remove them
      // If they weren't in the queue, this does nothing (safe)
      waitingUsers.delete(socket.id);

      // ============================================
      // HANDLE ROOM CLEANUP IF THEY WERE IN A CHAT
      // ============================================
      
      // Check if this user was in an active room
      const roomId = socketToRoom.get(socket.id);
      
      // If they were in a room, we need to notify their partner and clean up
      if (roomId) {
        
        // Notify their partner that they disconnected
        // socket.broadcast.to(roomId) sends to everyone in the room except this socket
        // Since this socket is disconnecting, only the partner will receive this
        socket.broadcast.to(roomId).emit('chat-ended', {
          reason: 'Partner disconnected',
        });

        // Get the room data for cleanup
        const room = activeRooms.get(roomId);
        
        if (room) {
          
          // ============================================
          // FIND THE PARTNER'S SOCKET ID
          // ============================================
          
          // Determine which user is the partner (the one who didn't disconnect)
          // If disconnected user is user1, partner is user2, and vice versa
          // This is a ternary operator: condition ? valueIfTrue : valueIfFalse
          const partnerSocketId = 
            room.user1.socketId === socket.id   // Is disconnected user user1?
              ? room.user2.socketId              // Yes: partner is user2
              : room.user1.socketId;             // No: partner is user1
          
          // Remove the partner's socket-to-room mapping
          // Important: partner needs to be able to join a new room
          socketToRoom.delete(partnerSocketId);
          
          // Get the partner's socket object
          const partnerSocket = io.sockets.sockets.get(partnerSocketId);
          
          // If partner's socket exists, make them leave the room
          if (partnerSocket) {
            partnerSocket.leave(roomId);
          }
        }

        // Remove the disconnected user's socket-to-room mapping
        socketToRoom.delete(socket.id);
        
        // Delete the entire room
        // The room is now empty/useless, so free the memory
        activeRooms.delete(roomId);
        
        // Log the cleanup action
        console.log(`[CLEANUP] Room ${roomId} cleaned up after disconnect`);
      }
    });

    // ============================================
    // ✅ FIX 3: SOCKET ERROR HANDLER
    // ============================================
    // This catches errors that occur on the socket itself
    // Examples: Protocol errors, encoding errors, transport errors
    
    socket.on('error', (error) => {
      // Log the error for debugging
      // Don't crash the server - just log and continue
      console.error(`[SOCKET ERROR] ${socket.id}:`, error);
    });
  });

  // ============================================
  // CLEANUP ON SERVER CLOSE
  // ============================================
  // This event fires when the Socket.io server is closing
  // We need to clean up our intervals to prevent memory leaks
  
  io.on('close', () => {
    // Clear the heartbeat interval
    // If we don't do this, the interval keeps running even after server closes
    clearInterval(heartbeat);
  });

  // ============================================
  // ✅ FIX 4: GLOBAL ERROR HANDLERS
  // ============================================
  // These catch errors that escape all other error handlers
  // Without these, such errors would crash the entire Node.js process
  
  // Handle unhandled promise rejections
  // These occur when a Promise is rejected but has no .catch() handler
  // Example: await fetch() fails but you forgot try-catch
  process.on('unhandledRejection', (reason, promise) => {
    // Log the error details
    // reason = why the promise was rejected
    // promise = the promise that was rejected
    console.error('❌ Unhandled Rejection:', promise, 'reason:', reason);
    
    // DON'T exit the process - just log the error
    // In production, you might want to send this to an error tracking service
  });

  // Handle uncaught exceptions
  // These are synchronous errors that weren't caught by try-catch
  // Example: trying to access property of undefined
  process.on('uncaughtException', (error) => {
    // Log the error
    console.error('❌ Uncaught Exception:', error);
    
    // For uncaught exceptions, we log but don't exit immediately
    // Some uncaught exceptions might be recoverable
    // In production, you might want to gracefully shutdown here
  });

  // ============================================
  // GRACEFUL SHUTDOWN HANDLER
  // ============================================
  // SIGTERM is a signal sent by hosting platforms (Railway, Heroku, etc.)
  // when they want to restart or stop your server
  // This gives you time to clean up before the process is killed
  
  process.on('SIGTERM', () => {
    // Log that we're shutting down
    console.log('⚠️  SIGTERM received, starting graceful shutdown');
    
    // Notify all connected users that server is restarting
    // This is good UX - users know why they're disconnecting
    io.emit('server-shutdown', { message: 'Server restarting, please reconnect' });
    
    // Close the HTTP server
    // This stops accepting new connections
    httpServer.close(() => {
      // This callback runs when all connections are closed
      console.log('✅ Server closed gracefully');
      
      // Exit the process with success code
      // 0 = successful shutdown
      process.exit(0);
    });
    
    // ============================================
    // FORCE SHUTDOWN AFTER TIMEOUT
    // ============================================
    // Sometimes connections take too long to close
    // After 10 seconds, force shutdown to prevent hanging
    
    setTimeout(() => {
      // Log that we're forcing shutdown
      console.error('❌ Forcing shutdown');
      
      // Exit with error code
      // 1 = shutdown was forced (not ideal, but necessary)
      process.exit(1);
    }, 10000); // 10 seconds = 10000 milliseconds
  });

  // ============================================
  // START THE HTTP SERVER
  // ============================================
  // This is the final step - actually start listening for connections
  
  // Begin listening on the specified port
  // The callback function runs once the server is ready
  httpServer.listen(port, () => {
    // Log success messages with emojis for visibility
    console.log(`🚀 Server listening on port ${port}`);
    console.log(`🌍 Environment: ${dev ? 'development' : 'production'}`);
  });
});