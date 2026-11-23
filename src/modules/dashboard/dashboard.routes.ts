import { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const htmlPath = path.join(__dirname, "dashboard.html");

  fastify.get("/", async (request, reply) => {
    const html = fs.readFileSync(htmlPath, "utf-8");
    return reply.type("text/html").send(html);
  });

  fastify.get("/dashboard", async (request, reply) => {
    const html = fs.readFileSync(htmlPath, "utf-8");
    return reply.type("text/html").send(html);
  });
}
