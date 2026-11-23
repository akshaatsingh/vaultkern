import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../docs/screenshots");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function run() {
  console.log("Launching Edge via puppeteer-core...");
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2, // Retina resolution!
    },
  });

  const page = await browser.newPage();
  console.log("Navigating to http://localhost:3001...");
  await page.goto("http://localhost:3001", { waitUntil: "networkidle0" });

  // 1. Hero Light Mode
  console.log("Capturing 01_hero_light.png...");
  await page.screenshot({
    path: path.join(outputDir, "01_hero_light.png"),
    clip: { x: 0, y: 0, width: 1440, height: 860 },
  });

  // 2. Open Gmail Auth Modal
  console.log("Opening Gmail Auth Modal...");
  await page.evaluate(() => {
    (window as any).openGmailAuthModal("alex.fintech@gmail.com");
  });
  await new Promise((r) => setTimeout(r, 600));

  console.log("Capturing 03_gmail_auth_modal.png...");
  await page.screenshot({
    path: path.join(outputDir, "03_gmail_auth_modal.png"),
  });

  // Close Gmail modal
  await page.evaluate(() => {
    (window as any).closeGmailAuthModal();
  });
  await new Promise((r) => setTimeout(r, 400));

  // 3. Log in as Demo User (Alice) and Open Profile Customization Modal
  console.log("Logging in as Alice and opening Profile Customizer...");
  await page.evaluate(async () => {
    await (window as any).demoLogin("alice");
    (window as any).openProfileModal();
  });
  await new Promise((r) => setTimeout(r, 700));

  console.log("Capturing 04_profile_customizer.png...");
  await page.screenshot({
    path: path.join(outputDir, "04_profile_customizer.png"),
  });

  // Switch to Card & Avatar tab
  await page.evaluate(() => {
    (window as any).switchProfileTab("fintech");
  });
  await new Promise((r) => setTimeout(r, 500));

  console.log("Capturing 05_card_avatar_studio.png...");
  await page.screenshot({
    path: path.join(outputDir, "05_card_avatar_studio.png"),
  });

  // Close Profile modal
  await page.evaluate(() => {
    (window as any).closeProfileModal();
  });
  await new Promise((r) => setTimeout(r, 400));

  // 4. Hero Dark Mode
  console.log("Toggling Dark Mode...");
  await page.evaluate(() => {
    (window as any).toggleDarkMode();
  });
  await new Promise((r) => setTimeout(r, 500));

  console.log("Capturing 02_hero_dark.png...");
  await page.screenshot({
    path: path.join(outputDir, "02_hero_dark.png"),
    clip: { x: 0, y: 0, width: 1440, height: 860 },
  });

  // 5. Scroll to P2P Phone Simulator & Currency Converter
  console.log("Capturing 06_p2p_phone_transfers.png...");
  const phoneSection = await page.$("#transfers-demo");
  if (phoneSection) {
    await phoneSection.scrollIntoView();
    await new Promise((r) => setTimeout(r, 500));
    await phoneSection.screenshot({
      path: path.join(outputDir, "06_p2p_phone_transfers.png"),
    });
  }

  // 6. Concurrency Arena Tests
  console.log("Running Concurrency Arena Tests in Dark Mode...");
  const arenaSection = await page.$("#ledger-arena");
  if (arenaSection) {
    await arenaSection.scrollIntoView();
    await page.evaluate(async () => {
      await (window as any).runIdempotencyBurst();
      await (window as any).runOverdraftAttack();
      await (window as any).runDeadlockStorm();
    });
    await new Promise((r) => setTimeout(r, 1200));

    console.log("Capturing 07_concurrency_stress_arena.png...");
    await arenaSection.screenshot({
      path: path.join(outputDir, "07_concurrency_stress_arena.png"),
    });
  }

  await browser.close();
  console.log("All screenshots captured successfully in docs/screenshots!");
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
