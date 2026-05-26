import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const STORE_PATH = join(process.cwd(), "data", "channels.json");

function ensureDir() {
  const dir = join(process.cwd(), "data");
  try {
    const { mkdirSync } = require("fs");
    mkdirSync(dir, { recursive: true });
  } catch {}
}

function load(): Record<string, string> {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function save(data: Record<string, string>) {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

let store = load();

export function setChannel(guildId: string, channelId: string) {
  store[guildId] = channelId;
  save(store);
}

export function removeChannel(guildId: string) {
  delete store[guildId];
  save(store);
}

export function getChannel(guildId: string): string | undefined {
  return store[guildId];
}
