import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const STORE_PATH = join(process.cwd(), "data", "colors.json");

function ensureDir() {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
}

function load(): Record<string, number> {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function save(data: Record<string, number>) {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

let store = load();

export function setEmbedColor(guildId: string, color: number) {
  store[guildId] = color;
  save(store);
}

export function getEmbedColor(guildId: string | null): number {
  if (!guildId) return 0x5865f2;
  return store[guildId] ?? 0x5865f2;
}
