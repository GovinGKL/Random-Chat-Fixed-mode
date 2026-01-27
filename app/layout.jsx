// ============================================
// ROOT LAYOUT COMPONENT
// ============================================
// This is the root layout that wraps all pages
// It provides the HTML structure and global providers

// Import global CSS styles including Tailwind
import './globals.css';

// ============================================
// METADATA CONFIGURATION
// ============================================
// This metadata is used for SEO and browser tab info
export const metadata = {
  // The title shown in the browser tab
  title: 'RandomMatch - Connect with Strangers',
  
  // Description for search engines
  description: 'A random chat application to connect with people around the world based on interests',
};

// ============================================
// ROOT LAYOUT COMPONENT DEFINITION
// ============================================
// This component wraps all pages in the application
export default function RootLayout({ children }) {
  // Return the HTML document structure
  return (
    // HTML element with English language attribute
    <html lang="en">
      {/* Body element with anti-aliased font rendering */}
      <body className="antialiased">
        {/* Render the page content */}
        {children}
      </body>
    </html>
  );
}
