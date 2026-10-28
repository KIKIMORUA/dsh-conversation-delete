/**
 * Host half of `dsh-conversation-delete`.
 *
 * The Harness keeps session logs append-only and its persistence seam has no
 * deletion API, so a real "delete conversation" has to remove four things in
 * one operation: the projection-cache row, the workspace membership, the
 * durable session directory, and the client's session summary. This module
 * owns that operation and exposes it to the Web page over one exact route.
 */
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROUTE = '/plugin-conversation-delete/delete'
const REQUEST_HEADER = 'x-dsh-conversation-delete'
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 64 * 1024

/** Wait for the Web server carrier so the route exists as soon as the page can call it. */
export const inject = ['webServer']

/**
 * Mount the delete route and track which Sessions are actively running.
 * @param ctx - plugin Context.
 */
export function apply(ctx) {
  const running = new Set()
  ctx.on('agent/status', ({ agent, status }) => {
    const id = String(agent.id)
    if (status === 'running') running.add(id)
    else running.delete(id)
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => handle(ctx, running, req, res),
  }), 'conversation-delete.route')
}

/**
 * One HTTP request: validate method, plugin header, same-origin, then delete.
 * @param ctx - plugin Context.
 * @param running - Session ids whose Agent is running.
 * @param req - Node request.
 * @param res - Node response.
 */
