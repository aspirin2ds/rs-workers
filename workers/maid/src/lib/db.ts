import { drizzle } from "drizzle-orm/d1";

export function getDb(env: CloudflareBindings) {
  return drizzle(env.DB);
}
