import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

export const MOBILE_APP_ID = "com.autorepair.manager";
export const MOBILE_APP_NAME = "汽修管家";

const config: CapacitorConfig = {
  appId: MOBILE_APP_ID,
  appName: MOBILE_APP_NAME,
  webDir: "dist",
  backgroundColor: "#1d4ed8",
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#1d4ed8",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
