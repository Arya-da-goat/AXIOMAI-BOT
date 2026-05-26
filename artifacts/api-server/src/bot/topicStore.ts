import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const STORE_PATH = join(process.cwd(), "data", "topics.json");

function ensureDir() {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
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

export function setTopic(guildId: string, topic: string) {
  store[guildId] = topic;
  save(store);
}

export function removeTopic(guildId: string) {
  delete store[guildId];
  save(store);
}

export function getTopic(guildId: string | null): string | undefined {
  if (!guildId) return undefined;
  return store[guildId];
}
