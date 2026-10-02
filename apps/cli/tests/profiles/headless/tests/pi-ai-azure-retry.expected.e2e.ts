import { readdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const libBinScript = fileURLToPath(new URL('../../../../lib/bin.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const profilePatch = fileURLToPath(new URL('./fixtures/pi-ai-azure-retry.patch.yml', import.meta.url))
const testPrompt = 'Return exactly RETRY_RECOVERED and do not call tools.'
const serverErrorMessage = 'The server had an error processing your request'
const recoveredText = 'RETRY_RECOVERED'
type JsonRecord = Record<string, unknown>

interface AzureResponsesFixture {
  readonly url: string
  readonly taskBodies: string[]
  readonly taskPaths: string[]
  readonly taskStatuses: number[]
  close(): Promise<void>
}

function recordOf(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected a JSON object')
  }
  return value as JsonRecord
}

async function persistedEvents(cwd: string): Promise<JsonRecord[]> {
  const sessionRoot = join(cwd, '.sessions')
  const files = (await readdir(sessionRoot, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  if (files.length !== 1) throw new Error('expected exactly one persisted JSONL session')
  const file = files[0]
  if (file === undefined) throw new Error('the persisted JSONL session path is missing')
  const content = await readFile(join(sessionRoot, file), 'utf8')
  return content.split(/\r?\n/).filter(Boolean).map(line => recordOf(JSON.parse(line)))
}

function serializeSseEvents(events: readonly unknown[]): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
}

function responseSse(): string {
  const item = {
    id: 'msg_retry_recovered',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: recoveredText, annotations: [] }],
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_retry_recovered' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '' },
    },
    {
      type: 'response.output_text.delta',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: recoveredText,
    },
    {
      type: 'response.output_text.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: recoveredText,
    },
    {
      type: 'response.content_part.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: recoveredText },
    },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: 'resp_retry_recovered',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      },
    },
  ]
  return serializeSseEvents(events)
}

function responseFailedSse(attempt: number): string {
  const responseId = `resp_retry_failed_${attempt}`
  const events = [
    { type: 'response.created', response: { id: responseId } },
    {
      type: 'response.failed',
      response: {
        id: responseId,
        status: 'failed',
        error: { code: 'server_error', type: 'server_error', message: serverErrorMessage },
      },
    },
  ]
  return serializeSseEvents(events)
}

async function startAzureResponsesFixture(
  failureMode: 'http-status' | 'status-free' | 'status-free-exhaustion' = 'http-status',
): Promise<AzureResponsesFixture> {
  const taskBodies: string[] = []
  const taskPaths: string[] = []
  const taskStatuses: number[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = recordOf(JSON.parse(body))
      const outputLimit = parsed.max_output_tokens ?? parsed.max_tokens
      const taskRequest = body.includes(testPrompt) && outputLimit !== 64
      if (taskRequest) {
        taskBodies.push(body)
        taskPaths.push(request.url ?? '')
        const failedAttempt = failureMode === 'status-free-exhaustion' || taskBodies.length <= 2
        if (failureMode !== 'http-status' && failedAttempt) {
          taskStatuses.push(200)
          response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
          response.end(responseFailedSse(taskBodies.length))
          return
        }
        const status = failureMode === 'http-status' && failedAttempt
          ? 500
          : 200
        taskStatuses.push(status)
        if (status === 500) {
          response.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
          response.end(JSON.stringify({
            error: {
              code: 'InternalServerError',
              type: 'server_error',
              message: serverErrorMessage,
            },
          }))
          return
        }
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
      response.end(responseSse())
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('local Azure Responses server did not bind a TCP port')
  const url = `http://127.0.0.1:${address.port}`
  return {
    url,
    taskBodies,
    taskPaths,
    taskStatuses,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) reject(error)
        else resolve()
      })
      server.closeAllConnections()
    }),
  }
}

function assertPersistedRetryEvents(records: JsonRecord[]): void {
  const retryRecords = records.filter(record => record.type === 'llm/retry')
  const retryData = retryRecords.map(record => recordOf(record.data))
  expect(retryData).toHaveLength(2)
  expect(retryData.map(data => data.retry)).toEqual([1, 2])
  expect(typeof retryData[0]?.turn).toBe('number')
  expect(typeof retryData[0]?.step).toBe('number')
  expect(retryData[1]).toMatchObject({
    turn: retryData[0]?.turn,
    step: retryData[0]?.step,
  })
  for (const data of retryData) {
    expect(data).toMatchObject({
      provider: 'azure-openai-responses',
      mode: 'normal',
      maxRetries: 2,
      delayMs: 1,
      failure: {
        code: 'SERVER',
        classificationSource: 'pi-ai-error-message',
      },
    })
    expect(JSON.stringify(data.failure)).toContain(serverErrorMessage)
  }
  const started = records
    .filter(record => record.type === 'llm/retry-started')
    .map(record => recordOf(record.data))
  expect(started).toHaveLength(2)
  expect(started.map(data => data.retry)).toEqual([1, 2])
  expect(started.map(data => data.retryId)).toEqual(retryData.map(data => data.retryId))
  expect(records.filter(record => typeof record.type === 'string' && record.type.startsWith('tool/'))).toHaveLength(0)
}

