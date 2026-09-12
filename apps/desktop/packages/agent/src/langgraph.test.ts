import { describe, expect, it } from 'vitest'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

/**
 * Proves the pinned graph runtime actually builds and executes here.
 *
 * This is deliberately not an agent test: `docs/agent.md` §4 requires a settled tool-dispatch
 * protocol before the agent boundary is implemented, so there is no agent behaviour to assert yet.
 * It verifies the dependency boundary — graph construction, a reducer-backed channel, and
 * invocation — so a later agent implementation starts from a runtime known to work.
 */
describe('@langchain/langgraph', () => {
  it('compiles and invokes a graph', async () => {
    const State = Annotation.Root({
      steps: Annotation<string[]>({ reducer: (left, right) => left.concat(right), default: () => [] })
    })

    const graph = new StateGraph(State)
      .addNode('observe', () => ({ steps: ['observe'] }))
      .addNode('evaluate', () => ({ steps: ['evaluate'] }))
      .addEdge(START, 'observe')
      .addEdge('observe', 'evaluate')
      .addEdge('evaluate', END)
      .compile()

    const result = await graph.invoke({})

    expect(result.steps).toEqual(['observe', 'evaluate'])
  })

  it('reduces concurrent channel writes instead of overwriting them', async () => {
    const State = Annotation.Root({
      steps: Annotation<string[]>({ reducer: (left, right) => left.concat(right), default: () => [] })
    })

    const graph = new StateGraph(State)
      .addNode('first', () => ({ steps: ['first'] }))
      .addNode('second', () => ({ steps: ['second'] }))
      .addEdge(START, 'first')
      .addEdge(START, 'second')
      .addEdge('first', END)
      .addEdge('second', END)
      .compile()

    const result = await graph.invoke({})

    expect([...result.steps].sort()).toEqual(['first', 'second'])
  })
})
