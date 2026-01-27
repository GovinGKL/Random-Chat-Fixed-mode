// ============================================
// MAIN PAGE COMPONENT - RANDOM CHAT APP
// ============================================
// This is the main entry point for the Random Chat application
// It handles user setup, matching, and chat functionality

// 'use client' directive marks this as a Client Component
// Required for using React hooks like useState and useEffect
'use client';

// ============================================
// REACT IMPORTS
// ============================================
// Import React hooks for state management and side effects
import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================
// SOCKET.IO CLIENT IMPORT
// ============================================
// Import Socket.io client for real-time WebSocket communication
import { io, Socket } from 'socket.io-client';

// ============================================
// SHADCN UI COMPONENT IMPORTS
// ============================================
// Import pre-built UI components from shadcn/ui library
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';

// ============================================
// LUCIDE REACT ICONS IMPORTS
// ============================================
// Import icons for various UI elements
import {
  Send,           // Send message icon
  Image,          // Image upload icon
  Video,          // Video upload icon
  X,              // Close/cancel icon
  Loader2,        // Loading spinner icon
  Users,          // Users/matching icon
  MessageCircle,  // Chat message icon
  Heart,          // Interest/like icon
  Sparkles,       // Decorative sparkles icon
  ArrowRight,     // Arrow for buttons
  User,           // User profile icon
  Search,         // Search icon
  Zap,            // Quick action icon
} from 'lucide-react';

// ============================================
// TYPE DEFINITIONS
// ============================================
// TypeScript interfaces for type safety

// Message interface defines the structure of a chat message
interface Message {
  // Unique identifier for the message
  id: string;
  
  // Socket ID of the message sender
  senderId: string;
  
  // The actual content of the message
  content: string;
  
  // Type of message: text, image, or video
  type: 'text' | 'image' | 'video';
  
  // Unix timestamp when message was sent
  timestamp: number;
}

// Partner interface defines the structure of a chat partner's info
interface Partner {
  // Display name of the partner
  username: string;
  
  // Partner's gender
  gender: string;
  
  // Array of partner's interests
  interests: string[];
}

// User data interface for form submission
interface UserData {
  // User's chosen display name
  username: string;
  
  // User's gender
  gender: 'male' | 'female';
  
  // Gender preference for matching
  preferredGender: 'male' | 'female' | 'any';
  
  // Selected interests for matching
  interests: string[];
}

// ============================================
// APPLICATION STATES ENUM
// ============================================
// Defines all possible states of the application
type AppState = 'setup' | 'searching' | 'chatting';

// ============================================
// AVAILABLE INTERESTS
// ============================================
// List of interests users can select for matching
const INTERESTS = [
  { id: 'movies', label: 'Movies', emoji: '🎬' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'sports', label: 'Sports', emoji: '⚽' },
  { id: 'fitness', label: 'Fitness', emoji: '💪' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'food', label: 'Food', emoji: '🍕' },
  { id: 'tech', label: 'Technology', emoji: '💻' },
  { id: 'art', label: 'Art', emoji: '🎨' },
  { id: 'casual', label: 'Casual Chat', emoji: '💬' },
];