async function assertPersistedRetryRecovery(cwd: string): Promise<void> {
  const records = await persistedEvents(cwd)
  assertPersistedRetryEvents(records)
  const assistantMessages = records.filter(record => record.type === 'assistant/message')
  expect(assistantMessages).toHaveLength(1)
  expect(JSON.stringify(assistantMessages[0]?.data)).toContain(recoveredText)
}

async function assertPersistedRetryExhaustion(cwd: string): Promise<void> {
  const records = await persistedEvents(cwd)
  assertPersistedRetryEvents(records)
  expect(records.filter(record => record.type === 'assistant/message')).toHaveLength(0)
  const turnEnd = records.filter(record => record.type === 'turn/end').at(-1)
  if (turnEnd === undefined) throw new Error('expected the exhausted turn to persist turn/end')
  const endData = recordOf(turnEnd.data)
  const reason = recordOf(endData.reason)
  expect(reason.kind).toBe('error')
  const terminalFailure = recordOf(reason.error)
  expect(terminalFailure).toMatchObject({ code: 'SERVER' })
  expect(terminalFailure.message).toContain(serverErrorMessage)
}

let activeServer: AzureResponsesFixture | undefined

afterEach(async () => {
  const server = activeServer
  activeServer = undefined
  await server?.close()
})

async function runAzureRetryCli(
  server: AzureResponsesFixture,
  expectedExitCode: number,
  inspect: (cwd: string) => Promise<void>,
) {
  return runLoaderSmoke({
    label: 'pi-ai Azure retry through built headless CLI',
    tempDirPrefix: 'dsh-pi-ai-azure-retry-',
    binScript,
    libBinScript,
    mode: 'lib',
    configPath: profilePatch,
    binArgs: ['--profile', 'headless', '--patch', profilePatch, testPrompt],
    tsconfigPath,
    // Add cold/parallel headroom beyond the shared smoke window for this CLI path.
    processTimeoutMs: 2 * LOADER_SMOKE_TEST_TIMEOUT_MS,
    expectedExitCode,
    env: {
      DSH_PI_AI_RETRY_BASE_URL: server.url,
      DSH_PI_AI_RETRY_TEST_KEY: 'key-for-local-test-only',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
    },
    inspect,
  })
}

function assertAzureTaskRequests(server: AzureResponsesFixture, expectedStatuses: readonly number[]): void {
  expect(server.taskStatuses).toEqual(expectedStatuses)
  expect(server.taskBodies).toHaveLength(expectedStatuses.length)
  expect(server.taskBodies.map(body => recordOf(JSON.parse(body)).model)).toEqual(
    expectedStatuses.map(() => 'gpt-6-luna'),
  )
  expect(server.taskPaths.every(path => path.toLowerCase().includes('responses'))).toBe(true)
}

async function expectRetryRecovery(
  failureMode: 'http-status' | 'status-free',
  expectedStatuses: readonly number[],
): Promise<void> {
  const server = await startAzureResponsesFixture(failureMode)
  activeServer = server
  const result = await runAzureRetryCli(server, 0, assertPersistedRetryRecovery)
  expect(result.stderr).toBe('')
  assertAzureTaskRequests(server, expectedStatuses)
}

async function expectRetryExhaustion(): Promise<void> {
  const server = await startAzureResponsesFixture('status-free-exhaustion')
  activeServer = server
  await runAzureRetryCli(server, 1, assertPersistedRetryExhaustion)
  assertAzureTaskRequests(server, [200, 200, 200])
}

it('recovers through the real pi-ai route after two HTTP 500 failures', async () => {
  await expectRetryRecovery('http-status', [500, 500, 200])
}, 120_000)

it('recovers through the real pi-ai route after two status-free response.failed events', async () => {
  await expectRetryRecovery('status-free', [200, 200, 200])
}, 120_000)

it('exhausts the bounded retry budget for status-free response.failed server errors', async () => {
  await expectRetryExhaustion()
}, 120_000)
