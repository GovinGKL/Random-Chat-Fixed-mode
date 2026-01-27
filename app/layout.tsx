// ============================================
// ROOT LAYOUT COMPONENT
// ============================================
// This is the root layout that wraps all pages
// It provides the HTML structure and global providers

// Import global CSS styles including Tailwind
import './globals.css';

// Import TypeScript type for Next.js metadata
import type { Metadata } from 'next';

// Import React types for children prop
import { ReactNode } from 'react';

// ============================================
// METADATA CONFIGURATION
// ============================================
// This metadata is used for SEO and browser tab info
export const metadata: Metadata = {
  // The title shown in the browser tab
  title: 'RandomMatch - Connect with Strangers',
  
  // Description for search engines
  description: 'A random chat application to connect with people around the world based on interests',
  
  // Keywords for SEO
  keywords: ['chat', 'random', 'strangers', 'connect', 'messaging'],
};

// ============================================
// ROOT LAYOUT COMPONENT DEFINITION
// ============================================
// This component wraps all pages in the application
export default function RootLayout({
  // children: The page content that will be rendered inside this layout
  children,
}: {
  // TypeScript type: children must be a valid React node
  children: ReactNode;
}) {
  // Return the HTML document structure
  return (
    // HTML element with English language attribute
    <html lang="en">
      {/* Head section is automatically managed by Next.js */}
      
      {/* Body element with anti-aliased font rendering */}
      <body className="antialiased">
        {/* Render the page content */}
        {children}
      </body>
    </html>
  );
}
