import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createApi } from "./lib/api.mjs"
import { buildPairArtifact, buildUsersArtifact } from "./lib/artifact.mjs"
import { mapPool } from "./lib/concurrency.mjs"
import { messagesForPair, pairIndexes } from "./lib/seed-plan.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, "../data")
const PASSWORD = "LoadTest123!"

function parseArgs(argv) {
  let pairs = 1
  let messages = 3
  let messagesMin = 50
  let messagesMax = 100
  let concurrency = 4
  let useMessageRange = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pairs") pairs = Number(argv[++i])
    if (argv[i] === "--messages") {
      messages = Number(argv[++i])
      useMessageRange = false
    }
    if (argv[i] === "--messages-min") {
      messagesMin = Number(argv[++i])
      useMessageRange = true
    }
    if (argv[i] === "--messages-max") {
      messagesMax = Number(argv[++i])
      useMessageRange = true
    }
    if (argv[i] === "--concurrency") concurrency = Number(argv[++i])
  }
  if (!Number.isInteger(pairs) || pairs < 1) throw new Error("--pairs must be an integer >= 1")
  if (!useMessageRange && (!Number.isInteger(messages) || messages < 0)) {
    throw new Error("--messages must be an integer >= 0")
  }
  if (!Number.isInteger(messagesMin) || !Number.isInteger(messagesMax) || messagesMin < 0 || messagesMax < messagesMin) {
    throw new Error("--messages-min/--messages-max must satisfy 0 <= min <= max")
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be an integer >= 1")
  }
  return {
    pairs,
    messages: useMessageRange ? null : messages,
    messagesMin,
    messagesMax,
    concurrency,
  }
}

function userSpec(index) {
  return {
    username: `load_${index}`,
    email: `loadtest${index}@example.com`,
    password: PASSWORD,
  }
}

async function registerOrLogin(api, spec) {
  try {
    const auth = await api.register(spec)
    return { ...spec, id: auth.user.id, accessToken: auth.accessToken }
  } catch {
    const auth = await api.login({ email: spec.email, password: spec.password })
    return { ...spec, id: auth.user.id, accessToken: auth.accessToken }
  }
}

async function ensureAcceptedFriendship(api, sender, receiver) {
  try {
    const friendship = await api.createFriendRequest(sender.accessToken, receiver.id)
    await api.decideFriendship(receiver.accessToken, friendship.id, "ACCEPT")
    return
  } catch (error) {
    if (!String(error.message).includes("409")) throw error
  }
  const incoming = await api.listIncomingRequests(receiver.accessToken)
  const pending = (incoming || []).find(
    row => row.requester?.id === sender.id && row.status === "PENDING",
  )
  if (pending) {
    await api.decideFriendship(receiver.accessToken, pending.id, "ACCEPT")
  }
}

async function seedPair(api, pairIndex, messageCount) {
  const senderSpec = userSpec(pairIndex * 2)
  const receiverSpec = userSpec(pairIndex * 2 + 1)
  const sender = await registerOrLogin(api, senderSpec)
  const receiver = await registerOrLogin(api, receiverSpec)

  await ensureAcceptedFriendship(api, sender, receiver)

  const conversation = await api.createDirect(sender.accessToken, receiver.id)
  const conversationId = conversation.id

  for (let i = 0; i < messageCount; i++) {
    const fromSender = i % 2 === 0
    const token = fromSender ? sender.accessToken : receiver.accessToken
    await api.sendMessage(token, conversationId, {
      body: `seed message ${i + 1} for pair ${pairIndex}`,
      clientMessageId: crypto.randomUUID(),
    })
  }

  return {
    users: [
      { id: sender.id, username: sender.username, email: sender.email, password: PASSWORD },
      { id: receiver.id, username: receiver.username, email: receiver.email, password: PASSWORD },
    ],
    pair: buildPairArtifact({
      conversationId,
      sender,
      receiver,
      password: PASSWORD,
    }),
    messageCount,
  }
}

async function main() {
  const { pairs, messages, messagesMin, messagesMax, concurrency } = parseArgs(process.argv.slice(2))
  const api = createApi()
  const indexes = pairIndexes(pairs)

  console.error(
    `seeding ${pairs} pairs (concurrency=${concurrency}, messages=${
      messages !== null ? messages : `${messagesMin}-${messagesMax}`
    })`,
  )

  const seeded = await mapPool(indexes, concurrency, async pairIndex => {
    const messageCount = messagesForPair(pairIndex, {
      min: messagesMin,
      max: messagesMax,
      fixed: messages,
    })
    const result = await seedPair(api, pairIndex, messageCount)
    console.error(
      `seeded pair ${pairIndex + 1}/${pairs} conversationId=${result.pair.conversationId} messages=${messageCount}`,
    )
    return result
  })

  const allUsers = seeded.flatMap(row => row.users)
  const allPairs = seeded.map(row => row.pair)
  const totalMessages = seeded.reduce((sum, row) => sum + row.messageCount, 0)

  await mkdir(dataDir, { recursive: true })
  const usersPath = path.join(dataDir, "users.json")
  const pairsPath = path.join(dataDir, "pairs.json")
  await writeFile(usersPath, JSON.stringify(buildUsersArtifact(allUsers), null, 2) + "\n")
  await writeFile(pairsPath, JSON.stringify(allPairs, null, 2) + "\n")
  console.error(`wrote ${usersPath} (${allUsers.length} users)`)
  console.error(`wrote ${pairsPath} (${allPairs.length} pairs, ${totalMessages} seed messages)`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
