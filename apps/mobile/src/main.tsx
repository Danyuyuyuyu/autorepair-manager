import React from "react";
import ReactDOM from "react-dom/client";

import { MobileApp } from "./app/mobile-app";
import { MobileErrorBoundary } from "./components/mobile-error-boundary";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Mobile root element is missing");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <MobileErrorBoundary>
      <MobileApp />
    </MobileErrorBoundary>
  </React.StrictMode>,
);

if (import.meta.env.VITE_MOBILE_CUSTOMER_CONTRACT === "1") {
  void import("./testing/customer-native-contract")
    .then(({ runNativeCustomerContract }) => runNativeCustomerContract())
    .catch((error: unknown) => {
      console.error(
        `[mobile:customer-contract] FAIL ${error instanceof Error ? error.stack : String(error)}`,
      );
    });
}
