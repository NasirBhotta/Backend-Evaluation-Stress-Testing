// ponytail: hardcoded, mirrors each server's .env PORT default. If a .env PORT
// changes, update the number here too (servers/<name>/.env).
export const SERVERS = [
  { name: "node", label: "NodeJS Bare", port: 5001 },
  { name: "express", label: "Express.js", port: 5002 },
  { name: "fastify", label: "Fastify", port: 5003 },
  { name: "go", label: "Go", port: 5005 },
]
