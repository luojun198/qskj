import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("param", { viewport: { width: 1920, height: 1080 } });

await page.goto("http://localhost:5275/system/param");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });

// Take a screenshot to see the page
await page.screenshot({ path: "tmp/param-page.png" });

// Get AI snapshot to find the input
const snapshot = await page.getAISnapshot();
console.log(snapshot);

await client.disconnect();