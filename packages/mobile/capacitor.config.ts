import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.gethouston.app",
  appName: "Houston",
  webDir: "dist",
  // A long-press link preview opens the URL inside WebKit, outside the app's
  // click handlers, so it would bypass the store-safe link guards.
  ios: { allowsLinkPreview: false },
  experimental: {
    ios: {
      spm: {
        // Package traits need Swift tools 6.1. The plugin's default traits link
        // the Facebook SDK; "Google" alone keeps GoogleSignIn, and Apple uses
        // the system AuthenticationServices framework.
        // https://github.com/capawesome-team/capacitor-firebase/tree/main/packages/authentication#package-traits
        swiftToolsVersion: "6.1",
        packageTraits: { "@capacitor-firebase/authentication": ["Google"] },
        // Capawesome's documented fix for a SwiftPM package identity collision:
        // https://github.com/capawesome-team/capacitor-firebase/issues/959
        packageOptions: {
          "@capacitor-firebase/authentication": { symlink: true },
          "@capacitor-firebase/messaging": { symlink: true },
        },
      },
    },
  },
  plugins: {
    // iOS: `resize: "native"` shrinks the WKWebView above the keyboard.
    // Android: the core SystemBars plugin pads the window by the IME inset,
    // and the Keyboard plugin's own resizeOnFullScreen path is skipped while
    // SystemBars is present (Capacitor logs a warning to omit it). Either
    // way the existing visualViewport hook measures any remaining occlusion,
    // so the composer never gets two insets.
    Keyboard: { resize: "native" },
    SystemBars: { insetsHandling: "css", style: "LIGHT" },
    SplashScreen: { launchAutoHide: true },
    FirebaseMessaging: { presentationOptions: [] },
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com", "apple.com", "microsoft.com"],
    },
    // Capgo v8.52.1 settings document manual mode and all three cloud URLs:
    // https://capgo.app/docs/plugins/updater/settings/
    // Its iOS and Android plugin load empty configured URLs without defaults.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: "",
      channelUrl: "",
      statsUrl: "",
      shakeMenu: false,
      appReadyTimeout: 30000,
    },
  },
};

export default config;
