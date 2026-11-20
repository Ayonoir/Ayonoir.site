// ============================================================
//  EASY SETTINGS — this is the only file you edit for branding.
// ============================================================

export const BRAND = {
  name: "Ayo Noir",                       // Studio name shown everywhere
  tagline: "Private client galleries",    // Small line under the name
  accent: "#c9b48a",                      // Champagne gold. Try "#d4d0c8" for silver
  contactEmail: "",                       // Shown on "gallery expired" screen (optional)
};

// Paste these two values from Supabase (Project Settings -> API)
export const SUPABASE_URL = "https://pxdhbqhazpapmaaaokhi.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_F-m1QK8TvmYuwG9ibx9ILw_sGHiuiDN";

// Upload behaviour (keeps your free storage going further)
export const DEFAULTS = {
  expiryDays: 30,        // New galleries expire this many days from today
  maxImageEdge: 6000,    // Longest side of the photo clients view/download, in pixels
  jpegQuality: 0.99,     // 0 to 1
  thumbEdge: 900,        // Longest side of grid thumbnails
};
