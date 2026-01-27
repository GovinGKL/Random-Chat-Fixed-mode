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
import { useState, useEffect, useRef } from 'react';

// ============================================
// SOCKET.IO CLIENT IMPORT
// ============================================
// Import Socket.io client for real-time WebSocket communication
import { io } from 'socket.io-client';

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
// AVAILABLE INTERESTS
// ============================================
// List of interests users can select for matching
const INTERESTS = [
  { id: 'movies', label: 'Movies', emoji: '🎬' },      // Film and cinema
  { id: 'music', label: 'Music', emoji: '🎵' },        // Music and songs
  { id: 'sports', label: 'Sports', emoji: '⚽' },       // Sports activities
  { id: 'fitness', label: 'Fitness', emoji: '💪' },    // Exercise and health
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },      // Video games
  { id: 'travel', label: 'Travel', emoji: '✈️' },       // Travel and tourism
  { id: 'food', label: 'Food', emoji: '🍕' },          // Food and cooking
  { id: 'tech', label: 'Technology', emoji: '💻' },    // Tech and gadgets
  { id: 'art', label: 'Art', emoji: '🎨' },            // Art and creativity
  { id: 'casual', label: 'Casual Chat', emoji: '💬' }, // General conversation
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
  const [socket, setSocket] = useState(null);
  
  // Current application state: 'setup', 'searching', or 'chatting'
  const [appState, setAppState] = useState('setup');
  
  // Array of messages in the current chat
  const [messages, setMessages] = useState([]);
  
  // Current message being typed by the user
  const [inputMessage, setInputMessage] = useState('');
  
  // Information about the matched chat partner
  const [partner, setPartner] = useState(null);
  
  // Current room ID when in a chat
  const [roomId, setRoomId] = useState(null);
  
  // Common interests between the user and partner
  const [commonInterests, setCommonInterests] = useState([]);
  
  // Whether the partner is currently typing
  const [partnerTyping, setPartnerTyping] = useState(false);
  
  // Countdown timer for search timeout (60 seconds)
  const [searchTimer, setSearchTimer] = useState(60);
  
  // User's own socket ID for message identification
  const [mySocketId, setMySocketId] = useState(null);

  // ============================================
  // USER FORM DATA STATE
  // ============================================
  // Form data for user setup - stores username, gender, preferences, interests
  const [formData, setFormData] = useState({
    username: '',           // Display name entered by user
    gender: 'male',         // User's gender (male/female)
    preferredGender: 'any', // Gender preference for matching
    interests: [],          // Array of selected interest IDs
  });

  // ============================================
  // REFS FOR DOM ELEMENTS
  // ============================================
  // Reference to scroll area for auto-scrolling to new messages
  const scrollRef = useRef(null);
  
  // Reference to file input for image uploads
  const fileInputRef = useRef(null);
  
  // Reference to video file input
  const videoInputRef = useRef(null);
  
  // Reference to store the search timer interval ID
  const searchTimerRef = useRef(null);

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
      
      // Transport methods to try (WebSocket first, then polling as fallback)
      transports: ['websocket', 'polling'],
    });

    // ============================================
    // SOCKET EVENT: CONNECTION ESTABLISHED
    // ============================================
    newSocket.on('connect', () => {
      // Log connection success with socket ID
      console.log('Connected to server with ID:', newSocket.id);
      
      // Store our socket ID for message identification
      setMySocketId(newSocket.id || null);
    });

    // ============================================
    // SOCKET EVENT: MATCH FOUND
    // ============================================
    // Triggered when the server finds a compatible match
    newSocket.on('match-found', (data) => {
      // Log match details for debugging
      console.log('Match found!', data);
      
      // Stop the search timer since we found a match
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
      }
      
      // Update state with match information
      setRoomId(data.roomId);                           // Store the room ID
      setPartner(data.partner);                         // Store partner info
      setCommonInterests(data.commonInterests || []);   // Store shared interests
      
      // Clear any previous messages from old chats
      setMessages([]);
      
      // Transition to chatting state
      setAppState('chatting');
    });

    // ============================================
    // SOCKET EVENT: SEARCHING STATUS
    // ============================================
    // Triggered when user is added to the waiting queue
    newSocket.on('searching', () => {
      // Log that we're now searching
      console.log('Added to waiting queue, searching for match...');
      
      // Transition to searching state
      setAppState('searching');
      
      // Reset search timer to 60 seconds
      setSearchTimer(60);
    });

    // ============================================
    // SOCKET EVENT: NEW MESSAGE RECEIVED
    // ============================================
    // Triggered when a new message arrives in the chat
    newSocket.on('new-message', (message) => {
      // Log the received message for debugging
      console.log('Received message:', message);
      
      // Add the new message to the messages array
      // Using functional update to ensure we have the latest state
      setMessages((prev) => [...prev, message]);
    });

    // ============================================
    // SOCKET EVENT: PARTNER TYPING INDICATOR
    // ============================================
    // Triggered when the partner starts or stops typing
    newSocket.on('partner-typing', (isTyping) => {
      // Update typing indicator state
      setPartnerTyping(isTyping);
    });

    // ============================================
    // SOCKET EVENT: CHAT ENDED
    // ============================================
    // Triggered when the chat session ends (partner left, disconnected, etc.)
    newSocket.on('chat-ended', (data) => {
      // Log the reason for chat ending
      console.log('Chat ended:', data.reason);
      
      // Reset all chat-related state
      setPartner(null);           // Clear partner info
      setRoomId(null);            // Clear room ID
      setMessages([]);            // Clear messages
      setCommonInterests([]);     // Clear common interests
      setPartnerTyping(false);    // Clear typing indicator
      
      // Return to setup screen
      setAppState('setup');
    });

    // Store the socket instance in state for use in other functions
    setSocket(newSocket);

    // ============================================
    // CLEANUP FUNCTION
    // ============================================
    // Runs when component unmounts to prevent memory leaks
    return () => {
      // Disconnect from the socket server
      newSocket.disconnect();
      
      // Clear any active search timer
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
    // Check if scroll ref exists and has a scrollable element
    if (scrollRef.current) {
      // Get the scrollable viewport element inside ScrollArea
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        // Scroll to the bottom of the messages container
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages]); // Run this effect when messages array changes

  // ============================================
  // SEARCH TIMER EFFECT
  // ============================================
  // Countdown timer that auto-cancels search after 60 seconds
  useEffect(() => {
    // Only run timer when in searching state
    if (appState === 'searching') {
      // Start countdown interval - runs every 1 second
      searchTimerRef.current = setInterval(() => {
        // Decrease timer by 1 second
        setSearchTimer((prev) => {
          // If timer reaches 0, cancel the search
          if (prev <= 1) {
            // Stop the interval
            if (searchTimerRef.current) {
              clearInterval(searchTimerRef.current);
            }
            
            // Leave the queue on the server
            socket?.emit('leave-queue');
            
            // Return to setup state
            setAppState('setup');
            
            return 60; // Reset timer for next search
          }
          
          // Return decremented value
          return prev - 1;
        });
      }, 1000); // Run every 1000ms (1 second)
    }

    // Cleanup function - clear interval when effect re-runs or unmounts
    return () => {
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
      }
    };
  }, [appState, socket]); // Re-run when appState or socket changes

  // ============================================
  // HANDLE START MATCH
  // ============================================
  // Function to initiate the matching process when user clicks "Start Matching"
  const handleStartMatch = () => {
    // Validate that username is provided (not empty or just whitespace)
    if (!formData.username.trim()) {
      alert('Please enter a username');
      return; // Stop execution if validation fails
    }

    // Validate that at least one interest is selected
    if (formData.interests.length === 0) {
      alert('Please select at least one interest');
      return; // Stop execution if validation fails
    }

    // Emit join-queue event to server with user data
    // Server will find a match or add user to waiting queue
    socket?.emit('join-queue', formData);
    
    // Transition to searching state to show loading UI
    setAppState('searching');
  };

  // ============================================
  // HANDLE CANCEL SEARCH
  // ============================================
  // Function to cancel the search and return to setup screen
  const handleCancelSearch = () => {
    // Emit leave-queue event to remove from waiting list on server
    socket?.emit('leave-queue');
    
    // Return to setup state
    setAppState('setup');
    
    // Reset timer for next search attempt
    setSearchTimer(60);
  };

  // ============================================
  // HANDLE SEND MESSAGE
  // ============================================
  // Function to send a text message to the chat partner
  const handleSendMessage = () => {
    // Don't send empty messages (only whitespace or empty string)
    if (!inputMessage.trim()) return;

    // Emit the message to the server
    socket?.emit('send-message', {
      content: inputMessage, // The message text
      type: 'text',          // Message type indicator
    });

    // Clear the input field after sending
    setInputMessage('');
    
    // Stop typing indicator since message is sent
    socket?.emit('typing', false);
  };

  // ============================================
  // HANDLE END CHAT
  // ============================================
  // Function to end the current chat session voluntarily
  const handleEndChat = () => {
    // Emit end-chat event to notify server and partner
    socket?.emit('end-chat');
    
    // Reset all chat-related state locally
    setPartner(null);        // Clear partner info
    setRoomId(null);         // Clear room ID
    setMessages([]);         // Clear messages
    setCommonInterests([]);  // Clear common interests
    
    // Return to setup screen
    setAppState('setup');
  };

  // ============================================
  // HANDLE TYPING INDICATOR
  // ============================================
  // Function to notify partner when user is typing
  const handleTyping = (e) => {
    // Update input value with what user typed
    setInputMessage(e.target.value);
    
    // Emit typing status: true if there's text, false if empty
    socket?.emit('typing', e.target.value.length > 0);
  };

  // ============================================
  // HANDLE INTEREST TOGGLE
  // ============================================
  // Function to toggle interest selection in the form
  const handleInterestToggle = (interestId) => {
    setFormData((prev) => {
      // Check if interest is already selected
      const isSelected = prev.interests.includes(interestId);
      
      // If selected, remove it from array; otherwise, add it
      const newInterests = isSelected
        ? prev.interests.filter((i) => i !== interestId)  // Remove
        : [...prev.interests, interestId];                 // Add
      
      // Return updated form data with new interests array
      return { ...prev, interests: newInterests };
    });
  };

  // ============================================
  // HANDLE IMAGE UPLOAD
  // ============================================
  // Function to handle image file selection and send to chat
  const handleImageUpload = (e) => {
    // Get the selected file from the input
    const file = e.target.files?.[0];
    
    // Return early if no file was selected
    if (!file) return;

    // Validate file size (max 5MB for images)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    // Create a FileReader to convert file to base64 string
    const reader = new FileReader();
    
    // Event handler when file reading completes
    reader.onload = () => {
      // Send the image as a base64-encoded data URL
      socket?.emit('send-message', {
        content: reader.result, // Base64 string of image
        type: 'image',          // Message type indicator
      });
    };
    
    // Start reading the file as a data URL (base64)
    reader.readAsDataURL(file);
    
    // Clear the file input for future uploads
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ============================================
  // HANDLE VIDEO UPLOAD
  // ============================================
  // Function to handle video file selection and send to chat
  const handleVideoUpload = (e) => {
    // Get the selected file from the input
    const file = e.target.files?.[0];
    
    // Return early if no file was selected
    if (!file) return;

    // Validate file size (max 50MB for videos)
    if (file.size > 50 * 1024 * 1024) {
      alert('Video must be less than 50MB');
      return;
    }

    // Create a temporary video element to check duration
    const video = document.createElement('video');
    video.preload = 'metadata'; // Only load metadata, not full video
    
    // Event handler when video metadata is loaded
    video.onloadedmetadata = () => {
      // Release the object URL to free memory
      URL.revokeObjectURL(video.src);
      
      // Check if video duration exceeds 1 minute (60 seconds)
      if (video.duration > 60) {
        alert('Video must be 1 minute or less');
        return;
      }
      
      // Create a FileReader to convert file to base64 string
      const reader = new FileReader();
      
      // Event handler when file reading completes
      reader.onload = () => {
        // Send the video as a base64-encoded data URL
        socket?.emit('send-message', {
          content: reader.result, // Base64 string of video
          type: 'video',          // Message type indicator
        });
      };
      
      // Start reading the file as a data URL (base64)
      reader.readAsDataURL(file);
    };
    
    // Create a temporary object URL to load video metadata
    video.src = URL.createObjectURL(file);
    
    // Clear the file input for future uploads
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  };

  // ============================================
  // FORMAT TIMESTAMP
  // ============================================
  // Function to convert Unix timestamp to readable time string
  const formatTime = (timestamp) => {
    // Create a Date object from the Unix timestamp
    const date = new Date(timestamp);
    
    // Return formatted time string (e.g., "2:30 PM")
    return date.toLocaleTimeString([], {
      hour: '2-digit',   // Two-digit hour
      minute: '2-digit', // Two-digit minute
    });
  };

  // ============================================
  // RENDER SETUP SCREEN
  // ============================================
  // Function to render the initial setup form where user enters their info
  const renderSetupScreen = () => (
    // Main container with gradient background - fills full screen height
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      {/* Decorative background elements for visual appeal */}
      <div className="absolute inset-0 overflow-hidden">
        {/* First animated gradient orb - top left */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        {/* Second animated gradient orb - bottom right */}
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Main card container - elevated above background */}
      <Card className="w-full max-w-lg relative z-10 bg-white/95 backdrop-blur-sm shadow-2xl border-0">
        {/* Card header with app logo and title */}
        <CardHeader className="text-center pb-2">
          {/* App logo/icon container */}
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
            {/* Message icon inside logo */}
            <MessageCircle className="w-8 h-8 text-white" />
          </div>
          
          {/* App title with gradient text effect */}
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
            RandomMatch
          </CardTitle>
          
          {/* App description/tagline */}
          <CardDescription className="text-gray-600 mt-2">
            Connect with strangers who share your interests
          </CardDescription>
        </CardHeader>

        {/* Card content - contains all form fields */}
        <CardContent className="space-y-6">
          {/* ============================================ */}
          {/* USERNAME INPUT SECTION */}
          {/* ============================================ */}
          <div className="space-y-2">
            {/* Label for username input */}
            <Label htmlFor="username" className="text-sm font-medium text-gray-700">
              Choose your display name
            </Label>
            {/* Input container with icon */}
            <div className="relative">
              {/* User icon inside input field */}
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              {/* Username text input */}
              <Input
                id="username"
                placeholder="Enter a cool username..."
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="pl-10 h-12 border-gray-200 focus:border-purple-500 focus:ring-purple-500"
                maxLength={20} // Limit username to 20 characters
              />
            </div>
          </div>

          {/* ============================================ */}
          {/* GENDER SELECTION SECTION */}
          {/* ============================================ */}
          <div className="space-y-3">
            {/* Label for gender selection */}
            <Label className="text-sm font-medium text-gray-700">Your gender</Label>
            {/* Radio group for gender options */}
            <RadioGroup
              value={formData.gender}
              onValueChange={(value) => setFormData({ ...formData, gender: value })}
              className="flex gap-4"
            >
              {/* Male option */}
              <div className="flex-1">
                {/* Hidden radio input for accessibility */}
                <RadioGroupItem value="male" id="male" className="peer sr-only" />
                {/* Styled label that acts as button */}
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

          {/* ============================================ */}
          {/* PREFERRED GENDER SECTION */}
          {/* ============================================ */}
          <div className="space-y-3">
            {/* Label for gender preference */}
            <Label className="text-sm font-medium text-gray-700">I want to chat with</Label>
            {/* Radio group for preference options */}
            <RadioGroup
              value={formData.preferredGender}
              onValueChange={(value) => setFormData({ ...formData, preferredGender: value })}
              className="flex gap-3"
            >
              {/* Male preference option */}
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
              
              {/* Female preference option */}
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
              
              {/* Any gender preference option */}
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

          {/* ============================================ */}
          {/* INTERESTS SELECTION SECTION */}
          {/* ============================================ */}
          <div className="space-y-3">
            {/* Label with helper text */}
            <Label className="text-sm font-medium text-gray-700">
              Select your interests
              <span className="text-gray-400 font-normal ml-1">(select at least 1)</span>
            </Label>
            {/* Grid of interest checkboxes */}
            <div className="grid grid-cols-2 gap-2">
              {/* Map through all available interests */}
              {INTERESTS.map((interest) => (
                <div
                  key={interest.id}
                  onClick={() => handleInterestToggle(interest.id)}
                  className={`flex items-center gap-2 p-2.5 border-2 rounded-xl cursor-pointer transition-all ${
                    // Apply different styles based on selection state
                    formData.interests.includes(interest.id)
                      ? 'border-purple-500 bg-purple-50'   // Selected style
                      : 'border-gray-200 hover:border-purple-300' // Unselected style
                  }`}
                >
                  {/* Checkbox visual indicator */}
                  <Checkbox
                    checked={formData.interests.includes(interest.id)}
                    className="pointer-events-none data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
                  />
                  {/* Interest emoji */}
                  <span className="text-lg">{interest.emoji}</span>
                  {/* Interest label text */}
                  <span className="text-sm font-medium">{interest.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ============================================ */}
          {/* START MATCHING BUTTON */}
          {/* ============================================ */}
          <Button
            onClick={handleStartMatch}
            className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold text-lg shadow-lg shadow-purple-500/30 transition-all duration-300"
          >
            {/* Sparkle icon before text */}
            <Sparkles className="w-5 h-5 mr-2" />
            Start Matching
            {/* Arrow icon after text */}
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  // ============================================
  // RENDER SEARCHING SCREEN
  // ============================================
  // Function to render the searching/waiting screen with countdown
  const renderSearchingScreen = () => (
    // Main container with animated gradient background
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      {/* Animated background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Search status card */}
      <Card className="w-full max-w-md relative z-10 bg-white/95 backdrop-blur-sm shadow-2xl border-0">
        <CardContent className="pt-8 pb-6 text-center">
          {/* ============================================ */}
          {/* ANIMATED SEARCH INDICATOR */}
          {/* ============================================ */}
          <div className="relative mx-auto w-32 h-32 mb-6">
            {/* Outer pulsing ring - largest */}
            <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping" />
            {/* Middle pulsing ring */}
            <div className="absolute inset-4 rounded-full bg-purple-500/30 animate-ping animation-delay-200" />
            {/* Inner circle with search icon */}
            <div className="absolute inset-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Search className="w-8 h-8 text-white animate-pulse" />
            </div>
          </div>

          {/* Searching status text */}
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Finding your match...</h2>
          <p className="text-gray-500 mb-6">
            Looking for someone who shares your interests
          </p>

          {/* ============================================ */}
          {/* TIMER COUNTDOWN SECTION */}
          {/* ============================================ */}
          <div className="bg-gray-100 rounded-xl p-4 mb-6">
            {/* Timer display with spinner */}
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
              <span className="text-gray-700 font-medium">
                Auto-cancel in <span className="text-purple-600 font-bold">{searchTimer}s</span>
              </span>
            </div>
            {/* Progress bar showing time remaining */}
            <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-600 transition-all duration-1000"
                style={{ width: `${(searchTimer / 60) * 100}%` }} // Calculate width based on remaining time
              />
            </div>
          </div>

          {/* ============================================ */}
          {/* USER PREFERENCES SUMMARY */}
          {/* ============================================ */}
          <div className="bg-purple-50 rounded-xl p-4 mb-6 text-left">
            <h3 className="text-sm font-semibold text-purple-700 mb-2">Your preferences:</h3>
            <div className="space-y-1 text-sm text-gray-600">
              {/* Display username */}
              <p><span className="font-medium">Username:</span> {formData.username}</p>
              {/* Display gender preference */}
              <p><span className="font-medium">Looking for:</span> {formData.preferredGender === 'any' ? 'Anyone' : formData.preferredGender}</p>
              {/* Display selected interests as badges */}
              <div className="flex flex-wrap gap-1 mt-2">
                {formData.interests.map((interest) => {
                  // Find the interest data to get emoji and label
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

          {/* ============================================ */}
          {/* CANCEL SEARCH BUTTON */}
          {/* ============================================ */}
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
  // Function to render the main chat interface when matched with a partner
  const renderChatScreen = () => (
    // Main container with dark gradient background
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      {/* Chat container card - fills most of the screen */}
      <div className="w-full max-w-2xl h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* ============================================ */}
        {/* CHAT HEADER */}
        {/* ============================================ */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 text-white">
          <div className="flex items-center justify-between">
            {/* Partner info section */}
            <div className="flex items-center gap-3">
              {/* Partner avatar */}
              <Avatar className="h-12 w-12 border-2 border-white/30">
                {/* Fallback shows first letter of username */}
                <AvatarFallback className="bg-white/20 text-white font-bold">
                  {partner?.username?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              
              {/* Partner name and status */}
              <div>
                <h2 className="font-semibold text-lg">{partner?.username || 'Anonymous'}</h2>
                <div className="flex items-center gap-1.5">
                  {/* Green dot online indicator */}
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-sm text-white/80">
                    {/* Show "typing..." or "Online" based on partner state */}
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

          {/* Display common interests if any exist */}
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

        {/* ============================================ */}
        {/* MESSAGES AREA */}
        {/* ============================================ */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {/* Welcome message at the start of chat */}
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-700 px-4 py-2 rounded-full text-sm">
                <Sparkles className="w-4 h-4" />
                You're now connected with {partner?.username}!
              </div>
            </div>

            {/* Render each message in the chat */}
            {messages.map((message) => {
              // Determine if this message was sent by the current user
              const isOwnMessage = message.senderId === mySocketId;

              return (
                <div
                  key={message.id}
                  // Align own messages to right, partner messages to left
                  className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    // Apply different styles for own vs partner messages
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      isOwnMessage
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-800 rounded-bl-md'
                    }`}
                  >
                    {/* Render text message */}
                    {message.type === 'text' && (
                      <p className="break-words">{message.content}</p>
                    )}

                    {/* Render image message */}
                    {message.type === 'image' && (
                      <img
                        src={message.content}
                        alt="Shared image"
                        className="max-w-full rounded-lg max-h-64 object-contain"
                      />
                    )}

                    {/* Render video message */}
                    {message.type === 'video' && (
                      <video
                        src={message.content}
                        controls // Show play/pause controls
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

            {/* Typing indicator animation */}
            {partnerTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-4 py-3 rounded-bl-md">
                  {/* Three bouncing dots animation */}
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* ============================================ */}
        {/* MESSAGE INPUT AREA */}
        {/* ============================================ */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center gap-2">
            {/* Hidden file inputs for media uploads */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*" // Only accept image files
              className="hidden"
            />
            <input
              type="file"
              ref={videoInputRef}
              onChange={handleVideoUpload}
              accept="video/*" // Only accept video files
              className="hidden"
            />

            {/* Image upload button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="text-gray-500 hover:text-purple-600 hover:bg-purple-50"
              title="Send image"
            >
              <Image className="w-5 h-5" />
            </Button>

            {/* Video upload button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => videoInputRef.current?.click()}
              className="text-gray-500 hover:text-purple-600 hover:bg-purple-50"
              title="Send video (max 1 min)"
            >
              <Video className="w-5 h-5" />
            </Button>

            {/* Message text input field */}
            <Input
              value={inputMessage}
              onChange={handleTyping}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()} // Send on Enter key
              placeholder="Type a message..."
              className="flex-1 h-11 border-gray-200 focus:border-purple-500 focus:ring-purple-500"
            />

            {/* Send message button */}
            <Button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim()} // Disable when input is empty
              className="h-11 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>

          {/* File size limit information */}
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
  // Return the appropriate screen based on current app state
  return (
    <>
      {/* Render setup screen when user is entering their info */}
      {appState === 'setup' && renderSetupScreen()}
      
      {/* Render searching screen when looking for a match */}
      {appState === 'searching' && renderSearchingScreen()}
      
      {/* Render chat screen when matched with a partner */}
      {appState === 'chatting' && renderChatScreen()}
    </>
  );
}
