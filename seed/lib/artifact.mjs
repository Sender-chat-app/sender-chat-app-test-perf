export function buildPairArtifact({ conversationId, sender, receiver, password }) {
  return {
    conversationId,
    password,
    sender: { id: sender.id, username: sender.username, email: sender.email },
    receiver: { id: receiver.id, username: receiver.username, email: receiver.email },
  }
}

export function buildUsersArtifact(users) {
  return users.map(({ id, username, email, password }) => ({
    id,
    username,
    email,
    password,
  }))
}