// ============================================
// MAIN APP COMPONENT
// ============================================
export default function RandomChatApp() {
  // ============================================
  // STATE DECLARATIONS
  // ============================================
  
  // Socket instance for WebSocket connection
  // Initially null until connection is established
  const [socket, setSocket] = useState<Socket | null>(null);
  
  // Current application state: setup, searching, or chatting
  const [appState, setAppState] = useState<AppState>('setup');
  
  // Array of messages in the current chat
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Current message being typed by the user
  const [inputMessage, setInputMessage] = useState('');
  
  // Information about the matched chat partner
  const [partner, setPartner] = useState<Partner | null>(null);
  
  // Current room ID when in a chat
  const [roomId, setRoomId] = useState<string | null>(null);
  
  // Common interests between the user and partner
  const [commonInterests, setCommonInterests] = useState<string[]>([]);
  
  // Whether the partner is currently typing
  const [partnerTyping, setPartnerTyping] = useState(false);
  
  // Countdown timer for search timeout (60 seconds)
  const [searchTimer, setSearchTimer] = useState(60);
  
  // User's own socket ID for message identification
  const [mySocketId, setMySocketId] = useState<string | null>(null);

  // ============================================
  // USER FORM DATA STATE
  // ============================================
  // Form data for user setup
  const [formData, setFormData] = useState<UserData>({
    username: '',
    gender: 'male',
    preferredGender: 'any',
    interests: [],
  });

  // ============================================
  // REFS FOR DOM ELEMENTS
  // ============================================
  // Reference to scroll area for auto-scrolling to new messages
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Reference to file input for image uploads
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Reference to video file input
  const videoInputRef = useRef<HTMLInputElement>(null);
  
  // Reference to store the search timer interval
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ============================================
  // WEBRTC STATE AND REFS
  // ============================================
  // Peer connection for WebRTC file transfer
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  
  // Data channel for sending files
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  
  // Flag to track if this peer initiated the connection
  const isInitiator = useRef(false);

  // ============================================
  // SOCKET CONNECTION EFFECT
  // ============================================
  // This effect establishes the WebSocket connection when the component mounts
  useEffect(() => {
    // Create a new Socket.io connection
    // The path must match the server configuration
    const newSocket = io({
      // Path where Socket.io server is listening
      path: '/socket.io',
      
      // Additional transports to try
      transports: ['websocket', 'polling'],
    });

    // Event handler for successful connection
    newSocket.on('connect', () => {
      // Log connection success with socket ID
      console.log('Connected to server with ID:', newSocket.id);
      
      // Store our socket ID for message identification
      setMySocketId(newSocket.id || null);
    });

    // Event handler for finding a match
    newSocket.on('match-found', (data) => {
      // Log match details
      console.log('Match found!', data);
      
      // Stop the search timer
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
      }
      
      // Update state with match information
      setRoomId(data.roomId);
      setPartner(data.partner);
      setCommonInterests(data.commonInterests || []);
      
      // Clear any previous messages
      setMessages([]);
      
      // Transition to chatting state
      setAppState('chatting');
      
      // Set as initiator for WebRTC (first user to match)
      isInitiator.current = true;
    });

    // Event handler when added to search queue
    newSocket.on('searching', () => {
      // Log that we're now searching
      console.log('Added to waiting queue, searching for match...');
      
      // Transition to searching state
      setAppState('searching');
      
      // Reset search timer to 60 seconds
      setSearchTimer(60);
    });

    // Event handler for incoming messages
    newSocket.on('new-message', (message: Message) => {
      // Log the received message
      console.log('Received message:', message);
      
      // Add the new message to the messages array
      // Using functional update to ensure we have the latest state
      setMessages((prev) => [...prev, message]);
    });

    // Event handler when partner is typing
    newSocket.on('partner-typing', (isTyping: boolean) => {
      // Update typing indicator state
      setPartnerTyping(isTyping);
    });

    // Event handler when chat ends
    newSocket.on('chat-ended', (data) => {
      // Log the reason for chat ending
      console.log('Chat ended:', data.reason);
      
      // Reset all chat-related state
      setPartner(null);
      setRoomId(null);
      setMessages([]);
      setCommonInterests([]);
      setPartnerTyping(false);
      
      // Return to setup screen
      setAppState('setup');
      
      // Clean up WebRTC connection
      if (peerConnection) {
        peerConnection.close();
        setPeerConnection(null);
      }
      setDataChannel(null);
    });

    // ============================================
    // WEBRTC SIGNALING EVENT HANDLERS
    // ============================================
    
    // Handle incoming WebRTC offer
    newSocket.on('webrtc-offer', async (data) => {
      console.log('Received WebRTC offer');
      // Will be implemented in WebRTC setup
    });

    // Handle incoming WebRTC answer
    newSocket.on('webrtc-answer', async (data) => {
      console.log('Received WebRTC answer');
      // Will be implemented in WebRTC setup
    });

    // Handle incoming ICE candidates
    newSocket.on('webrtc-ice-candidate', async (data) => {
      console.log('Received ICE candidate');
      // Will be implemented in WebRTC setup
    });

    // Store the socket instance in state
    setSocket(newSocket);

    // Cleanup function - runs when component unmounts
    return () => {
      // Disconnect from the socket server
      newSocket.disconnect();
      
      // Clear any active timers
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
      }
    };
  }, []); // Empty dependency array means this runs once on mount

  // ============================================
  // AUTO-SCROLL EFFECT
  // ============================================
  // Automatically scroll to the bottom when new messages arrive
  useEffect(() => {
    // Check if scroll ref exists
    if (scrollRef.current) {
      // Scroll to the bottom of the messages container
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]); // Run this effect when messages array changes

  // ============================================
  // SEARCH TIMER EFFECT
  // ============================================
  // Countdown timer that auto-cancels search after 60 seconds
  useEffect(() => {
    // Only run timer when in searching state
    if (appState === 'searching') {
      // Start countdown interval
      searchTimerRef.current = setInterval(() => {
        // Decrease timer by 1 second
        setSearchTimer((prev) => {
          // If timer reaches 0, cancel the search
          if (prev <= 1) {
            // Stop the interval
            if (searchTimerRef.current) {
              clearInterval(searchTimerRef.current);
            }
            
            // Leave the queue
            socket?.emit('leave-queue');
            
            // Return to setup state
            setAppState('setup');
            
            return 60; // Reset timer
          }
          
          // Return decremented value
          return prev - 1;
        });
      }, 1000); // Run every 1000ms (1 second)
    }

    // Cleanup function
    return () => {
      // Clear interval when effect cleanup runs
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
      }
    };
  }, [appState, socket]); // Re-run when appState or socket changes

  // ============================================
  // HANDLE START MATCH
  // ============================================
  // Function to initiate the matching process
  const handleStartMatch = () => {
    // Validate that username is provided
    if (!formData.username.trim()) {
      alert('Please enter a username');
      return;
    }

    // Validate that at least one interest is selected
    if (formData.interests.length === 0) {
      alert('Please select at least one interest');
      return;
    }

    // Emit join-queue event with user data
    socket?.emit('join-queue', formData);
    
    // Transition to searching state
    setAppState('searching');
  };

  // ============================================
  // HANDLE CANCEL SEARCH
  // ============================================
  // Function to cancel the search and return to setup
  const handleCancelSearch = () => {
    // Emit leave-queue event to remove from waiting list
    socket?.emit('leave-queue');
    
    // Return to setup state
    setAppState('setup');
    
    // Reset timer
    setSearchTimer(60);
  };

  // ============================================
  // HANDLE SEND MESSAGE
  // ============================================
  // Function to send a text message
  const handleSendMessage = () => {
    // Don't send empty messages
    if (!inputMessage.trim()) return;

    // Emit the message to the server
    socket?.emit('send-message', {
      // The message content
      content: inputMessage,
      
      // Type is text
      type: 'text',
    });

    // Clear the input field
    setInputMessage('');
    
    // Stop typing indicator
    socket?.emit('typing', false);
  };

  // ============================================
  // HANDLE END CHAT
  // ============================================
  // Function to end the current chat session
  const handleEndChat = () => {
    // Emit end-chat event
    socket?.emit('end-chat');
    
    // Reset state (will also be triggered by chat-ended event)
    setPartner(null);
    setRoomId(null);
    setMessages([]);
    setCommonInterests([]);
    
    // Return to setup
    setAppState('setup');
  };

  // ============================================
  // HANDLE TYPING INDICATOR
  // ============================================
  // Function to notify partner when user is typing
  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Update input value
    setInputMessage(e.target.value);
    
    // Emit typing status based on input content
    socket?.emit('typing', e.target.value.length > 0);
  };

  // ============================================
  // HANDLE INTEREST TOGGLE
  // ============================================
  // Function to toggle interest selection
  const handleInterestToggle = (interestId: string) => {
    setFormData((prev) => {
      // Check if interest is already selected
      const isSelected = prev.interests.includes(interestId);
      
      // If selected, remove it; otherwise, add it
      const newInterests = isSelected
        ? prev.interests.filter((i) => i !== interestId)
        : [...prev.interests, interestId];
      
      // Return updated form data
      return { ...prev, interests: newInterests };
    });
  };

  // ============================================
  // HANDLE FILE UPLOAD (IMAGE)
  // ============================================
  // Function to handle image file selection
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Get the selected file
    const file = e.target.files?.[0];
    
    // Return if no file selected
    if (!file) return;

    // Check file size (max 5MB for images)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    // Create a FileReader to convert file to base64
    const reader = new FileReader();
    
    // Event handler when file is read
    reader.onload = () => {
      // Send the image as a base64 string
      socket?.emit('send-message', {
        content: reader.result as string,
        type: 'image',
      });
    };
    
    // Read the file as a data URL (base64)
    reader.readAsDataURL(file);
    
    // Clear the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ============================================
  // HANDLE VIDEO UPLOAD
  // ============================================
  // Function to handle video file selection
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Get the selected file
    const file = e.target.files?.[0];
    
    // Return if no file selected
    if (!file) return;

    // Check file size (max 50MB for videos)
    if (file.size > 50 * 1024 * 1024) {
      alert('Video must be less than 50MB');
      return;
    }

    // Check video duration (this is approximate based on file size)
    // For proper duration check, we'd need to load the video
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      // Release the object URL
      URL.revokeObjectURL(video.src);
      
      // Check if video is longer than 1 minute
      if (video.duration > 60) {
        alert('Video must be 1 minute or less');
        return;
      }
      
      // Create a FileReader to convert file to base64
      const reader = new FileReader();
      
      // Event handler when file is read
      reader.onload = () => {
        // Send the video as a base64 string
        socket?.emit('send-message', {
          content: reader.result as string,
          type: 'video',
        });
      };
      
      // Read the file as a data URL (base64)
      reader.readAsDataURL(file);
    };
    
    // Create object URL for the video
    video.src = URL.createObjectURL(file);
    
    // Clear the input
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  };

  // ============================================
  // FORMAT TIMESTAMP
  // ============================================
  // Function to format Unix timestamp to readable time
  const formatTime = (timestamp: number) => {
    // Create a Date object from the timestamp
    const date = new Date(timestamp);
    
    // Return formatted time string (e.g., "2:30 PM")
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ============================================
  // RENDER SETUP SCREEN
  // ============================================
  // Function to render the initial setup form
  const renderSetupScreen = () => (
    // Main container with gradient background
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Animated gradient orbs for visual appeal */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Main card container */}
      <Card className="w-full max-w-lg relative z-10 bg-white/95 backdrop-blur-sm shadow-2xl border-0">
        {/* Card header with title */}
        <CardHeader className="text-center pb-2">
          {/* App logo/icon */}
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
            <MessageCircle className="w-8 h-8 text-white" />
          </div>
          
          {/* App title */}
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
            RandomMatch
          </CardTitle>
          
          {/* App description */}
          <CardDescription className="text-gray-600 mt-2">
            Connect with strangers who share your interests
          </CardDescription>
        </CardHeader>

        {/* Card content - Form fields */}
        <CardContent className="space-y-6">
          {/* Username input field */}
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium text-gray-700">
              Choose your display name
            </Label>
            <div className="relative">
              {/* User icon inside input */}
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                id="username"
                placeholder="Enter a cool username..."
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="pl-10 h-12 border-gray-200 focus:border-purple-500 focus:ring-purple-500"
                maxLength={20}
              />
            </div>
          </div>

          {/* Gender selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-700">Your gender</Label>
            <RadioGroup
              value={formData.gender}
              onValueChange={(value: 'male' | 'female') => setFormData({ ...formData, gender: value })}
              className="flex gap-4"
            >
              {/* Male option */}
              <div className="flex-1">
                <RadioGroupItem value="male" id="male" className="peer sr-only" />
                <Label
                  htmlFor="male"
                  className="flex items-center justify-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-all peer-data-[state=checked]:border-purple-500 peer-data-[state=checked]:bg-purple-50 hover:border-purple-300"
                >
                  <span className="text-xl">👨</span>
                  <span className="font-medium">Male</span>
                </Label>
              </div>
              
              {/* Female option */}
              <div className="flex-1">
                <RadioGroupItem value="female" id="female" className="peer sr-only" />
                <Label
                  htmlFor="female"
                  className="flex items-center justify-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-all peer-data-[state=checked]:border-purple-500 peer-data-[state=checked]:bg-purple-50 hover:border-purple-300"
                >
                  <span className="text-xl">👩</span>
                  <span className="font-medium">Female</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Preferred gender to chat with */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-700">I want to chat with</Label>
            <RadioGroup
              value={formData.preferredGender}
              onValueChange={(value: 'male' | 'female' | 'any') => setFormData({ ...formData, preferredGender: value })}
              className="flex gap-3"
            >
              {/* Male preference */}
              <div className="flex-1">
                <RadioGroupItem value="male" id="pref-male" className="peer sr-only" />
                <Label
                  htmlFor="pref-male"
                  className="flex items-center justify-center gap-1 p-2.5 border-2 rounded-xl cursor-pointer transition-all peer-data-[state=checked]:border-indigo-500 peer-data-[state=checked]:bg-indigo-50 hover:border-indigo-300 text-sm"
                >
                  <span>👨</span>
                  <span>Male</span>
                </Label>
              </div>
              
              {/* Female preference */}
              <div className="flex-1">
                <RadioGroupItem value="female" id="pref-female" className="peer sr-only" />
                <Label
                  htmlFor="pref-female"
                  className="flex items-center justify-center gap-1 p-2.5 border-2 rounded-xl cursor-pointer transition-all peer-data-[state=checked]:border-indigo-500 peer-data-[state=checked]:bg-indigo-50 hover:border-indigo-300 text-sm"
                >
                  <span>👩</span>
                  <span>Female</span>
                </Label>
              </div>
              
              {/* Any gender preference */}
              <div className="flex-1">
                <RadioGroupItem value="any" id="pref-any" className="peer sr-only" />
                <Label
                  htmlFor="pref-any"
                  className="flex items-center justify-center gap-1 p-2.5 border-2 rounded-xl cursor-pointer transition-all peer-data-[state=checked]:border-indigo-500 peer-data-[state=checked]:bg-indigo-50 hover:border-indigo-300 text-sm"
                >
                  <span>🌈</span>
                  <span>Any</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Interests selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-700">
              Select your interests
              <span className="text-gray-400 font-normal ml-1">(select at least 1)</span>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {/* Map through all available interests */}
              {INTERESTS.map((interest) => (
                <div
                  key={interest.id}
                  onClick={() => handleInterestToggle(interest.id)}
                  className={`flex items-center gap-2 p-2.5 border-2 rounded-xl cursor-pointer transition-all ${
                    formData.interests.includes(interest.id)
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  {/* Checkbox for visual feedback */}
                  <Checkbox
                    checked={formData.interests.includes(interest.id)}
                    className="pointer-events-none data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
                  />
                  <span className="text-lg">{interest.emoji}</span>
                  <span className="text-sm font-medium">{interest.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Start match button */}
          <Button
            onClick={handleStartMatch}
            className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold text-lg shadow-lg shadow-purple-500/30 transition-all duration-300"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            Start Matching
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  // ============================================
  // RENDER SEARCHING SCREEN
  // ============================================
  // Function to render the searching/waiting screen
  const renderSearchingScreen = () => (
    // Main container with animated gradient background
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Search card */}
      <Card className="w-full max-w-md relative z-10 bg-white/95 backdrop-blur-sm shadow-2xl border-0">
        <CardContent className="pt-8 pb-6 text-center">
          {/* Animated search indicator */}
          <div className="relative mx-auto w-32 h-32 mb-6">
            {/* Outer pulsing ring */}
            <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping" />
            {/* Middle pulsing ring */}
            <div className="absolute inset-4 rounded-full bg-purple-500/30 animate-ping animation-delay-200" />
            {/* Inner circle with icon */}
            <div className="absolute inset-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Search className="w-8 h-8 text-white animate-pulse" />
            </div>
          </div>

          {/* Searching text */}
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Finding your match...</h2>
          <p className="text-gray-500 mb-6">
            Looking for someone who shares your interests
          </p>

          {/* Timer countdown */}
          <div className="bg-gray-100 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
              <span className="text-gray-700 font-medium">
                Auto-cancel in <span className="text-purple-600 font-bold">{searchTimer}s</span>
              </span>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-600 transition-all duration-1000"
                style={{ width: `${(searchTimer / 60) * 100}%` }}
              />
            </div>
          </div>

          {/* User preferences display */}
          <div className="bg-purple-50 rounded-xl p-4 mb-6 text-left">
            <h3 className="text-sm font-semibold text-purple-700 mb-2">Your preferences:</h3>
            <div className="space-y-1 text-sm text-gray-600">
              <p><span className="font-medium">Username:</span> {formData.username}</p>
              <p><span className="font-medium">Looking for:</span> {formData.preferredGender === 'any' ? 'Anyone' : formData.preferredGender}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {formData.interests.map((interest) => {
                  const interestData = INTERESTS.find((i) => i.id === interest);
                  return (
                    <Badge key={interest} variant="secondary" className="bg-purple-100 text-purple-700">
                      {interestData?.emoji} {interestData?.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Cancel button */}
          <Button
            onClick={handleCancelSearch}
            variant="outline"
            className="w-full h-11 border-2 border-gray-200 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel Search
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  // ============================================
  // RENDER CHAT SCREEN
  // ============================================
  // Function to render the chat interface
  const renderChatScreen = () => (
    // Main container with gradient background
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      {/* Chat container */}
      <div className="w-full max-w-2xl h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Chat header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 text-white">
          <div className="flex items-center justify-between">
            {/* Partner info */}
            <div className="flex items-center gap-3">
              {/* Partner avatar */}
              <Avatar className="h-12 w-12 border-2 border-white/30">
                <AvatarFallback className="bg-white/20 text-white font-bold">
                  {partner?.username?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              
              {/* Partner name and status */}
              <div>
                <h2 className="font-semibold text-lg">{partner?.username || 'Anonymous'}</h2>
                <div className="flex items-center gap-1.5">
                  {/* Online indicator */}
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-sm text-white/80">
                    {partnerTyping ? 'typing...' : 'Online'}
                  </span>
                </div>
              </div>
            </div>

            {/* End chat button */}
            <Button
              onClick={handleEndChat}
              variant="ghost"
              className="text-white hover:bg-white/20 hover:text-white"
            >
              <X className="w-5 h-5 mr-1" />
              End Chat
            </Button>
          </div>

          {/* Common interests display */}
          {commonInterests.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/70">Common interests:</span>
              {commonInterests.map((interest) => {
                const interestData = INTERESTS.find((i) => i.id === interest);
                return (
                  <Badge
                    key={interest}
                    className="bg-white/20 text-white border-0 text-xs"
                  >
                    {interestData?.emoji} {interestData?.label}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* Messages area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {/* Welcome message */}
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-700 px-4 py-2 rounded-full text-sm">
                <Sparkles className="w-4 h-4" />
                You're now connected with {partner?.username}!
              </div>
            </div>

            {/* Render each message */}
            {messages.map((message) => {
              // Check if message is from current user
              const isOwnMessage = message.senderId === mySocketId;

              return (
                <div
                  key={message.id}
                  className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      isOwnMessage
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-800 rounded-bl-md'
                    }`}
                  >
                    {/* Text message */}
                    {message.type === 'text' && (
                      <p className="break-words">{message.content}</p>
                    )}

                    {/* Image message */}
                    {message.type === 'image' && (
                      <img
                        src={message.content}
                        alt="Shared image"
                        className="max-w-full rounded-lg max-h-64 object-contain"
                      />
                    )}

                    {/* Video message */}
                    {message.type === 'video' && (
                      <video
                        src={message.content}
                        controls
                        className="max-w-full rounded-lg max-h-64"
                      />
                    )}

                    {/* Message timestamp */}
                    <p
                      className={`text-xs mt-1 ${
                        isOwnMessage ? 'text-white/70' : 'text-gray-500'
                      }`}
                    >
                      {formatTime(message.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {partnerTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-4 py-3 rounded-bl-md">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Message input area */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center gap-2">
            {/* Hidden file inputs */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={videoInputRef}
              onChange={handleVideoUpload}
              accept="video/*"
              className="hidden"
            />

            {/* Image upload button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="text-gray-500 hover:text-purple-600 hover:bg-purple-50"
            >
              <Image className="w-5 h-5" />
            </Button>

            {/* Video upload button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => videoInputRef.current?.click()}
              className="text-gray-500 hover:text-purple-600 hover:bg-purple-50"
            >
              <Video className="w-5 h-5" />
            </Button>

            {/* Message input field */}
            <Input
              value={inputMessage}
              onChange={handleTyping}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              className="flex-1 h-11 border-gray-200 focus:border-purple-500 focus:ring-purple-500"
            />

            {/* Send button */}
            <Button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim()}
              className="h-11 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>

          {/* File size info */}
          <p className="text-xs text-gray-400 mt-2 text-center">
            Images up to 5MB • Videos up to 50MB (max 1 min)
          </p>
        </div>
      </div>
    </div>
  );

  // ============================================
  // MAIN RENDER
  // ============================================
  // Return the appropriate screen based on app state
  return (
    <>
      {/* Render setup screen when in setup state */}
      {appState === 'setup' && renderSetupScreen()}
      
      {/* Render searching screen when in searching state */}
      {appState === 'searching' && renderSearchingScreen()}
      
      {/* Render chat screen when in chatting state */}
      {appState === 'chatting' && renderChatScreen()}
    </>
  );
}
