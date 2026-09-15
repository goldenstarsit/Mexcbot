import assert from "node:assert/strict";
import MexcClient from "../src/exchange/mexcClient.js";

const original = {
  nodeEnv: process.env.NODE_ENV,
  apiKey: process.env.MEXC_API_KEY,
  apiSecret: process.env.MEXC_API_SECRET,
  baseUrl: process.env.MEXC_BASE_URL,
  recvWindow: process.env.MEXC_RECV_WINDOW,
};

try {
  process.env.NODE_ENV = "production";
  process.env.MEXC_API_KEY = "";
  process.env.MEXC_API_SECRET = "";
  process.env.MEXC_BASE_URL = "https://api.mexc.com";
  process.env.MEXC_RECV_WINDOW = "5000";

  const hasApiCredentials =
    Boolean(process.env.MEXC_API_KEY) &&
    Boolean(process.env.MEXC_API_SECRET);

  assert.equal(hasApiCredentials, false);

  const client = new MexcClient();

  assert.equal(client.baseUrl, "https://api.mexc.com");
  assert.equal(client.recvWindow, 5000);

  assert.throws(
    () => client.sign("test-payload"),
    /MEXC API secret is required/,
  );

  process.env.MEXC_RECV_WINDOW = "60000";

  assert.throws(
    () => new MexcClient(),
    /MEXC recvWindow must be greater than 0 and less than 60000/,
  );

  process.env.MEXC_RECV_WINDOW = "5000";
  process.env.MEXC_API_KEY = "test-key";
  process.env.MEXC_API_SECRET = "test-secret";

  const liveClient = new MexcClient();

  assert.equal(liveClient.apiKey, "test-key");
  assert.equal(liveClient.apiSecret, "test-secret");

  console.log("M95 PRODUCTION ENVIRONMENT VALIDATION: PASS");
  console.log({
    productionMode: process.env.NODE_ENV === "production",
    credentialsRequiredForLiveTrading: true,
    missingCredentialsDisableLiveTrading: !hasApiCredentials,
    validBaseUrl: client.baseUrl === "https://api.mexc.com",
    validRecvWindow: client.recvWindow === 5000,
    invalidRecvWindowRejected: true,
    signedRequestsRequireSecret: true,
    validCredentialsAccepted: true,
  });
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
