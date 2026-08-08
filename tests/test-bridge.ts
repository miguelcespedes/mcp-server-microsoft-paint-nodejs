import { AutomationClient } from "../src/infrastructure/windows/automation/automation-client.js";
import { createWin32PaintDriver } from "../src/infrastructure/win32/paint.js";
import { PaintController } from "../src/paint/paint-controller.js";
import { PaintSessionStore } from "../src/paint/session/paint-session.js";
import { createLogger } from "../src/infrastructure/logging/logger.js";

const logger = createLogger();
const paint = createWin32PaintDriver();
const automationClient = new AutomationClient();
const sessionStore = new PaintSessionStore(logger);
const controller = new PaintController(sessionStore, automationClient, logger);

console.log("Testing persistent bridge...");

const inv = await controller.inventory({ maxDepth: 6, includeBoundingRectangles: true });
console.log("Inventory 1:", inv.success, "elements:", inv.elements.length);

const inv2 = await controller.inventory({ maxDepth: 4, includeBoundingRectangles: false });
console.log("Inventory 2:", inv2.success, "elements:", inv2.elements.length);

const inv3 = await controller.inventory({ maxDepth: 3, includeBoundingRectangles: true });
console.log("Inventory 3:", inv3.success, "elements:", inv3.elements.length);

console.log("All inventories completed successfully!");
await automationClient.shutdown();