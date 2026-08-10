import fs from "node:fs/promises";
import path from "node:path";

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJson<T = unknown>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}
