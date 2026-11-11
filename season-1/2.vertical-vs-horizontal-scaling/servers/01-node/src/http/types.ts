import type { IncomingMessage, ServerResponse } from "node:http"

export type Query = Record<string, string | string[] | undefined>

export type Next = (err?: unknown) => void

export type Request = IncomingMessage & {
  method: string
  path: string
  originalUrl: string
  query: Query
  params: Record<string, string>
  body: unknown
  user?: { id: string; jti: string }
  get(name: string): string | undefined
}

export type Response = ServerResponse & {
  status(code: number): Response
  json(body: unknown): Response
  set(name: string, value: string): Response
}

export type Handler = (req: Request, res: Response, next: Next) => void | Promise<void>
