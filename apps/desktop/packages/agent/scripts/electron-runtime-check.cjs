// Verifies the pinned agent library loads and executes under Electron's bundled Node runtime.
//
// Run from apps/desktop (the package that owns the Electron dependency):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ../../packages/agent/scripts/electron-runtime-check.cjs
//
// ELECTRON_RUN_AS_NODE runs Electron without a window or app lifecycle, which is the same module
// environment the main process uses. This proves the require() path and graph execution work on
// Electron's Node; it does not prove in-app integration, which needs the desktop smoke test.
const assert = require('node:assert/strict')

const { StateGraph, Annotation, START, END } = require('@langchain/langgraph')
const { HumanMessage } = require('@langchain/core/messages')

const { node, electron } = process.versions

async function main() {
  const State = Annotation.Root({
    steps: Annotation({ reducer: (left, right) => left.concat(right), default: () => [] })
  })

  const graph = new StateGraph(State)
    .addNode('observe', () => ({ steps: ['observe'] }))
    .addNode('evaluate', () => ({ steps: ['evaluate'] }))
    .addEdge(START, 'observe')
    .addEdge('observe', 'evaluate')
    .addEdge('evaluate', END)
    .compile()

  const result = await graph.invoke({})
  assert.deepEqual(result.steps, ['observe', 'evaluate'], 'graph produced the expected channel value')

  // @langchain/core is a separate entry point with its own require condition; check it too.
  const message = new HumanMessage('ping')
  assert.equal(message.content, 'ping', '@langchain/core loaded and constructed a message')

  console.info(
    JSON.stringify({ check: 'agent.runtime', electron, node, graph: 'ok', core: 'ok' })
  )
}

main().catch(error => {
  console.error(JSON.stringify({ check: 'agent.runtime', electron, node, error: String(error) }))
  process.exitCode = 1
})