async function handle(ctx, running, req, res) {
  const send = (status, body) => {
    try {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(body))
    } catch {
      // The peer may have gone away; nothing else to do.
    }
  }

  try {
    if ((req.method || '').toUpperCase() !== 'POST') {
      return send(405, { ok: false, code: 'method-not-allowed', message: 'POST only.' })
    }
    // A custom header makes every cross-origin call a preflighted request, which
    // this route never answers, so a foreign page cannot drive deletion.
    if (String(req.headers[REQUEST_HEADER] || '') !== '1') {
      return send(403, { ok: false, code: 'forbidden', message: 'Missing plugin request header.' })
    }
    const origin = req.headers.origin
    if (origin !== undefined) {
      // Same-origin only, whichever loopback spelling the page used.
      let sameOrigin = false
      try {
        sameOrigin = new URL(String(origin)).host === String(req.headers.host || '')
      } catch {
        sameOrigin = false
      }
      if (!sameOrigin) {
        return send(403, { ok: false, code: 'forbidden', message: 'Cross-origin request refused.' })
      }
    }

    const payload = parseJson(await readBody(req))
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
    if (!SESSION_ID.test(sessionId)) {
      return send(400, { ok: false, code: 'invalid-session-id', message: 'Not a Session id.' })
    }

    const result = await deleteConversation(ctx, sessionId, running)
    return send(result.ok ? 200 : 409, result)
  } catch (error) {
    return send(500, {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Remove one conversation from every durable place that knows about it.
 * @param ctx - plugin Context.
 * @param sessionId - durable Session id.
 * @param running - Session ids whose Agent is running.
 * @returns a JSON body describing what was removed.
 */
async function deleteConversation(ctx, sessionId, running) {
  if (running.has(sessionId)) {
    return {
      ok: false,
      code: 'session/running',
      message: 'This conversation is still running. Stop or finish the current turn first.',
    }
  }

  const registry = ctx.get('workspaceRegistry')
  const owners = registry === undefined
    ? []
    : registry.list().filter((workspace) => workspace.sessionIds.includes(sessionId))

  const persistence = ctx.get('sessionPersistence')
  let stored = true
  if (persistence !== undefined) {
    try {
      stored = (await persistence.stat(sessionId)) !== undefined
    } catch {
      stored = true
    }
  }

  // 1. Projection-cache row first: it is a fold cache over the log, so dropping it
  //    before the log cannot produce a cache that is ahead of its source.
  const cacheRemoved = await dropProjectionCache(ctx, sessionId)

  // 2. Durable session directories. A failure here leaves membership untouched,
  //    so the UI keeps showing the conversation instead of hiding a live log.
  const logDirs = []
  try {
    logDirs.push(...await removeSessionLogs(ctx, sessionId, persistence))
  } catch (error) {
    return {
      ok: false,
      code: 'session/log-busy',
      message: `Could not remove the session log: ${error instanceof Error ? error.message : String(error)}`,
      removedLogDirs: logDirs,
      removedCache: cacheRemoved,
    }
  }

  // 3. Registry membership. `detachSession` is the registry's own durable write,
  //    so every open page receives the Workspace upsert that drops the row.
  const detached = []
  for (const workspace of owners) {
    try {
      await workspace.detachSession(sessionId)
      detached.push(String(workspace.id))
    } catch {
      // A failed detach is reported below through `membership` staying empty.
    }
  }
  if (registry !== undefined) {
    try {
      await registry.unarchiveSession(sessionId)
    } catch {
      // Not archived is the ordinary case.
    }
    try {
      await registry.unpinSession(sessionId)
    } catch {
      // Not pinned is the ordinary case.
    }
  }

  // 4. Client session summaries. `api-session/removed` is the forwarded event the
  //    Session list already reacts to, so no page needs a reload.
  try {
    ctx.emit('api-session/removed', sessionId)
  } catch {
    // A listener failure must not turn a completed deletion into an error.
  }

  return {
    ok: true,
    sessionId,
    stored,
    removedCache: cacheRemoved,
    removedLogDirs: logDirs,
    detachedWorkspaces: detached,
  }
}

/**
 * Delete the session's row from the persisted `session_projcache` domain.
 * @param ctx - plugin Context.
 * @param sessionId - durable Session id.
 * @returns whether one cached row was removed.
 */
async function dropProjectionCache(ctx, sessionId) {
  let removed = false
  const facility = ctx.get('storageDomain')
  const domain = typeof facility?.get === 'function' ? facility.get('session_projcache') : undefined
  if (domain !== undefined) {
    try {
      removed = (await domain.table('sessions').delete(sessionId)) === true
      return removed
    } catch {
      // Fall through to the file fallback below.
    }
  }
  for (const root of storageRoots()) {
    for (const file of [
      join(root, 'session_projcache', 'sessions', `${sessionId}.json`),
      join(root, 'session_projcache', `${sessionId}.json`),
    ]) {
      try {
        await fsp.rm(file, { force: true })
        removed = true
      } catch {
        // Absent or locked; the domain path above is the supported one.
      }
    }
  }
  return removed
}

/**
 * Delete the session-owned log directories under every candidate root.
 * @param ctx - plugin Context.
 * @param sessionId - durable Session id.
 * @param persistence - the mounted persistence service, when present.
 * @returns the absolute directories removed.
 */
async function removeSessionLogs(ctx, sessionId, persistence) {
  const removed = []
  for (const root of sessionRoots(persistence)) {
    let projects
    try {
      projects = await fsp.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue
      const projectDir = join(root, project.name)
      let entries
      try {
        entries = await fsp.readdir(projectDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        // Session ids are escaped to one path segment; UUID-shaped ids stay
        // literal, and the suffix check keeps this tolerant of a future encoder.
        if (entry.name !== sessionId && !entry.name.endsWith(sessionId)) continue
        const target = join(projectDir, entry.name)
        await fsp.rm(target, { recursive: true, force: true })
        removed.push(target)
      }
    }
  }
  return removed
}

/**
 * Candidate session-log roots, most authoritative first.
 * @param persistence - the mounted persistence service, when present.
 * @returns absolute directories to scan.
 */
function sessionRoots(persistence) {
  const roots = new Set()
  const configured = persistence?.root
  if (typeof configured === 'string' && configured.length > 0) roots.add(resolve(configured))
  roots.add(join(resolveDshHome(), 'sessions'))
  return [...roots]
}

/**
 * Candidate storage roots that hold `per-record` domain documents.
 * @returns absolute directories to scan.
 */
function storageRoots() {
  return [join(resolveDshHome(), 'storages')]
}

/** Resolve the Harness home the same way the Host does: `$DSH_HOME`, else `~/.dsh`. */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/**
 * Read a bounded UTF-8 request body.
 * @param req - Node request.
 * @returns the body text.
 */
function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectBody)
  })
}

/**
 * Parse a JSON body, treating an empty body as `undefined`.
 * @param text - raw request body.
 * @returns the parsed value.
 */
function parseJson(text) {
  if (text.trim().length === 0) return undefined
  return JSON.parse(text)
}
