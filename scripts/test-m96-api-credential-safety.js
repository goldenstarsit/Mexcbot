import assert from "node:assert/strict";
import MexcClient from "../src/exchange/mexcClient.js";

const original = {
  apiKey: process.env.MEXC_API_KEY,
  apiSecret: process.env.MEXC_API_SECRET,
  baseUrl: process.env.MEXC_BASE_URL,
  recvWindow: process.env.MEXC_RECV_WINDOW,
};

try {
  process.env.MEXC_API_KEY = "M96_REALISTIC_TEST_API_KEY";
  process.env.MEXC_API_SECRET = "M96_REALISTIC_TEST_API_SECRET";
  process.env.MEXC_BASE_URL = "https://api.mexc.com";
  process.env.MEXC_RECV_WINDOW = "5000";

  const client = new MexcClient();

  const serialized = JSON.stringify(client);

  assert.equal(serialized.includes(process.env.MEXC_API_KEY), false);
  assert.equal(serialized.includes(process.env.MEXC_API_SECRET), false);
  assert.equal(serialized.includes("[REDACTED]"), true);

  const json = client.toJSON();

  assert.equal(json.apiKey, "[REDACTED]");
  assert.equal(json.apiSecret, "[REDACTED]");
  assert.equal(json.baseUrl, "https://api.mexc.com");
  assert.equal(json.recvWindow, 5000);

  assert.equal(client.apiKey, "M96_REALISTIC_TEST_API_KEY");
  assert.equal(client.apiSecret, "M96_REALISTIC_TEST_API_SECRET");

  console.log("M96 API CREDENTIAL SAFETY: PASS");
  console.log({
    apiKeyStoredForRequests: true,
    apiSecretStoredForSigning: true,
    jsonCredentialLeakPrevented: true,
    apiKeyRedacted: true,
    apiSecretRedacted: true,
    baseUrlPreserved: true,
    recvWindowPreserved: true,
  });
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
